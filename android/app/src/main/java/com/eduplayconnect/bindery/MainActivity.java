package com.eduplayconnect.bindery;

import android.content.Intent;
import android.os.Bundle;
import androidx.annotation.Nullable;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        registerPlugin(OpenDocumentPlugin.class);
        super.onCreate(savedInstanceState);
        persistIncomingUriPermission(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        persistIncomingUriPermission(intent);
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
