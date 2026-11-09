package io.github.nplho98.secretarytool;

import android.content.*;
import org.json.*;
import java.time.*;
import java.util.*;
import java.nio.charset.StandardCharsets;

public final class ReminderStore {
    public static final Object LOCK=new Object();
    private final SharedPreferences prefs;
    public ReminderStore(Context c){prefs=c.getSharedPreferences("reminders",Context.MODE_PRIVATE);}
    private JSONArray array(String key){try{return new JSONArray(prefs.getString(key,"[]"));}catch(Exception e){return new JSONArray();}}
    private JSONObject object(String key){try{return new JSONObject(prefs.getString(key,"{}"));}catch(Exception e){return new JSONObject();}}
    public void cache(JSONArray meetings,JSONArray todos,int lead){synchronized(LOCK){prefs.edit().putString("meetings",meetings.toString()).putString("todos",todos.toString()).putInt("lead",lead).commit();}}
    public List<ReminderLogic.Occurrence> occurrences(Instant now){
        synchronized(LOCK){
            List<ReminderLogic.Source> sources=new ArrayList<>();
            for(String kind:new String[]{"meeting","todo"}) {
                JSONArray rows=array("meeting".equals(kind)?"meetings":"todos");
                for(int i=0;i<rows.length();i++)try{
                    JSONObject row=rows.getJSONObject(i);ReminderLogic.Source s=new ReminderLogic.Source();
                    s.kind=kind;s.id=row.getString("id");s.title=row.getString("title");
                    if("meeting".equals(kind)){
                        s.enabled=row.optBoolean("enabled",true);s.time=row.getString("meeting_time");s.lead=row.optInt("lead_minutes",10);
                        s.updated=ReminderLogic.parseInstant(row.getString("updated_at"));JSONArray days=row.getJSONArray("weekdays");
                        for(int j=0;j<days.length();j++)s.weekdays.add(days.getInt(j));
                        JSONArray monthWeeks=row.optJSONArray("month_weeks");
                        if(monthWeeks!=null)for(int j=0;j<monthWeeks.length();j++)s.monthWeeks.add(monthWeeks.getInt(j));
                    }else{
                        s.done=row.optBoolean("done");s.created=ReminderLogic.parseInstant(row.getString("created_at"));
                        if(!row.isNull("due_date"))s.due=ReminderLogic.parseInstant(row.getString("due_date"));
                    }
                    sources.add(s);
                }catch(Exception e){android.util.Log.e("Reminder","提醒來源格式錯誤",e);}
            }
            return ReminderLogic.occurrences(sources,prefs.getInt("lead",10),now,ZoneId.systemDefault());
        }
    }
    public static String key(JSONObject row)throws JSONException{
        return row.getString("kind")+":"+row.getString("source_id")+":"+ReminderLogic.parseInstant(row.getString("occurs_at")).toEpochMilli();
    }
    public JSONObject alert(ReminderLogic.Occurrence o)throws JSONException{
        return new JSONObject().put("id",UUID.nameUUIDFromBytes(o.key().getBytes(StandardCharsets.UTF_8)).toString())
                .put("kind",o.kind).put("source_id",o.sourceId).put("title",o.title).put("occurs_at",o.occurs.toString())
                .put("lead_minutes",o.lead).put("local_pending",true);
    }
    public void addLocal(JSONObject row)throws JSONException{synchronized(LOCK){
        String k=key(row);if(object("confirmed").has(k))return;
        JSONArray rows=array("alerts");for(int i=0;i<rows.length();i++)if(key(rows.getJSONObject(i)).equals(k))return;
        rows.put(row);prefs.edit().putString("alerts",rows.toString()).commit();
    }}
    public JSONArray alerts(){synchronized(LOCK){
        JSONArray result=new JSONArray();JSONObject confirmed=object("confirmed");JSONArray all=array("alerts");
        List<JSONObject> sorted=new ArrayList<>();
        for(int i=0;i<all.length();i++)try{JSONObject row=all.getJSONObject(i);if(!confirmed.has(key(row)))sorted.add(row);}catch(Exception ignored){}
        sorted.sort(Comparator.comparing(row->ReminderLogic.parseInstant(row.optString("occurs_at"))));
        for(JSONObject row:sorted)result.put(row);return result;
    }}
    public JSONArray pendingCreates(){synchronized(LOCK){JSONArray result=new JSONArray(),rows=array("alerts");
        for(int i=0;i<rows.length();i++){JSONObject row=rows.optJSONObject(i);if(row!=null&&row.optBoolean("local_pending"))result.put(row);}return result;
    }}
    public void uploaded(JSONObject local,JSONObject remote)throws JSONException{synchronized(LOCK){
        JSONArray rows=array("alerts"),next=new JSONArray();String k=key(local);
        for(int i=0;i<rows.length();i++)if(!key(rows.getJSONObject(i)).equals(k))next.put(rows.get(i));
        if(remote!=null && remote.isNull("acknowledged_at") && !object("confirmed").has(k))next.put(remote);
        // 若本機先離線確認，伺服器主鍵可能是電腦建立的，保留新主鍵供重送。
        JSONObject queue=object("pending_ack");
        if(queue.has(k) && remote!=null){remote.put("local_pending",false);queue.put(k,remote);}
        JSONObject confirmed=object("confirmed");
        if(remote!=null&&!remote.isNull("acknowledged_at"))confirmed.put(k,ReminderLogic.parseInstant(remote.getString("occurs_at")).toEpochMilli());
        prefs.edit().putString("alerts",next.toString()).putString("pending_ack",queue.toString()).putString("confirmed",confirmed.toString()).commit();
    }}
    public void merge(JSONArray remote)throws JSONException{synchronized(LOCK){
        JSONArray next=new JSONArray();Set<String> keys=new HashSet<>();JSONObject confirmed=object("confirmed");
        for(int i=0;i<remote.length();i++){JSONObject row=remote.getJSONObject(i);String k=key(row);keys.add(k);if(!confirmed.has(k))next.put(row);}
        JSONArray local=array("alerts");for(int i=0;i<local.length();i++){JSONObject row=local.getJSONObject(i);String k=key(row);
            if(!keys.contains(k)){
                if(row.optBoolean("local_pending")&&!confirmed.has(k))next.put(row);
                else if(!row.optBoolean("local_pending"))confirmed.put(k,ReminderLogic.parseInstant(row.getString("occurs_at")).toEpochMilli());
            }}
        prefs.edit().putString("alerts",next.toString()).putString("confirmed",confirmed.toString()).commit();
    }}
    public void acknowledge(JSONObject row)throws JSONException{synchronized(LOCK){
        String k=key(row);JSONObject confirmed=object("confirmed"),queue=object("pending_ack");
        confirmed.put(k,ReminderLogic.parseInstant(row.getString("occurs_at")).toEpochMilli());queue.put(k,row);
        prefs.edit().putString("confirmed",confirmed.toString()).putString("pending_ack",queue.toString()).commit();
    }}
    public JSONObject pendingAcks(){synchronized(LOCK){return object("pending_ack");}}
    public void ackSent(String k){synchronized(LOCK){JSONObject queue=object("pending_ack");queue.remove(k);prefs.edit().putString("pending_ack",queue.toString()).commit();}}
    public boolean spoken(String key){synchronized(LOCK){return object("spoken").has(key);}}
    public void markSpoken(String key,long occurs){synchronized(LOCK){try{
        JSONObject rows=object("spoken");rows.put(key,occurs);prefs.edit().putString("spoken",rows.toString()).commit();
    }catch(JSONException e){throw new IllegalStateException(e);}}}
    public void unmarkSpoken(String key){synchronized(LOCK){JSONObject rows=object("spoken");rows.remove(key);prefs.edit().putString("spoken",rows.toString()).commit();}}
    public void cleanup(){synchronized(LOCK){long cutoff=System.currentTimeMillis()-172800000L;
        for(String name:new String[]{"spoken","confirmed"}){JSONObject rows=object(name);List<String> remove=new ArrayList<>();
            Iterator<String> keys=rows.keys();while(keys.hasNext()){String k=keys.next();if(rows.optLong(k)<cutoff&&!object("pending_ack").has(k))remove.add(k);}
            for(String k:remove)rows.remove(k);prefs.edit().putString(name,rows.toString()).commit();}
    }}
}
