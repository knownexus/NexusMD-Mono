package com.knownexus.nexus;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
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
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.regex.Pattern;

/**
 * Updates the app from a GitHub release APK, for installs that did not come from Google Play (a Play
 * install is re-signed by Play, so a release APK could not replace it, and Play updates it anyway).
 * Android still asks the user to confirm each install; this only downloads the APK and hands it over.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    // Only this repository's Android release APKs are downloaded, whatever the web side asks for. The URL is
    // parsed and matched as a whole (not by prefix), so a path like ../ or an encoded slash cannot widen it.
    private static final Pattern ALLOWED_PATH = Pattern.compile("^/knownexus/NexusMD-Mono/releases/download/android-v\\d+\\.\\d+\\.\\d+/[\\w.-]+\\.apk$");
    // GitHub serves the asset from its own storage hosts after a redirect.
    private static final Pattern STORAGE_HOST = Pattern.compile("^([\\w-]+\\.)*githubusercontent\\.com$");
    private static final long MAX_BYTES = 200L * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;

    static boolean isAllowedUrl(String url) {
        try {
            URL u = new URL(url);
            return "https".equals(u.getProtocol()) && "github.com".equals(u.getHost()) && u.getPort() == -1
                && u.getQuery() == null && u.getUserInfo() == null && ALLOWED_PATH.matcher(u.getPath()).matches();
        } catch (Exception e) {
            return false;
        }
    }

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
        if (url == null || !isAllowedUrl(url)) {
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
                if (!isOurs(ctx, apk)) {
                    //noinspection ResultOfMethodCallIgnored
                    apk.delete();
                    throw new Exception("the file is not a NexusMD update signed with this app's key");
                }
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

    // Redirects are followed by hand: each hop must be https and, after the first, a GitHub storage host.
    private void download(String firstUrl, File to) throws Exception {
        String url = firstUrl;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            URL u = new URL(url);
            boolean first = hop == 0;
            if (!"https".equals(u.getProtocol()) || !(first ? "github.com".equals(u.getHost()) : STORAGE_HOST.matcher(u.getHost()).matches())) {
                throw new Exception("redirected somewhere unexpected");
            }
            HttpURLConnection conn = (HttpURLConnection) u.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            try {
                int code = conn.getResponseCode();
                if (code >= 300 && code < 400) {
                    String next = conn.getHeaderField("Location");
                    if (next == null) throw new Exception("redirect without a location");
                    url = new URL(u, next).toString();
                    continue;
                }
                if (code != 200) throw new Exception("HTTP " + code);
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
                return;
            } finally {
                conn.disconnect();
            }
        }
        throw new Exception("too many redirects");
    }

    // The downloaded file must be this app (same package) signed by the same key as the installed one.
    // Android would refuse a different signature anyway; checking first avoids opening the installer on junk.
    @SuppressWarnings("deprecation")
    private static boolean isOurs(Context ctx, File apk) {
        try {
            PackageManager pm = ctx.getPackageManager();
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo fresh = pm.getPackageArchiveInfo(apk.getPath(), PackageManager.GET_SIGNING_CERTIFICATES);
                PackageInfo mine = pm.getPackageInfo(ctx.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                return fresh != null && ctx.getPackageName().equals(fresh.packageName)
                    && fresh.signingInfo != null && mine.signingInfo != null
                    && Arrays.equals(digest(fresh.signingInfo.getApkContentsSigners()), digest(mine.signingInfo.getApkContentsSigners()));
            }
            PackageInfo fresh = pm.getPackageArchiveInfo(apk.getPath(), PackageManager.GET_SIGNATURES);
            PackageInfo mine = pm.getPackageInfo(ctx.getPackageName(), PackageManager.GET_SIGNATURES);
            return fresh != null && ctx.getPackageName().equals(fresh.packageName)
                && fresh.signatures != null && Arrays.equals(digest(fresh.signatures), digest(mine.signatures));
        } catch (Exception e) {
            return false;
        }
    }

    private static byte[] digest(Signature[] sigs) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        for (Signature s : sigs) md.update(s.toByteArray());
        return md.digest();
    }
}
