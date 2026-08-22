package com.eduplayconnect.bindery;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.WebViewListener;
import org.json.JSONObject;

/**
 * Records the one failure the JS error log cannot see itself.
 *
 * Android runs the WebView renderer out of process. When it dies — the usual
 * cause here being memory pressure during a large save or render — no
 * JavaScript runs, no exception is thrown, and nothing reaches window.onerror.
 * The host process survives, though, and this callback fires in it, which is
 * the only place a record can still be written.
 *
 * It writes a single small marker rather than a log entry: src/native/error-log.ts
 * drains it on the next launch and turns it into a normal entry there. Keeping
 * the caps and rotation in one language is worth more than saving that hop.
 */
public class BinderyCrashListener extends WebViewListener {

    /**
     * @capacitor/preferences stores everything in this SharedPreferences file
     * with raw key names, so a value written here is readable from JS through
     * Preferences.get() without any bridge involved.
     */
    private static final String PREFS_NAME = "CapacitorStorage";
    private static final String CRASH_KEY = "bindery.lastCrash.v1";
    /** Kept current by setErrorScreen() in src/native/error-log.ts. */
    private static final String SCREEN_KEY = "bindery.lastScreen.v1";

    private final Context context;

    public BinderyCrashListener(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
        try {
            JSONObject marker = new JSONObject();
            marker.put("at", System.currentTimeMillis());
            // didCrash() separates a real renderer crash from the OS reclaiming
            // it for memory. It needs API 26; below that the cause is left out
            // and reported as unknown rather than guessed at.
            if (detail != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                marker.put("didCrash", detail.didCrash());
            }

            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            // Captured here rather than looked up when the marker is drained.
            // The next launch overwrites this key as soon as it routes to a
            // screen, and it does that long before the drain — which happens
            // behind two awaited bridge calls — could read it. Reading it now
            // is also simply the truer answer: this is where the app died.
            String screen = prefs.getString(SCREEN_KEY, null);
            if (screen != null) {
                marker.put("screen", screen);
            }

            // commit(), not apply(): the process is about to be killed and
            // apply()'s background flush has no guarantee of landing first.
            // This is the whole reason the record is written here in Java
            // instead of being inferred from a marker left by JS at startup.
            prefs.edit().putString(CRASH_KEY, marker.toString()).commit();
        } catch (Exception ignored) {
            // A crash handler that throws is worth nothing.
        }

        // false = not handled, so the system tears the process down as it does
        // today. Returning true would claim we recovered, but we do not rebuild
        // the WebView, so the user would be left staring at a blank screen.
        return false;
    }
}
