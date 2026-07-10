package com.chamgwenchana.officemobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONObject;

public class OfficeWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.office_widget);

        // 기본값 (앱이 아직 데이터를 저장하지 않았을 때)
        int inProgress = 0, needCheck = 0, deadline = 0, todo = 0, unread = 0;

        // 앱(React)이 Capacitor Preferences로 저장한 요약 읽기.
        // @capacitor/preferences 는 안드로이드에서 SharedPreferences 파일 "CapacitorStorage" 에 키를 그대로 저장한다.
        try {
            SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            String json = prefs.getString("officeWidgetSummary", null);
            if (json != null) {
                JSONObject o = new JSONObject(json);
                inProgress = o.optInt("inProgress", 0);
                needCheck = o.optInt("needCheck", 0);
                deadline = o.optInt("deadline", 0);
                todo = o.optInt("todo", 0);
                unread = o.optInt("unread", 0);
            }
        } catch (Exception e) {
            // 파싱 실패 시 기본값(0) 유지
        }

        views.setTextViewText(R.id.widget_title, "참괜찮은 사무실");
        views.setTextViewText(R.id.widget_inprogress, String.valueOf(inProgress));
        views.setTextViewText(R.id.widget_need, String.valueOf(needCheck));
        views.setTextViewText(R.id.widget_deadline, String.valueOf(deadline));
        views.setTextViewText(R.id.widget_todo, "해야 할 일 " + todo + "건");
        views.setTextViewText(R.id.widget_msg, "안 읽은 쪽지 " + unread + "건");

        // 위젯 탭하면 앱 열기
        Intent intent = context.getPackageManager()
                .getLaunchIntentForPackage(context.getPackageName());
        if (intent != null) {
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pending = PendingIntent.getActivity(context, 0, intent, flags);
            views.setOnClickPendingIntent(R.id.widget_root, pending);
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
