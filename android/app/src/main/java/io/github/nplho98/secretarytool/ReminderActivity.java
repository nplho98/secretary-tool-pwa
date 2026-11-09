package io.github.nplho98.secretarytool;
import android.app.*;
import android.os.*;
import android.view.*;
import android.util.Log;
import java.util.concurrent.*;

public class ReminderActivity extends Activity {
    private static volatile boolean visible;
    public static boolean isVisible(){return visible;}
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private ReminderContent content;
    private boolean active,busy;
    private final Runnable poll=new Runnable(){public void run(){if(!active)return;render();refresh();handler.postDelayed(this,5000);}};
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        if(Build.VERSION.SDK_INT>=27){setShowWhenLocked(true);setTurnScreenOn(true);}
        else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED|WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        content=new ReminderContent(this,false,()->{render();refresh();});
        setContentView(content.root);ReminderContent.applyInsets(content.root,content.heading);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        if(Build.VERSION.SDK_INT>=30)getWindow().getInsetsController().setSystemBarsAppearance(0,android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,()->{});
    }
    @Override protected void onResume(){super.onResume();visible=true;active=true;ReminderOverlay.hide(this);handler.post(poll);}
    @Override protected void onPause(){visible=false;active=false;handler.removeCallbacks(poll);super.onPause();ReminderService.showAlerts(this,false);}
    @Override public void onBackPressed(){}
    private void refresh(){
        if(busy||worker.isShutdown())return;busy=true;
        worker.submit(()->{try{ReminderSyncJob.sync(this);}catch(Exception e){Log.e("Reminder","提醒視窗更新失敗",e);}
            handler.post(()->{busy=false;if(active)render();});});
    }
    private void render(){
        if(new ReminderStore(this).alerts().length()==0){ReminderService.stop(this);finish();return;}
        content.render(this,()->{render();refresh();});
    }
    @Override protected void onDestroy(){active=false;handler.removeCallbacksAndMessages(null);worker.shutdownNow();super.onDestroy();}
}
