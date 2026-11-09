package io.github.nplho98.secretarytool;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.os.*;
import android.provider.Settings;
import android.speech.tts.*;
import android.util.Log;
import org.json.JSONArray;
import java.util.*;
import java.util.concurrent.*;

public class ReminderService extends Service {
    public static final String CHANNEL="meeting_reminders";
    public static final int ALERT_NOTIFICATION=76, SERVICE_NOTIFICATION=77;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private SpeechSession speech;
    private boolean running;
    private PowerManager.WakeLock wakeLock;
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
    public static void showAlerts(Context c,boolean open){
        channel(c);NotificationManager manager=c.getSystemService(NotificationManager.class);
        JSONArray rows=new ReminderStore(c).alerts();
        if(rows.length()==0){manager.cancel(ALERT_NOTIFICATION);return;}
        try{manager.notify(ALERT_NOTIFICATION,notification(c,"未確認 "+rows.length()+" 筆",true));}
        catch(SecurityException e){Log.e("Reminder","請啟用通知權限",e);}
        if(open&&Settings.canDrawOverlays(c))try{
            c.startActivity(new Intent(c,ReminderActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP));
        }catch(Exception e){Log.e("Reminder","提醒畫面開啟失敗",e);}
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        channel(this);Notification n=notification(this,"正在檢查提醒事項",false);
        if(Build.VERSION.SDK_INT>=34)startForeground(SERVICE_NOTIFICATION,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
        else startForeground(SERVICE_NOTIFICATION,n);
        if(running){
            worker.submit(()->{
                List<ReminderSyncJob.Speech> lines=ReminderSyncJob.processLocal(this);
                showAlerts(this,true);ReminderScheduler.schedule(this);
                handler.post(()->{if(running&&speech!=null)speech.add(lines);});
            });
            return START_NOT_STICKY;
        }
        running=true;
        wakeLock=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"secretarytool:reminder");
        wakeLock.acquire(150000L);
        handler.postDelayed(this::finish,145000L);
        worker.submit(()->{
            try{
                List<ReminderSyncJob.Speech> lines=ReminderSyncJob.processLocal(this);
                showAlerts(this,true);
                ReminderScheduler.schedule(this);
                // 語音先依快取播放，不讓離線連線逾時拖延鬧鐘。
                handler.post(()->speech=play(this,lines,this::finish));
                ReminderSyncJob.request(this);
            }catch(Exception e){Log.e("Reminder","提醒服務處理失敗",e);handler.post(this::finish);}
        });return START_NOT_STICKY;
    }
    private void finish(){
        if(!running)return;running=false;
        if(speech!=null)speech.close();handler.removeCallbacksAndMessages(null);
        ReminderScheduler.schedule(this);stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();
    }
    @Override public void onTimeout(int startId){finish();}
    @Override public void onTimeout(int startId,int fgsType){finish();}
    @Override public void onDestroy(){running=false;handler.removeCallbacksAndMessages(null);if(speech!=null)speech.close();
        if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();worker.shutdownNow();super.onDestroy();}
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
        SpeechSession(Context c,List<ReminderSyncJob.Speech> lines,Runnable done){context=c.getApplicationContext();store=new ReminderStore(c);this.lines=new ArrayList<>(lines);this.done=done;}
        void start(){
            if(lines.isEmpty()){main.post(this::complete);return;}
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
            for(String id:pending.keySet())store.unmarkSpoken(id);pending.clear();if(tts!=null){tts.stop();tts.shutdown();}}
    }
}
