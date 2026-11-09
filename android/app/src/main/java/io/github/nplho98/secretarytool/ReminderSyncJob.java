package io.github.nplho98.secretarytool;

import android.app.job.*;
import android.content.*;
import android.util.Log;
import org.json.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;

public class ReminderSyncJob extends JobService {
    private static final int PERIODIC=73,IMMEDIATE=74;
    private static final Object NETWORK_LOCK=new Object();
    private final Set<Integer> stopped=ConcurrentHashMap.newKeySet();
    private final Map<Integer,Future<?>> tasks=new ConcurrentHashMap<>();
    private final Map<Integer,ReminderService.SpeechSession> speeches=new ConcurrentHashMap<>();
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    public static void request(Context c){
        try{
            JobScheduler jobs=c.getSystemService(JobScheduler.class);
            ComponentName name=new ComponentName(c,ReminderSyncJob.class);
            if(jobs.getPendingJob(PERIODIC)==null)jobs.schedule(new JobInfo.Builder(PERIODIC,name).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPeriodic(15*60*1000L).setPersisted(true).build());
            if(jobs.getPendingJob(IMMEDIATE)==null)jobs.schedule(new JobInfo.Builder(IMMEDIATE,name).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setMinimumLatency(0).build());
        }catch(Exception e){Log.e("Reminder","提醒同步排程失敗",e);}
    }
    public static final class Speech {
        public final String key,text;public final long occurs;
        Speech(String key,String text,long occurs){this.key=key;this.text=text;this.occurs=occurs;}
    }
    public static List<Speech> processLocal(Context c){
        ReminderStore store=new ReminderStore(c);Instant now=Instant.now();List<Speech> speeches=new ArrayList<>();
        store.cleanup();
        for(ReminderLogic.Occurrence o:store.occurrences(now))try{
            ReminderLogic.Decision d=ReminderLogic.decide(o,now,ZoneId.systemDefault());
            if(d.ensure)store.addLocal(store.alert(o));
            if(d.soon&&!store.spoken(o.key()+":soon"))speeches.add(new Speech(o.key()+":soon",ReminderLogic.speech(o,d,true),o.occurs.toEpochMilli()));
            if(d.due&&!store.spoken(o.key()+":due"))speeches.add(new Speech(o.key()+":due",ReminderLogic.speech(o,d,false),o.occurs.toEpochMilli()));
        }catch(Exception e){Log.e("Reminder","本機提醒處理失敗",e);}
        return speeches;
    }
    public static void sync(Context c){synchronized(NETWORK_LOCK){
        ReminderStore store=new ReminderStore(c);ReminderApi api=new ReminderApi();
        try{JSONArray meetings=api.meetings(),todos=api.todos();int lead=api.lead();store.cache(meetings,todos,lead);}
        catch(Exception e){Log.e("Reminder","提醒資料更新失敗，使用本機快取",e);}
        processLocal(c);
        JSONArray pending=store.pendingCreates();
        for(int i=0;i<pending.length()&&!Thread.currentThread().isInterrupted();i++)try{
            JSONObject row=pending.getJSONObject(i);api.ensure(row);
            JSONObject remote=api.byOccurrence(row);
            if(remote!=null)store.uploaded(row,remote);
        }catch(Exception e){Log.e("Reminder","提醒紀錄待重送",e);break;}
        JSONObject queue=store.pendingAcks();Iterator<String> keys=queue.keys();
        while(keys.hasNext()&&!Thread.currentThread().isInterrupted())try{
            String key=keys.next();JSONObject row=queue.getJSONObject(key);
            if(row.optBoolean("local_pending")){
                api.ensure(row);JSONObject remote=api.byOccurrence(row);
                if(remote==null)continue;row=remote;
            }
            api.ack(row.getString("id"));store.ackSent(key);
        }catch(Exception e){Log.e("Reminder","離線確認待重送",e);break;}
        try{store.merge(api.unacked());}catch(Exception e){Log.e("Reminder","未確認清單同步失敗",e);}
        ReminderScheduler.schedule(c);
        Log.i("Reminder","sync 結束：會議數="+store.meetingCount()+"，待辦數="+store.todoCount());
        ReminderService.afterSync(c);
    }}
    @Override public boolean onStartJob(JobParameters params){
        final int id=params.getJobId();stopped.remove(id);Log.i("Reminder","onStartJob id="+id);
        tasks.put(id,worker.submit(()->{
            try{
                sync(this);
                if(stopped.contains(id))return;
                List<Speech> lines=processLocal(this);
                getMainExecutorCompat(()->{
                    if(!stopped.contains(id))speeches.put(id,ReminderService.play(this,lines,()->{
                        speeches.remove(id);tasks.remove(id);if(!stopped.contains(id))finishJob(params,false);
                    }));
                });
            }catch(Exception e){Log.e("Reminder","提醒同步作業失敗",e);tasks.remove(id);if(!stopped.contains(id))finishJob(params,true);}
        }));return true;
    }
    private void finishJob(JobParameters params,boolean retry){Log.i("Reminder","jobFinished id="+params.getJobId()+" retry="+retry);jobFinished(params,retry);}
    private void getMainExecutorCompat(Runnable run){new android.os.Handler(android.os.Looper.getMainLooper()).post(run);}
    @Override public boolean onStopJob(JobParameters params){int id=params.getJobId();stopped.add(id);
        Future<?> task=tasks.remove(id);if(task!=null)task.cancel(true);
        ReminderService.SpeechSession speech=speeches.remove(id);if(speech!=null)speech.close();return true;}
    @Override public void onDestroy(){for(ReminderService.SpeechSession speech:speeches.values())speech.close();worker.shutdownNow();super.onDestroy();}
}
