package io.github.nplho98.secretarytool;

import android.content.Context;
import android.graphics.PixelFormat;
import android.os.*;
import android.provider.Settings;
import android.util.Log;
import android.view.*;

public final class ReminderOverlay {
    private static final Handler MAIN=new Handler(Looper.getMainLooper());
    private static ReminderContent content;
    private static WindowManager manager;
    private static volatile boolean showing;
    private ReminderOverlay(){}
    private static void main(Runnable action){if(Looper.myLooper()==Looper.getMainLooper())action.run();else MAIN.post(action);}
    public static boolean isShowing(){return showing;}
    public static void show(Context context){Context c=context.getApplicationContext();main(()->{
        if(ReminderActivity.isVisible()||ReminderService.isLocked(c)||!ReminderService.isScreenOn(c)||new ReminderStore(c).alerts().length()==0||!Settings.canDrawOverlays(c)){hide(c);return;}
        if(content!=null){refresh(c);return;}
        try{
            content=new ReminderContent(c,true,()->{refresh(c);ReminderService.syncNow(c);});
            manager=c.getSystemService(WindowManager.class);
            int margin=(int)(24*c.getResources().getDisplayMetrics().density);
            WindowManager.LayoutParams p=new WindowManager.LayoutParams(Math.max(1,c.getResources().getDisplayMetrics().widthPixels-margin*2),WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,PixelFormat.TRANSLUCENT);
            p.gravity=Gravity.CENTER;manager.addView(content.root,p);showing=true;
        }catch(Exception e){Log.e("Reminder","覆蓋視窗顯示失敗",e);content=null;manager=null;showing=false;}
    });}
    public static void refresh(Context context){Context c=context.getApplicationContext();main(()->{
        if(new ReminderStore(c).alerts().length()==0||ReminderActivity.isVisible()||ReminderService.isLocked(c)||!ReminderService.isScreenOn(c)||!Settings.canDrawOverlays(c)){hide(c);return;}
        if(content==null){show(c);return;}
        content.render(c,()->{refresh(c);ReminderService.syncNow(c);});
    });}
    /** 等待視窗完成繪製，才使用可見覆蓋視窗的背景啟動例外。 */
    static void whenVisible(Runnable action){main(()->{
        if(content==null)return;
        View view=content.root;
        view.getViewTreeObserver().addOnDrawListener(new android.view.ViewTreeObserver.OnDrawListener(){
            private boolean drawn;
            @Override public void onDraw(){if(drawn)return;drawn=true;view.post(()->{
                if(view.getViewTreeObserver().isAlive())view.getViewTreeObserver().removeOnDrawListener(this);
                view.postOnAnimation(()->{if(content!=null&&content.root==view&&view.isAttachedToWindow()&&view.isShown())action.run();});
            });}
        });view.invalidate();
    });}
    public static void hide(Context context){main(()->{
        if(content!=null&&manager!=null)try{manager.removeViewImmediate(content.root);}catch(Exception e){Log.e("Reminder","覆蓋視窗移除失敗",e);}
        content=null;manager=null;showing=false;
    });}
}
