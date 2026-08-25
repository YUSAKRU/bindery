package com.eduplayconnect.bindery;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import androidx.annotation.Nullable;
import androidx.core.content.IntentCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        registerPlugin(OpenDocumentPlugin.class);
        registerPlugin(PrintPlugin.class);
        rewriteShareIntentAsView(getIntent());
        super.onCreate(savedInstanceState);
        // After super.onCreate: the bridge does not exist before it.
        getBridge().addWebViewListener(new BinderyCrashListener(this));
        persistIncomingUriPermission(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        rewriteShareIntentAsView(intent);
        super.onNewIntent(intent);
        persistIncomingUriPermission(intent);
    }

    /**
     * Capacitor's App plugin only recognizes ACTION_VIEW for both cold start
     * (Bridge reads intent.getData() into getLaunchUrl()) and warm start
     * (AppPlugin.handleOnNewIntent fires appUrlOpen) — any other action is a
     * no-op there. Rewriting an incoming Share Target ACTION_SEND intent into
     * ACTION_VIEW with the shared file as its data URI, before super.onCreate()/
     * super.onNewIntent() run, lets it ride that same existing pipeline
     * (setupIncomingPdfLinks in app-links.ts) with no changes on the JS side.
     * Mutates the intent in place so getIntent() and persistIncomingUriPermission()
     * below see the rewritten action/data too.
     */
    private void rewriteShareIntentAsView(@Nullable Intent intent) {
        if (intent == null
                || !Intent.ACTION_SEND.equals(intent.getAction())
                || !"application/pdf".equals(intent.getType())) {
            return;
        }
        Uri stream = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
        if (stream == null) {
            return;
        }
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(stream);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    }

    /**
     * Without this, a PDF opened via "Open with" today can fail to reopen
     * from "Son Okunanlar" after the app restarts — Android's default grant
     * on an ACTION_VIEW intent only lasts for the activity's current
     * lifecycle unless explicitly persisted.
     */
    private void persistIncomingUriPermission(@Nullable Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) {
            return;
        }
        int flags = intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
        if (flags == 0) {
            return;
        }
        try {
            getContentResolver().takePersistableUriPermission(intent.getData(), flags);
        } catch (SecurityException ignored) {
            // Some providers don't support persistable grants; reopening
            // later will simply fail gracefully and prompt a re-pick.
        }
    }
}
