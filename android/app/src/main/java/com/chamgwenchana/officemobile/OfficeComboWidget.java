package com.chamgwenchana.officemobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;

public class OfficeComboWidget extends AppWidgetProvider {

    private static final String PREFS = "office_combo_widget";
    private static final String KEY_OFFSET = "monthOffset";

    private static final String ACT_PREV_M = "com.chamgwenchana.officemobile.COMBO_PREV_M";
    private static final String ACT_NEXT_M = "com.chamgwenchana.officemobile.COMBO_NEXT_M";
    private static final String ACT_PREV_Y = "com.chamgwenchana.officemobile.COMBO_PREV_Y";
    private static final String ACT_NEXT_Y = "com.chamgwenchana.officemobile.COMBO_NEXT_Y";
    private static final String ACT_TODAY  = "com.chamgwenchana.officemobile.COMBO_TODAY";

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) updateAppWidget(context, mgr, id);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action != null) {
            SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            int offset = p.getInt(KEY_OFFSET, 0);
            boolean changed = true;
            if (ACT_PREV_M.equals(action)) offset -= 1;
            else if (ACT_NEXT_M.equals(action)) offset += 1;
            else if (ACT_PREV_Y.equals(action)) offset -= 12;
            else if (ACT_NEXT_Y.equals(action)) offset += 12;
            else if (ACT_TODAY.equals(action)) offset = 0;
            else changed = false;

            if (changed) {
                p.edit().putInt(KEY_OFFSET, offset).apply();
                AppWidgetManager mgr = AppWidgetManager.getInstance(context);
                int[] ids = mgr.getAppWidgetIds(new ComponentName(context, OfficeComboWidget.class));
                for (int id : ids) updateAppWidget(context, mgr, id);
                return;
            }
        }
        super.onReceive(context, intent);
    }

    static void updateAppWidget(Context context, AppWidgetManager mgr, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.office_combo);

        // ── 요약 5칩 ──
        int inProgress = 0, needCheck = 0, deadline = 0, todo = 0, unread = 0;
        try {
            SharedPreferences cap = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            String json = cap.getString("officeWidgetSummary", null);
            if (json != null) {
                JSONObject o = new JSONObject(json);
                inProgress = o.optInt("inProgress", 0);
                needCheck = o.optInt("needCheck", 0);
                deadline = o.optInt("deadline", 0);
                todo = o.optInt("todo", 0);
                unread = o.optInt("unread", 0);
            }
        } catch (Exception e) { /* 기본값 */ }
        views.setTextViewText(R.id.cc_inprogress, String.valueOf(inProgress));
        views.setTextViewText(R.id.cc_need, String.valueOf(needCheck));
        views.setTextViewText(R.id.cc_deadline, String.valueOf(deadline));
        views.setTextViewText(R.id.cc_todo, String.valueOf(todo));
        views.setTextViewText(R.id.cc_msg, String.valueOf(unread));

        // ── 달력 ──
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int offset = p.getInt(KEY_OFFSET, 0);

        Calendar disp = Calendar.getInstance();
        disp.set(Calendar.DAY_OF_MONTH, 1);
        disp.add(Calendar.MONTH, offset);
        int dispYear = disp.get(Calendar.YEAR);
        int dispMonth = disp.get(Calendar.MONTH);
        views.setTextViewText(R.id.cc_title, dispYear + "년 " + (dispMonth + 1) + "월");

        JSONObject data = null;
        try {
            SharedPreferences cap = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            String json = cap.getString("officeCalendarData", null);
            if (json != null) data = new JSONObject(json);
        } catch (Exception e) { data = null; }

        Calendar gridStart = (Calendar) disp.clone();
        int wd = gridStart.get(Calendar.DAY_OF_WEEK);
        gridStart.add(Calendar.DAY_OF_MONTH, -(wd - 1));

        Calendar today = Calendar.getInstance();
        int tY = today.get(Calendar.YEAR), tM = today.get(Calendar.MONTH), tD = today.get(Calendar.DAY_OF_MONTH);

        Calendar cur = (Calendar) gridStart.clone();
        for (int i = 0; i < 42; i++) {
            int cy = cur.get(Calendar.YEAR);
            int cm = cur.get(Calendar.MONTH);
            int cd = cur.get(Calendar.DAY_OF_MONTH);
            int cw = cur.get(Calendar.DAY_OF_WEEK);
            boolean inMonth = (cm == dispMonth);
            boolean isToday = (cy == tY && cm == tM && cd == tD);

            int dayId = resId(context, "cc_day_" + i);
            views.setTextViewText(dayId, String.valueOf(cd));

            int color;
            if (!inMonth) color = 0xFF55555A;
            else if (isToday) color = 0xFF8AB4F8;
            else if (cw == 1) color = 0xFFFF6B6B;
            else if (cw == 7) color = 0xFF7AA7FF;
            else color = 0xFFE8E8EA;
            views.setTextColor(dayId, color);

            // 이전 달/렌더의 잔재 제거 — 이 칸의 막대·더보기를 먼저 모두 숨김
            for (int b = 0; b < 3; b++) {
                views.setViewVisibility(resId(context, "cc_bar_" + i + "_" + b), android.view.View.GONE);
            }
            views.setViewVisibility(resId(context, "cc_more_" + i), android.view.View.GONE);

            String dateKey = String.format(Locale.US, "%04d-%02d-%02d", cy, cm + 1, cd);
            int shown = 0, total = 0;
            if (data != null) {
                JSONArray arr = data.optJSONArray(dateKey);
                if (arr != null) {
                    total = arr.length();
                    for (int b = 0; b < 3 && b < arr.length(); b++) {
                        JSONObject ev = arr.optJSONObject(b);
                        if (ev == null) continue;
                        int barId = resId(context, "cc_bar_" + i + "_" + b);
                        String t = ev.optString("t", "");
                        String c = ev.optString("c", "#888888");
                        boolean allDay = ev.optInt("a", 0) == 1;
                        int col;
                        try { col = Color.parseColor(c); } catch (Exception e) { col = 0xFF888888; }
                        if (allDay) {
                            views.setTextViewText(barId, t);
                            views.setTextColor(barId, 0xFFFFFFFF);
                            views.setInt(barId, "setBackgroundColor", col);
                        } else {
                            android.text.SpannableStringBuilder sb =
                                    new android.text.SpannableStringBuilder("\u25CF " + t);
                            sb.setSpan(new android.text.style.ForegroundColorSpan(col),
                                    0, 1, android.text.Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
                            views.setTextViewText(barId, sb);
                            views.setTextColor(barId, 0xFFE8E8EA);
                            views.setInt(barId, "setBackgroundColor", 0x00000000);
                        }
                        views.setViewVisibility(barId, android.view.View.VISIBLE);
                        shown++;
                    }
                }
            }
            if (total > shown) {
                int moreId = resId(context, "cc_more_" + i);
                views.setTextViewText(moreId, "+" + (total - shown));
                views.setViewVisibility(moreId, android.view.View.VISIBLE);
            }

            cur.add(Calendar.DAY_OF_MONTH, 1);
        }

        views.setOnClickPendingIntent(R.id.cc_prev_y, navIntent(context, ACT_PREV_Y, 301));
        views.setOnClickPendingIntent(R.id.cc_prev_m, navIntent(context, ACT_PREV_M, 302));
        views.setOnClickPendingIntent(R.id.cc_next_m, navIntent(context, ACT_NEXT_M, 303));
        views.setOnClickPendingIntent(R.id.cc_next_y, navIntent(context, ACT_NEXT_Y, 304));
        views.setOnClickPendingIntent(R.id.cc_today,  navIntent(context, ACT_TODAY,  305));

        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open != null) {
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getActivity(context, 300, open, flags);
            views.setOnClickPendingIntent(R.id.cc_grid, pi);
        }

        mgr.updateAppWidget(appWidgetId, views);
    }

    private static PendingIntent navIntent(Context context, String action, int reqCode) {
        Intent i = new Intent(context, OfficeComboWidget.class);
        i.setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, reqCode, i, flags);
    }

    private static int resId(Context context, String name) {
        return context.getResources().getIdentifier(name, "id", context.getPackageName());
    }
}
