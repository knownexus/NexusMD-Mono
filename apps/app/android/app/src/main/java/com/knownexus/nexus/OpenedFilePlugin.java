package com.knownexus.nexus;

import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Hands the page a .txt or .md file the user opened with this app (Open with, or Share, from a file
 * manager, a download or another app). The page asks with take(), and is told by a "fileOpened"
 * event when a file arrives while the app is already running.
 *
 * Only content:// addresses are read. A file:// address could name the app's own private files, and
 * any provider of this app is refused for the same reason (found by asking which package owns it). The file is read off the main thread
 * (a file kept in the cloud can be slow), capped at MAX_BYTES, and read as UTF-8.
 */
@CapacitorPlugin(name = "OpenedFile")
public class OpenedFilePlugin extends Plugin {

    // Keep in step with MAX_OPEN_BYTES in open-text-file.js.
    private static final int MAX_BYTES = 2 * 1024 * 1024;

    private final Object lock = new Object();
    private JSObject pending;      // the file read and waiting to be taken, or an error
    private boolean reading;       // a file is being read right now
    private PluginCall waiting;    // a take() waiting for that read

    @Override
    public void load() {
        begin(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        begin(intent);
    }

    /** Resolves with { name, text }, or { error }, or {} when no file is waiting. */
    @PluginMethod
    public void take(PluginCall call) {
        synchronized (lock) {
            if (pending != null) {
                call.resolve(pending);
                pending = null;
            } else if (reading) {
                if (waiting != null) waiting.resolve(new JSObject());
                waiting = call;
            } else {
                call.resolve(new JSObject());
            }
        }
    }

    private void begin(Intent intent) {
        final Uri uri = fileUri(intent);
        if (uri == null) return;
        // The intent is spent, so being recreated does not open the same file again.
        intent.setAction(null);
        intent.setData(null);
        intent.removeExtra(Intent.EXTRA_STREAM);
        synchronized (lock) { reading = true; }
        new Thread(() -> {
            JSObject result = read(uri);
            boolean taken = false;
            synchronized (lock) {
                reading = false;
                if (waiting != null) {
                    waiting.resolve(result);
                    waiting = null;
                    taken = true;
                } else {
                    pending = result;
                }
            }
            if (!taken) notifyListeners("fileOpened", new JSObject());
        }, "nexus-opened-file").start();
    }

    @SuppressWarnings("deprecation")
    private Uri fileUri(Intent intent) {
        if (intent == null) return null;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            uri = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                : (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri == null || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) return null;
        // A user id in front of the authority (content://10@com.knownexus.nexus.fileprovider/...) names a provider in a way
        // that does not equal its authority, so ask which app owns the provider instead of comparing text. This app's
        // own package is always visible to it, so a provider that does not resolve is not ours.
        String authority = uri.getAuthority();
        if (authority == null || authority.contains("@")) return null;
        ProviderInfo provider = getContext().getPackageManager().resolveContentProvider(authority, 0);
        if (provider != null && provider.packageName.equals(getContext().getPackageName())) return null;
        return uri;
    }

    private JSObject read(Uri uri) {
        JSObject out = new JSObject();
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) {
                out.put("error", "That file could not be opened.");
                return out;
            }
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) {
                if (bytes.size() + n > MAX_BYTES) {
                    out.put("error", "That file is too large to open here (the limit is 2 MB).");
                    return out;
                }
                bytes.write(buffer, 0, n);
            }
            out.put("name", displayName(resolver, uri));
            out.put("text", new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            out = new JSObject();
            out.put("error", "That file could not be read: " + e.getMessage());
        }
        return out;
    }

    private String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String name = c.getString(0);
                if (name != null) return name;
            }
        } catch (Exception ignored) {
            // The name only labels the document; the text is what matters.
        }
        String last = uri.getLastPathSegment();
        return last == null ? "" : last;
    }
}
