package io.github.nplho98.secretarytool;
import android.content.*;

public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent intent){
        if(!ReminderSyncJob.processLocal(c).isEmpty()) {
            try{c.startForegroundService(new Intent(c,ReminderService.class));}
            catch(Exception e){android.util.Log.e("Reminder","開機提醒服務啟動失敗",e);}
        }
        ReminderService.showAlerts(c,false);
        ReminderScheduler.schedule(c);ReminderSyncJob.request(c);
    }
}
