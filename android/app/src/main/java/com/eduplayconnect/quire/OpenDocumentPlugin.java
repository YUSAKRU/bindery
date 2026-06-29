package com.eduplayconnect.quire;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * `@capawesome/capacitor-file-picker`'s pickFiles() uses ACTION_GET_CONTENT,
 * which Android never grants persistable URI permission for — only
 * ACTION_OPEN_DOCUMENT (the Storage Access Framework picker) does. This
 * plugin exists solely so "Son Okunanlar" can actually reopen a file the
 * user picked in-app after the process has restarted.
 */
@CapacitorPlugin(name = "OpenDocument")
public class OpenDocumentPlugin extends Plugin {

    @PluginMethod
    public void pickPdf(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickPdfResult");
    }

    @ActivityCallback
    private void pickPdfResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.resolve(new JSObject());
            return;
        }
        boolean persistent = true;
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException ignored) {
            // Provider doesn't support persistable grants; URI is valid for this session only.
            persistent = false;
        }
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("persistent", persistent);
        call.resolve(ret);
    }
}
