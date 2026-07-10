package com.chamgwenchana.officemobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

public class OfficeWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.office_widget);

        // 지금은 고정 텍스트 (다음 단계에서 실제 데이터로 채움)
        views.setTextViewText(R.id.widget_title, "참괜찮은 사무실");
        views.setTextViewText(R.id.widget_inprogress, "14");
        views.setTextViewText(R.id.widget_need, "3");
        views.setTextViewText(R.id.widget_deadline, "2");
        views.setTextViewText(R.id.widget_todo, "해야 할 일 2건");
        views.setTextViewText(R.id.widget_msg, "안 읽은 쪽지 2건");

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
