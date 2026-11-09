package io.github.nplho98.secretarytool;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.widget.*;
import android.util.Log;

public class PermissionActivity extends Activity {
    private boolean returning;
    public static boolean missing(Context c){
        return (Build.VERSION.SDK_INT>=33&&c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
                || !c.getSystemService(NotificationManager.class).areNotificationsEnabled()
                || (Build.VERSION.SDK_INT>=34&&!c.getSystemService(NotificationManager.class).canUseFullScreenIntent())
                || !Settings.canDrawOverlays(c)
                || (Build.VERSION.SDK_INT>=31&&!c.getSystemService(AlarmManager.class).canScheduleExactAlarms())
                || !c.getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(c.getPackageName());
    }
    @Override protected void onCreate(Bundle state){super.onCreate(state);ReminderService.channel(this);}
    @Override protected void onResume(){super.onResume();if(!missing(this)){backToMain();return;}render();}
    private void render(){
        LinearLayout list=new LinearLayout(this);list.setOrientation(LinearLayout.VERTICAL);list.setPadding(24,24,24,24);
        TextView title=new TextView(this);title.setText("開會與待辦提醒設定");title.setTextSize(22);list.addView(title);
        TextView hint=new TextView(this);hint.setText("請逐項開啟，讓手機鎖定或使用其他應用程式時也能提醒。");list.addView(hint);
        NotificationManager nm=getSystemService(NotificationManager.class);
        button(list,"通知",nm.areNotificationsEnabled()&&(Build.VERSION.SDK_INT<33||checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED),()->{
            if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},80);
            else open(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));
        });
        if(Build.VERSION.SDK_INT>=34)button(list,"全螢幕通知",nm.canUseFullScreenIntent(),()->open(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,Uri.parse("package:"+getPackageName()))));
        button(list,"顯示在其他應用程式上層",Settings.canDrawOverlays(this),()->open(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getPackageName()))));
        if(Build.VERSION.SDK_INT>=31)button(list,"精確鬧鐘",getSystemService(AlarmManager.class).canScheduleExactAlarms(),()->open(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName()))));
        button(list,"忽略電池最佳化",getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName()),()->open(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,Uri.parse("package:"+getPackageName()))));
        Button later=new Button(this);later.setText("稍後");later.setOnClickListener(v->{getSharedPreferences("reminders",MODE_PRIVATE).edit().putBoolean("permissions_later",true).apply();backToMain();});list.addView(later);
        ScrollView scroll=new ScrollView(this);scroll.addView(list);setContentView(scroll);
    }
    private void button(LinearLayout list,String label,boolean granted,Runnable action){Button b=new Button(this);b.setText(label+(granted?"（已完成）":"（開啟設定）"));b.setEnabled(!granted);b.setOnClickListener(v->action.run());list.addView(b);}
    private void open(Intent intent){try{startActivity(intent);}catch(Exception e){Log.e("Reminder","無法開啟權限設定",e);Toast.makeText(this,"無法開啟設定，請從系統設定手動開啟",Toast.LENGTH_LONG).show();}}
    private void backToMain(){if(returning)return;returning=true;ReminderScheduler.schedule(this);ReminderSyncJob.request(this);
        startActivity(new Intent(this,LauncherActivity.class).putExtra("permissions_checked",true));finish();}
    @Override public void onBackPressed(){backToMain();}
}
