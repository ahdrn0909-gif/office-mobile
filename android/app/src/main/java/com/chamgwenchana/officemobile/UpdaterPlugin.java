package com.chamgwenchana.officemobile;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {

    // 현재 설치된 앱의 버전 정보 반환
    @PluginMethod
    public void getCurrentVersion(PluginCall call) {
        try {
            PackageInfo pInfo = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0);
            long code;
            if (android.os.Build.VERSION.SDK_INT >= 28) {
                code = pInfo.getLongVersionCode();
            } else {
                code = pInfo.versionCode;
            }
            JSObject ret = new JSObject();
            ret.put("versionCode", code);
            ret.put("versionName", pInfo.versionName);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("version error: " + e.getMessage());
        }
    }

    // 원격 텍스트(version.json 등)를 네이티브로 읽기 → CORS 우회
    @PluginMethod
    public void fetchText(PluginCall call) {
        final String url = call.getString("url");
        if (url == null) { call.reject("no url"); return; }
        new Thread(() -> {
            try {
                String text = readUrlAsText(url);
                JSObject ret = new JSObject();
                ret.put("text", text);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("fetch error: " + e.getMessage());
            }
        }).start();
    }

    // APK 다운로드 후 설치 화면 호출
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        if (url == null) { call.reject("no url"); return; }
        new Thread(() -> {
            try {
                File outFile = new File(getContext().getCacheDir(), "update.apk");
                if (outFile.exists()) outFile.delete();

                InputStream in = openWithRedirects(url);
                FileOutputStream out = new FileOutputStream(outFile);
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                out.flush();
                out.close();
                in.close();

                Uri apkUri = FileProvider.getUriForFile(getContext(),
                        getContext().getPackageName() + ".fileprovider", outFile);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);

                call.resolve();
            } catch (Exception e) {
                call.reject("download error: " + e.getMessage());
            }
        }).start();
    }

    // ── 리다이렉트를 수동으로 따라가는 스트림 오픈 (GitHub Release → S3 대응) ──
    private InputStream openWithRedirects(String url) throws Exception {
        String current = url;
        for (int i = 0; i < 5; i++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.connect();
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null) throw new Exception("redirect without location");
                current = loc;
                continue;
            }
            return conn.getInputStream();
        }
        throw new Exception("too many redirects");
    }

    private String readUrlAsText(String url) throws Exception {
        InputStream in = openWithRedirects(url);
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
        in.close();
        return bos.toString("UTF-8");
    }
}
