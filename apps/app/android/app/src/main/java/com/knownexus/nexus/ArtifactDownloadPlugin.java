package com.knownexus.nexus;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

/**
 * Saves a build artifact (a zip from Azure DevOps or GitHub Actions) to a place the user picks. The
 * user chooses the file in Android's save dialog, so no storage permission is needed on any version.
 * The request carries the provider's token, so it only goes to the two API hosts, and the token is
 * dropped if the provider redirects to a storage host (as GitHub does).
 */
@CapacitorPlugin(name = "ArtifactDownload")
public class ArtifactDownloadPlugin extends Plugin {

    private static final Set<String> API_HOSTS = new HashSet<>(Arrays.asList("dev.azure.com", "api.github.com"));
    private static final Set<String> HEADERS = new HashSet<>(Arrays.asList("authorization", "accept", "x-github-api-version"));
    private static final long MAX_BYTES = 1024L * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;

    @PluginMethod
    public void save(PluginCall call) {
        String url = call.getString("url");
        String filename = call.getString("filename", "artifact.zip");
        if (url == null || !isApiUrl(url)) {
            call.reject("Not a build artifact URL.", "bad-url");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/zip");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }
        final Uri target = data.getData();
        final String url = call.getString("url");
        final JSObject headers = call.getObject("headers", new JSObject());
        new Thread(() -> {
            try {
                long bytes = download(url, headers, target);
                JSObject out = new JSObject();
                out.put("bytes", bytes);
                out.put("uri", target.toString());
                call.resolve(out);
            } catch (Exception e) {
                // Do not leave an empty file behind in the folder the user picked.
                try { DocumentsContract.deleteDocument(getContext().getContentResolver(), target); } catch (Exception ignored) { }
                call.reject("Download failed: " + e.getMessage(), "download-failed");
            }
        }).start();
    }

    private static boolean isApiUrl(String url) {
        try {
            URL u = new URL(url);
            return "https".equals(u.getProtocol()) && API_HOSTS.contains(u.getHost());
        } catch (Exception e) {
            return false;
        }
    }

    private long download(String firstUrl, JSObject headers, Uri target) throws Exception {
        String url = firstUrl;
        String apiHost = new URL(firstUrl).getHost();
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            URL u = new URL(url);
            if (!"https".equals(u.getProtocol())) throw new Exception("redirected to a non-https address");
            HttpURLConnection conn = (HttpURLConnection) u.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            // Headers (the token) only go to the API host, never to wherever it redirects.
            if (u.getHost().equals(apiHost)) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    if (HEADERS.contains(k.toLowerCase())) conn.setRequestProperty(k, headers.getString(k));
                }
            }
            try {
                int code = conn.getResponseCode();
                if (code >= 300 && code < 400) {
                    String next = conn.getHeaderField("Location");
                    if (next == null) throw new Exception("redirect without a location");
                    url = new URL(u, next).toString();
                    continue;
                }
                if (code != 200) throw new Exception("HTTP " + code);
                try (InputStream in = conn.getInputStream();
                     OutputStream out = getContext().getContentResolver().openOutputStream(target)) {
                    if (out == null) throw new Exception("could not open the destination");
                    byte[] buf = new byte[64 * 1024];
                    long total = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        total += n;
                        if (total > MAX_BYTES) throw new Exception("file too large");
                        out.write(buf, 0, n);
                    }
                    return total;
                }
            } finally {
                conn.disconnect();
            }
        }
        throw new Exception("too many redirects");
    }
}
