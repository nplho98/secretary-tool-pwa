package io.github.nplho98.secretarytool;

import android.app.*;
import android.content.*;
import android.os.Build;
import android.util.Log;
import java.time.*;

public final class ReminderScheduler {
    private ReminderScheduler(){}
    public static void schedule(Context c){
        try{
            AlarmManager alarm=c.getSystemService(AlarmManager.class);
            PendingIntent event=PendingIntent.getBroadcast(c,71,new Intent(c,ReminderReceiver.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            alarm.cancel(event);
            if(Build.VERSION.SDK_INT>=31&&!alarm.canScheduleExactAlarms())return;
            Instant now=Instant.now();
            Instant next=ReminderLogic.nextEvent(new ReminderStore(c).occurrences(now),now,ZoneId.systemDefault());
            PendingIntent show=PendingIntent.getActivity(c,72,new Intent(c,LauncherActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            alarm.setAlarmClock(new AlarmManager.AlarmClockInfo(next.toEpochMilli(),show),event);
        }catch(Exception e){Log.e("Reminder","精確提醒排程失敗",e);}
    }
}
