package io.github.nplho98.secretarytool;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

public final class ReminderApi {
    // 與 pwa/config.js 的公開設定相同；不含服務端私密金鑰。
    private static final String URL="https://pbyopyfullvyoviaugmf.supabase.co/rest/v1/";
    private static final String KEY="sb_publishable_tnJNdh3XRVaZW6n-r3OXcA_2y6hZACa";
    private String request(String method,String path,JSONObject body,String prefer) throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(URL+path).openConnection();
        c.setConnectTimeout(10000); c.setReadTimeout(10000); c.setRequestMethod(method);
        c.setRequestProperty("apikey",KEY); c.setRequestProperty("Authorization","Bearer "+KEY);
        c.setRequestProperty("Content-Type","application/json; charset=utf-8");
        if(prefer!=null)c.setRequestProperty("Prefer",prefer);
        try {
            if(body!=null) {
                c.setDoOutput(true);
                try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}
            }
            int status=c.getResponseCode();
            if(status<200 || status>=300) throw new IOException("提醒資料存取失敗 HTTP "+status);
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                byte[] buffer=new byte[4096]; int n;
                while((n=in.read(buffer))!=-1)out.write(buffer,0,n);
                return new String(out.toByteArray(),StandardCharsets.UTF_8);
            }
        } finally { c.disconnect(); }
    }
    public JSONArray meetings() throws Exception {return new JSONArray(request("GET","meeting_reminders?enabled=eq.true&select=*",null,null));}
    public JSONArray todos() throws Exception {return new JSONArray(request("GET","todos?done=eq.false&due_date=not.is.null&select=*",null,null));}
    public int lead() throws Exception {
        JSONArray rows=new JSONArray(request("GET","secretary_settings?id=eq.1&select=todo_lead_minutes",null,null));
        return rows.length()==0?10:rows.getJSONObject(0).getInt("todo_lead_minutes");
    }
    public void ensure(JSONObject alert) throws Exception {
        JSONObject body=new JSONObject();
        for(String key:new String[]{"id","kind","source_id","title","occurs_at","lead_minutes"})body.put(key,alert.get(key));
        body.put("created_by","android");
        request("POST","reminder_alerts?on_conflict=kind,source_id,occurs_at",body,"resolution=ignore-duplicates,return=minimal");
    }
    public JSONArray unacked() throws Exception {return new JSONArray(request("GET","reminder_alerts?acknowledged_at=is.null&select=*&order=occurs_at.asc",null,null));}
    public void ack(String id) throws Exception {
        request("PATCH","reminder_alerts?id=eq."+URLEncoder.encode(id,"UTF-8")+"&acknowledged_at=is.null",
                new JSONObject().put("acknowledged_at",Instant.now().toString()),"return=minimal");
    }
    public JSONObject byOccurrence(JSONObject alert) throws Exception {
        String path="reminder_alerts?select=*&kind=eq."+alert.getString("kind")+"&source_id=eq."+alert.getString("source_id")+
                "&occurs_at=eq."+URLEncoder.encode(alert.getString("occurs_at"),"UTF-8");
        JSONArray rows=new JSONArray(request("GET",path,null,null));
        return rows.length()==0?null:rows.getJSONObject(0);
    }
}
