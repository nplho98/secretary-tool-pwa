package io.github.nplho98.secretarytool;

import android.app.*;
import android.os.*;
import android.graphics.Color;
import android.view.*;
import android.widget.*;
import android.util.Log;
import org.json.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.*;

public class ReminderActivity extends Activity {
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private LinearLayout list;private TextView heading;private boolean active,busy;
    private final Runnable poll=new Runnable(){public void run(){if(!active)return;render();refresh();handler.postDelayed(this,5000);}};
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        if(Build.VERSION.SDK_INT>=27){setShowWhenLocked(true);setTurnScreenOn(true);}
        else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED|WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.rgb(238,241,245));
        heading=new TextView(this);heading.setTextColor(Color.WHITE);heading.setBackgroundColor(Color.rgb(163,20,77));heading.setTextSize(20);heading.setPadding(24,24,24,24);root.addView(heading);
        ScrollView scroll=new ScrollView(this);list=new LinearLayout(this);list.setPadding(20,12,20,12);list.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(list);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,()->{});
    }
    @Override protected void onResume(){super.onResume();active=true;handler.post(poll);}
    @Override protected void onPause(){active=false;handler.removeCallbacks(poll);super.onPause();}
    @Override public void onBackPressed(){}
    private void refresh(){
        if(busy)return;busy=true;
        worker.submit(()->{try{ReminderSyncJob.sync(this);}catch(Exception e){Log.e("Reminder","提醒視窗更新失敗",e);}
            handler.post(()->{busy=false;if(active)render();});});
    }
    private void render(){
        JSONArray rows=new ReminderStore(this).alerts();
        if(rows.length()==0){getSystemService(NotificationManager.class).cancel(ReminderService.ALERT_NOTIFICATION);finish();return;}
        heading.setText("提醒事項（未確認 "+rows.length()+" 筆）");list.removeAllViews();
        for(int i=0;i<rows.length();i++)try{
            JSONObject row=rows.getJSONObject(i);boolean todo="todo".equals(row.getString("kind"));
            ZonedDateTime occurs=ReminderLogic.parseInstant(row.getString("occurs_at")).atZone(ZoneId.systemDefault());
            String stamp=occurs.format(DateTimeFormatter.ofPattern("MM/dd"))+"（週"+"一二三四五六日".charAt(occurs.getDayOfWeek().getValue()-1)+"）"+occurs.format(DateTimeFormatter.ofPattern("HH:mm"));
            LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(20,16,20,16);card.setBackgroundColor(Color.WHITE);
            LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(-1,-2);cp.bottomMargin=16;list.addView(card,cp);
            TextView title=new TextView(this);title.setText((todo?"待辦：":"")+row.getString("title")+"　"+stamp);title.setTextSize(17);title.setTextColor(Color.rgb(32,36,42));card.addView(title);
            LinearLayout line=new LinearLayout(this);line.setGravity(Gravity.CENTER_VERTICAL);
            TextView remaining=new TextView(this);long delta=occurs.toInstant().toEpochMilli()-System.currentTimeMillis();
            remaining.setText(delta<=0?(todo?"已到期":"已開始"):"再 "+Math.max(1,Math.round(delta/60000.0))+" 分鐘"+(todo?"到期":"開始"));
            remaining.setTextColor(Color.DKGRAY);line.addView(remaining,new LinearLayout.LayoutParams(0,-2,1));
            Button confirm=new Button(this);confirm.setText("確認");confirm.setTextColor(Color.WHITE);confirm.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(21,101,192)));
            confirm.setOnClickListener(v->{try{
                new ReminderStore(this).acknowledge(row);render();ReminderService.showAlerts(this,false);refresh();ReminderSyncJob.request(this);
            }catch(Exception e){remaining.setText("確認失敗，請再按一次");Log.e("Reminder","本機確認儲存失敗",e);}});
            line.addView(confirm);card.addView(line);
        }catch(Exception e){Log.e("Reminder","提醒畫面資料格式錯誤",e);}
    }
    @Override protected void onDestroy(){active=false;handler.removeCallbacksAndMessages(null);worker.shutdownNow();super.onDestroy();}
}
