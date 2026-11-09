package io.github.nplho98.secretarytool;
import android.content.*;
import android.util.Log;

public class ReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent intent){
        try{c.startForegroundService(new Intent(c,ReminderService.class));}
        catch(Exception e){Log.e("Reminder","提醒服務啟動失敗",e);ReminderScheduler.schedule(c);ReminderSyncJob.request(c);}
    }
}
