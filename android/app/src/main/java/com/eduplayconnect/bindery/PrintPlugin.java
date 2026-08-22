package com.eduplayconnect.bindery;

import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Hands a PDF to Android's system print dialog.
 *
 * Bindery's whole output is meant for paper, but sharing a PDF ejects the user
 * into whichever app receives the intent — which is fatal for the two-pass
 * front/back workflow, since nothing brings them back to print the second side.
 * The system print dialog opens over the app and leaves the user here.
 *
 * The call takes a URI, never the bytes: pushing a 50 MB PDF through the
 * Capacitor bridge as base64 is exactly the memory problem fixed in 0.3.5. The
 * TypeScript side writes to the cache directory first and passes the location.
 */
@CapacitorPlugin(name = "Print")
public class PrintPlugin extends Plugin {

    @PluginMethod
    public void printPdf(PluginCall call) {
        String uriString = call.getString("uri");
        String jobName = call.getString("jobName", "Document");
        if (uriString == null || uriString.isEmpty()) {
            call.reject("No file was supplied to print.", "PRINT_MISSING_URI");
            return;
        }

        Uri uri = Uri.parse(uriString);
        Context context = getContext();
        PrintManager printManager = (PrintManager) context.getSystemService(Context.PRINT_SERVICE);
        if (printManager == null) {
            call.reject("This device has no print service.", "PRINT_UNAVAILABLE");
            return;
        }

        // print() must run on the UI thread; the dialog is an activity.
        getActivity()
            .runOnUiThread(() -> {
                try {
                    printManager.print(jobName, new PdfDocumentAdapter(context, uri, jobName), null);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Could not open the print dialog.", "PRINT_FAILED", e);
                }
            });
    }

    /**
     * Streams an already-written PDF into the descriptor the print spooler
     * supplies. The file is finished before printing starts, so the page count
     * is unknown to us and reported as UNKNOWN — the spooler derives the real
     * count from the PDF itself.
     */
    private static class PdfDocumentAdapter extends PrintDocumentAdapter {

        private final Context context;
        private final Uri uri;
        private final String name;

        PdfDocumentAdapter(Context context, Uri uri, String name) {
            this.context = context;
            this.uri = uri;
            this.name = name;
        }

        @Override
        public void onLayout(
            PrintAttributes oldAttributes,
            PrintAttributes newAttributes,
            CancellationSignal cancellationSignal,
            LayoutResultCallback callback,
            Bundle extras
        ) {
            if (cancellationSignal != null && cancellationSignal.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(name)
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
                .build();
            // Attribute changes never alter the file, so layout is never "changed".
            callback.onLayoutFinished(info, false);
        }

        @Override
        public void onWrite(
            PageRange[] pages,
            ParcelFileDescriptor destination,
            CancellationSignal cancellationSignal,
            WriteResultCallback callback
        ) {
            try (
                InputStream in = context.getContentResolver().openInputStream(uri);
                OutputStream out = new FileOutputStream(destination.getFileDescriptor())
            ) {
                if (in == null) {
                    callback.onWriteFailed("SOURCE_UNREADABLE");
                    return;
                }
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = in.read(buffer)) > 0) {
                    if (cancellationSignal != null && cancellationSignal.isCanceled()) {
                        callback.onWriteCancelled();
                        return;
                    }
                    out.write(buffer, 0, read);
                }
                callback.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
            } catch (IOException e) {
                callback.onWriteFailed(e.getMessage());
            }
        }
    }
}
