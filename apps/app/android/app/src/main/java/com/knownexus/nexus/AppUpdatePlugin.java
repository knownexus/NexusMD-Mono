package com.knownexus.nexus;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Updates the app from a GitHub release APK, for installs that did not come from Google Play (a Play
 * install is re-signed by Play, so a release APK could not replace it, and Play updates it anyway).
 * Android still asks the user to confirm each install; this only downloads the APK and hands it over.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    // Only this repository's release assets are downloaded, whatever the web side asks for.
    private static final String ALLOWED_PREFIX = "https://github.com/knownexus/NexusMD-Mono/releases/download/";
    private static final long MAX_BYTES = 200L * 1024 * 1024;

    @PluginMethod
    public void getInfo(PluginCall call) {
        Context ctx = getContext();
        try {
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            String installer = Build.VERSION.SDK_INT >= 30
                ? ctx.getPackageManager().getInstallSourceInfo(ctx.getPackageName()).getInstallingPackageName()
                : ctx.getPackageManager().getInstallerPackageName(ctx.getPackageName());
            JSObject out = new JSObject();
            out.put("versionName", info.versionName);
            out.put("installer", installer == null ? "" : installer);
            out.put("fromPlay", "com.android.vending".equals(installer));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Could not read the app version.");
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith(ALLOWED_PREFIX)) {
            call.reject("Not an update from this project's releases.", "bad-url");
            return;
        }
        Context ctx = getContext();
        if (!ctx.getPackageManager().canRequestPackageInstalls()) {
            // Send the user to the "install unknown apps" switch for this app; they retry afterwards.
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(settings);
            call.reject("Allow this app to install updates, then try again.", "needs-permission");
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(ctx.getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("no cache folder");
                File apk = new File(dir, "update.apk");
                download(url, apk);
                Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(install);
                call.resolve();
            } catch (Exception e) {
                call.reject("Download failed: " + e.getMessage(), "download-failed");
            }
        }).start();
    }

    private void download(String url, File to) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        try {
            if (conn.getResponseCode() != 200) throw new Exception("HTTP " + conn.getResponseCode());
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(to)) {
                byte[] buf = new byte[64 * 1024];
                long total = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > MAX_BYTES) throw new Exception("file too large");
                    out.write(buf, 0, n);
                }
            }
        } finally {
            conn.disconnect();
        }
    }
}
