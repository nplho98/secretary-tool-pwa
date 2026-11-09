package io.github.nplho98.secretarytool;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.os.*;
import android.speech.tts.*;
import android.util.Log;
import org.json.JSONArray;
import java.util.*;
import java.util.concurrent.*;

public class ReminderService extends Service {
    public static final String CHANNEL="meeting_reminders";
    public static final int ALERT_NOTIFICATION=76, SERVICE_NOTIFICATION=77;
    private static final Handler MAIN=new Handler(Looper.getMainLooper());
    private static volatile ReminderService instance;
    private static boolean starting;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private SpeechSession speech;
    private boolean running,polling,syncAgain,registered;
    private final Runnable poll=()->pollNow();
    private final BroadcastReceiver screenReceiver=new BroadcastReceiver(){
        @Override public void onReceive(Context c,Intent intent){
            handler.removeCallbacks(poll);
            updateAlerts();
            if(!Intent.ACTION_SCREEN_OFF.equals(intent.getAction()))pollNow(true);
        }
    };
    public static boolean isRunning(){return instance!=null&&instance.running;}
    public static boolean isLocked(Context c){return c.getSystemService(KeyguardManager.class).isKeyguardLocked();}
    public static boolean isScreenOn(Context c){return c.getSystemService(PowerManager.class).isInteractive();}
    public static void channel(Context c){
        NotificationChannel channel=new NotificationChannel(CHANNEL,"開會與待辦提醒",NotificationManager.IMPORTANCE_HIGH);
        channel.setSound(null,null);channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        c.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    private static PendingIntent alertIntent(Context c){
        Intent intent=new Intent(c,ReminderActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c,75,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    private static Notification notification(Context c,String text,boolean full){
        Notification.Builder b=new Notification.Builder(c,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("提醒事項").setContentText(text).setCategory(Notification.CATEGORY_ALARM)
                .setOngoing(true).setAutoCancel(false).setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(alertIntent(c)).setOnlyAlertOnce(true);
        if(Build.VERSION.SDK_INT>=31)b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        if(full)b.setFullScreenIntent(alertIntent(c),true);
        return b.build();
    }
    private static void lockedNotification(Context c){
        channel(c);NotificationManager manager=c.getSystemService(NotificationManager.class);
        int count=new ReminderStore(c).alerts().length();
        if(count==0||!isLocked(c)){manager.cancel(ALERT_NOTIFICATION);return;}
        try{manager.notify(ALERT_NOTIFICATION,notification(c,"未確認 "+count+" 筆",true));}
        catch(SecurityException e){Log.e("Reminder","請啟用通知權限",e);}
    }
    public static void showAlerts(Context context,boolean open){
        Context c=context.getApplicationContext();
        MAIN.post(()->{
            if(isRunning()){instance.updateAlerts();return;}
            if(new ReminderStore(c).alerts().length()==0){stop(c);return;}
            if(isLocked(c)){ReminderOverlay.hide(c);lockedNotification(c);return;}
            c.getSystemService(NotificationManager.class).cancel(ALERT_NOTIFICATION);
            if(open)ensureStarted(c);
            else if(isScreenOn(c))ReminderOverlay.show(c);
        });
    }
    /** 同步完成後的入口；所有視窗及服務啟動都留在主執行緒。 */
    public static void afterSync(Context context){Context c=context.getApplicationContext();MAIN.post(()->{
        if(isRunning())instance.updateAlerts();else ensureStarted(c);
    });}
    private static void ensureStarted(Context c){
        if(new ReminderStore(c).alerts().length()==0){stop(c);return;}
        if(isRunning()||starting)return;
        if(isLocked(c)){ReminderOverlay.hide(c);lockedNotification(c);return;}
        if(!isScreenOn(c))return;
        Runnable launch=()->{
            if(isRunning()||starting||isLocked(c)||!isScreenOn(c)||new ReminderStore(c).alerts().length()==0)return;
            if(!ReminderActivity.isVisible()&&!ReminderOverlay.isShowing())return;
            starting=true;
            try{c.startForegroundService(new Intent(c,ReminderService.class));MAIN.postDelayed(()->starting=false,10000);}
            catch(Exception e){starting=false;Log.e("Reminder","提醒前景服務啟動失敗",e);}
        };
        if(ReminderActivity.isVisible())launch.run();
        else{ReminderOverlay.show(c);ReminderOverlay.whenVisible(launch);}
    }
    public static void syncNow(Context context){Context c=context.getApplicationContext();MAIN.post(()->{
        if(isRunning())instance.pollNow();else ReminderSyncJob.request(c);
    });}
    public static void stop(Context context){Context c=context.getApplicationContext();MAIN.post(()->{
        if(new ReminderStore(c).alerts().length()!=0)return;
        if(isRunning()){instance.updateAlerts();return;}
        ReminderScheduler.schedule(c);ReminderOverlay.hide(c);
        NotificationManager nm=c.getSystemService(NotificationManager.class);nm.cancel(ALERT_NOTIFICATION);nm.cancel(SERVICE_NOTIFICATION);
        c.stopService(new Intent(c,ReminderService.class));
    });}
    @Override public void onCreate(){
        super.onCreate();instance=this;starting=false;
        IntentFilter filter=new IntentFilter();filter.addAction(Intent.ACTION_SCREEN_ON);filter.addAction(Intent.ACTION_SCREEN_OFF);filter.addAction(Intent.ACTION_USER_PRESENT);
        if(Build.VERSION.SDK_INT>=33)registerReceiver(screenReceiver,filter,Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(screenReceiver,filter);
        registered=true;
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        channel(this);
        try{
            Notification n=notification(this,"提醒中：未確認 "+new ReminderStore(this).alerts().length()+" 筆",false);
            if(Build.VERSION.SDK_INT>=34)startForeground(SERVICE_NOTIFICATION,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(SERVICE_NOTIFICATION,n);
        }catch(Exception e){Log.e("Reminder","提醒前景服務建立失敗",e);finish();return START_NOT_STICKY;}
        running=true;
        worker.submit(()->{
            try{
                List<ReminderSyncJob.Speech> lines=ReminderSyncJob.processLocal(this);
                ReminderScheduler.schedule(this);
                handler.post(()->{
                    if(!running)return;
                    speak(lines);updateAlerts();pollNow();
                });
                ReminderSyncJob.request(this);
            }catch(Exception e){Log.e("Reminder","提醒服務處理失敗",e);handler.post(()->{updateAlerts();pollNow();});}
        });return START_NOT_STICKY;
    }
    private void speak(List<ReminderSyncJob.Speech> lines){
        if(lines.isEmpty())return;
        if(speech!=null)speech.add(lines);
        else speech=play(this,lines,()->{speech=null;updateAlerts();});
    }
    private void updateAlerts(){
        if(!running)return;
        int count=new ReminderStore(this).alerts().length();
        if(count==0){
            if(speech==null){finish();return;}
            ReminderOverlay.hide(this);
            getSystemService(NotificationManager.class).cancel(ALERT_NOTIFICATION);
            handler.removeCallbacks(poll);
            return;
        }
        getSystemService(NotificationManager.class).notify(SERVICE_NOTIFICATION,notification(this,"提醒中：未確認 "+count+" 筆",false));
        if(isLocked(this)){ReminderOverlay.hide(this);lockedNotification(this);}
        else{
            getSystemService(NotificationManager.class).cancel(ALERT_NOTIFICATION);
            if(isScreenOn(this)&&!ReminderActivity.isVisible())ReminderOverlay.refresh(this);else ReminderOverlay.hide(this);
        }
        if(!isScreenOn(this)||isLocked(this))handler.removeCallbacks(poll);
    }
    private void pollNow(){pollNow(false);}
    private void pollNow(boolean screenEvent){
        handler.removeCallbacks(poll);
        if(!running||!isScreenOn(this)||(!screenEvent&&isLocked(this)))return;
        if(polling){syncAgain=true;return;}
        polling=true;
        worker.submit(()->{
            try{ReminderSyncJob.sync(this);List<ReminderSyncJob.Speech> lines=ReminderSyncJob.processLocal(this);
                handler.post(()->{if(running)speak(lines);});}
            catch(Exception e){Log.e("Reminder","提醒持續同步失敗",e);}
            finally{handler.post(()->{
                polling=false;if(!running)return;updateAlerts();
                if(running&&isScreenOn(this)&&!isLocked(this)){handler.removeCallbacks(poll);handler.postDelayed(poll,syncAgain?0:5000);}
                syncAgain=false;
            });}
        });
    }
    private void finish(){
        running=false;handler.removeCallbacksAndMessages(null);
        if(speech!=null){speech.close();speech=null;}
        ReminderScheduler.schedule(this);ReminderOverlay.hide(this);
        getSystemService(NotificationManager.class).cancel(ALERT_NOTIFICATION);
        stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();
    }
    @Override public void onDestroy(){
        running=false;handler.removeCallbacksAndMessages(null);
        if(speech!=null)speech.close();
        if(registered){unregisterReceiver(screenReceiver);registered=false;}
        ReminderScheduler.schedule(this);ReminderOverlay.hide(this);
        getSystemService(NotificationManager.class).cancel(ALERT_NOTIFICATION);
        stopForeground(STOP_FOREGROUND_REMOVE);
        if(instance==this)instance=null;
        worker.shutdownNow();super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent){return null;}

    public static SpeechSession play(Context c,List<ReminderSyncJob.Speech> lines,Runnable done){
        SpeechSession session=new SpeechSession(c,lines,done);session.start();return session;
    }
    /** 服務及同步作業共用同一套持久化去重與 TTS 清理規則。 */
    public static final class SpeechSession {
        private final Context context;private final ReminderStore store;
        private final List<ReminderSyncJob.Speech> lines;private final Runnable done;
        private final Handler main=new Handler(Looper.getMainLooper());
        private TextToSpeech tts;private final Map<String,ReminderSyncJob.Speech> pending=new HashMap<>();
        private boolean closed,ready;
        private PowerManager.WakeLock wakeLock;
        SpeechSession(Context c,List<ReminderSyncJob.Speech> lines,Runnable done){context=c.getApplicationContext();store=new ReminderStore(c);this.lines=new ArrayList<>(lines);this.done=done;}
        void start(){
            if(lines.isEmpty()){main.post(this::complete);return;}
            wakeLock=context.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"secretarytool:reminder");
            wakeLock.acquire(150000L);
            main.postDelayed(this::complete,130000L);
            tts=new TextToSpeech(context,status->{main.post(()->initialized(status));});
        }
        private void initialized(int status){
            if(closed)return;
            if(status!=TextToSpeech.SUCCESS){Log.e("Reminder","語音引擎初始化失敗");complete();return;}
            int language=tts.setLanguage(Locale.TAIWAN);
            if(language==TextToSpeech.LANG_MISSING_DATA||language==TextToSpeech.LANG_NOT_SUPPORTED){Log.e("Reminder","語音引擎缺少繁體中文語音");complete();return;}
            tts.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener(){
                @Override public void onStart(String id){}
                @Override public void onDone(String id){main.post(()->finished(id,false));}
                @Override public void onError(String id){main.post(()->finished(id,true));}
            });
            ready=true;
            enqueue(lines);
        }
        public void add(List<ReminderSyncJob.Speech> extra){if(closed)return;if(ready)enqueue(extra);else lines.addAll(extra);}
        private void enqueue(List<ReminderSyncJob.Speech> extra){
            for(ReminderSyncJob.Speech line:extra){
                synchronized(ReminderStore.LOCK){if(store.spoken(line.key))continue;store.markSpoken(line.key,line.occurs);}
                pending.put(line.key,line);
                int result=tts.speak(line.text,TextToSpeech.QUEUE_ADD,null,line.key);
                if(result==TextToSpeech.ERROR){store.unmarkSpoken(line.key);pending.remove(line.key);Log.e("Reminder","語音排隊失敗");}
            }
            if(pending.isEmpty())complete();
        }
        private void finished(String id,boolean error){if(closed)return;if(error){store.unmarkSpoken(id);Log.e("Reminder","提醒語音播放失敗");}pending.remove(id);if(pending.isEmpty())complete();}
        private void complete(){if(closed)return;close();done.run();}
        public void close(){if(closed)return;closed=true;main.removeCallbacksAndMessages(null);
            if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();
            for(String id:pending.keySet())store.unmarkSpoken(id);pending.clear();if(tts!=null){tts.stop();tts.shutdown();}}
    }
}
