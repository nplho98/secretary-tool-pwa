package io.github.nplho98.secretarytool;

import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.util.Log;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.time.*;
import java.time.format.DateTimeFormatter;

/** 兩種提醒視窗共用畫面及本機確認流程。 */
final class ReminderContent {
    final LinearLayout root,list;
    final TextView heading;
    ReminderContent(Context c,boolean overlay,Runnable changed){
        root=new LinearLayout(c);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.rgb(238,241,245));
        heading=new TextView(c);heading.setTextColor(Color.WHITE);heading.setBackgroundColor(Color.rgb(163,20,77));heading.setTextSize(20);heading.setPadding(24,24,24,24);root.addView(heading);
        ScrollView scroll=overlay?new LimitedScrollView(c):new ScrollView(c);
        list=new LinearLayout(c);list.setPadding(20,12,20,12);list.setOrientation(LinearLayout.VERTICAL);scroll.addView(list);
        root.addView(scroll,new LinearLayout.LayoutParams(-1,overlay?-2:0,overlay?0:1));
        render(c,changed);
    }
    void render(Context c,Runnable changed){
        JSONArray rows=new ReminderStore(c).alerts();
        heading.setText("提醒事項（未確認 "+rows.length()+" 筆）");list.removeAllViews();
        for(int i=0;i<rows.length();i++)try{
            JSONObject row=rows.getJSONObject(i);boolean todo="todo".equals(row.getString("kind"));
            ZonedDateTime occurs=ReminderLogic.parseInstant(row.getString("occurs_at")).atZone(ZoneId.systemDefault());
            String stamp=occurs.format(DateTimeFormatter.ofPattern("MM/dd"))+"（週"+"一二三四五六日".charAt(occurs.getDayOfWeek().getValue()-1)+"）"+occurs.format(DateTimeFormatter.ofPattern("HH:mm"));
            LinearLayout card=new LinearLayout(c);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(20,16,20,16);card.setBackgroundColor(Color.WHITE);
            LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(-1,-2);cp.bottomMargin=16;list.addView(card,cp);
            TextView title=new TextView(c);title.setText((todo?"待辦：":"")+row.getString("title")+"　"+stamp);title.setTextSize(17);title.setTextColor(Color.rgb(32,36,42));card.addView(title);
            LinearLayout line=new LinearLayout(c);line.setGravity(Gravity.CENTER_VERTICAL);
            TextView remaining=new TextView(c);long delta=occurs.toInstant().toEpochMilli()-System.currentTimeMillis();
            remaining.setText(delta<=0?(todo?"已到期":"已開始"):"再 "+Math.max(1,Math.round(delta/60000.0))+" 分鐘"+(todo?"到期":"開始"));
            remaining.setTextColor(Color.DKGRAY);line.addView(remaining,new LinearLayout.LayoutParams(0,-2,1));
            Button confirm=new Button(c);confirm.setText("確認");confirm.setTextColor(Color.WHITE);confirm.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(21,101,192)));
            confirm.setOnClickListener(v->{try{
                new ReminderStore(c).acknowledge(row);changed.run();ReminderService.showAlerts(c,false);ReminderSyncJob.request(c);
            }catch(Exception e){remaining.setText("確認失敗，請再按一次");Log.e("Reminder","本機確認儲存失敗",e);}});
            line.addView(confirm);card.addView(line);
        }catch(Exception e){Log.e("Reminder","提醒畫面資料格式錯誤",e);}
    }
    static void applyInsets(View root,TextView heading){
        int left=root.getPaddingLeft(),top=root.getPaddingTop(),right=root.getPaddingRight(),bottom=root.getPaddingBottom();
        int hl=heading.getPaddingLeft(),ht=heading.getPaddingTop(),hr=heading.getPaddingRight(),hb=heading.getPaddingBottom();
        root.setOnApplyWindowInsetsListener((v,insets)->{
            int l,t,r,b;
            if(Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());l=bars.left;t=bars.top;r=bars.right;b=bars.bottom;}
            else{l=insets.getSystemWindowInsetLeft();t=insets.getSystemWindowInsetTop();r=insets.getSystemWindowInsetRight();b=insets.getSystemWindowInsetBottom();}
            v.setPadding(left+l,top,right+r,bottom+b);heading.setPadding(hl,ht+t,hr,hb);return insets;
        });root.requestApplyInsets();
    }
    private static final class LimitedScrollView extends ScrollView {
        LimitedScrollView(Context c){super(c);}
        @Override protected void onMeasure(int width,int height){
            int max=(int)(getResources().getDisplayMetrics().heightPixels*.6f);
            ViewGroup parent=(ViewGroup)getParent();max=Math.max(1,max-parent.getChildAt(0).getMeasuredHeight());
            super.onMeasure(width,MeasureSpec.makeMeasureSpec(MeasureSpec.getMode(height)==MeasureSpec.UNSPECIFIED?max:Math.min(max,MeasureSpec.getSize(height)),MeasureSpec.AT_MOST));
        }
    }
}
