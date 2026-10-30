package com.knownexus.nexus;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Folder access through the Storage Access Framework, for the Editor. The user grants one folder
 * (the grant is kept across restarts); every other call names that folder by its tree URI plus a
 * path relative to it, so the web side never handles a document URI of its own.
 */
@CapacitorPlugin(name = "SafFolder")
public class SafFolderPlugin extends Plugin {

    private static final long MAX_READ_BYTES = 5L * 1024 * 1024;

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "pickFolderResult");
    }

    @ActivityCallback
    private void pickFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }
        Uri uri = data.getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (SecurityException e) {
            call.reject("Could not keep access to that folder.");
            return;
        }
        DocumentFile root = DocumentFile.fromTreeUri(getContext(), uri);
        JSObject out = new JSObject();
        out.put("uri", uri.toString());
        out.put("name", root != null && root.getName() != null ? root.getName() : "Folder");
        call.resolve(out);
    }

    @PluginMethod
    public void stat(PluginCall call) {
        DocumentFile f = resolve(call);
        JSObject out = new JSObject();
        if (f == null || !f.exists()) {
            out.put("exists", false);
            out.put("kind", JSObject.NULL);
            out.put("size", 0);
        } else {
            out.put("exists", true);
            out.put("kind", f.isDirectory() ? "dir" : f.isFile() ? "file" : "other");
            out.put("size", f.length());
        }
        call.resolve(out);
    }

    @PluginMethod
    public void list(PluginCall call) {
        DocumentFile dir = resolve(call);
        if (dir == null || !dir.isDirectory()) {
            call.reject("That folder no longer exists.");
            return;
        }
        JSArray entries = new JSArray();
        for (DocumentFile child : dir.listFiles()) {
            String name = child.getName();
            if (name == null) continue;
            JSObject e = new JSObject();
            e.put("name", name);
            e.put("kind", child.isDirectory() ? "dir" : child.isFile() ? "file" : "other");
            e.put("size", child.isFile() ? child.length() : 0);
            entries.put(e);
        }
        JSObject out = new JSObject();
        out.put("entries", entries);
        call.resolve(out);
    }

    @PluginMethod
    public void readText(PluginCall call) {
        DocumentFile f = resolve(call);
        if (f == null || !f.exists()) {
            JSObject missing = new JSObject();
            missing.put("missing", true);
            call.resolve(missing);
            return;
        }
        if (!f.isFile()) {
            call.reject("That is not a file.");
            return;
        }
        if (f.length() > MAX_READ_BYTES) {
            call.reject("That file is too large to open here.");
            return;
        }
        try (InputStream in = getContext().getContentResolver().openInputStream(f.getUri())) {
            if (in == null) {
                call.reject("Could not open that file.");
                return;
            }
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[16 * 1024];
            int n;
            // length() is whatever the provider reports, so the cap is enforced on the bytes actually read.
            while ((n = in.read(chunk)) > 0) {
                if (buf.size() + n > MAX_READ_BYTES) {
                    call.reject("That file is too large to open here.");
                    return;
                }
                buf.write(chunk, 0, n);
            }
            JSObject out = new JSObject();
            out.put("text", new String(buf.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Could not read that file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeText(PluginCall call) {
        String text = call.getString("text");
        String path = call.getString("path", "");
        if (text == null) {
            call.reject("Nothing to write.");
            return;
        }
        // The file is created inside its folder when it does not exist yet.
        int slash = path.lastIndexOf('/');
        String parentPath = slash < 0 ? "" : path.substring(0, slash);
        String name = slash < 0 ? path : path.substring(slash + 1);
        DocumentFile parent = resolve(call.getString("tree"), parentPath);
        if (parent == null || !parent.isDirectory() || name.isEmpty()) {
            call.reject("That file cannot be saved there.");
            return;
        }
        DocumentFile f = parent.findFile(name);
        // application/octet-stream keeps the provider from appending an extension (text/plain adds .txt).
        if (f == null) f = parent.createFile("application/octet-stream", name);
        if (f == null) {
            call.reject("That file cannot be saved there.");
            return;
        }
        // "wt" truncates, so a shorter text does not leave the old tail behind.
        try (OutputStream out = getContext().getContentResolver().openOutputStream(f.getUri(), "wt")) {
            if (out == null) {
                call.reject("Could not write that file.");
                return;
            }
            out.write(text.getBytes(StandardCharsets.UTF_8));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not write that file: " + e.getMessage());
        }
    }

    private DocumentFile resolve(PluginCall call) {
        return resolve(call.getString("tree"), call.getString("path", ""));
    }

    private DocumentFile resolve(String tree, String path) {
        if (tree == null) return null;
        DocumentFile cur = DocumentFile.fromTreeUri(getContext(), Uri.parse(tree));
        if (cur == null || path == null || path.isEmpty()) return cur;
        for (String seg : path.split("/")) {
            if (seg.isEmpty()) continue;
            cur = cur.findFile(seg);
            if (cur == null) return null;
        }
        return cur;
    }
}
