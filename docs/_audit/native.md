# Native / Mobile Integration Audit

**Project:** pdf-booklet-mobile (com.eduplayconnect.quire)  
**Date:** 2026-06-29  
**Scope:** `src/native/*.ts`, `src/types/`, `capacitor.config.ts`, `android/app/src/main/`

---

## Bugs

### [HIGH] B-1 — Memory leak: pdfjs loading task discarded in pdf-thumbnails.ts
**File:** `src/native/pdf-thumbnails.ts:11`

```ts
return pdfjsLib.getDocument({ data: bytes }).promise;
```

The `PDFLoadingTask` returned by `getDocument()` is never retained. `PDFDocumentProxy.destroy()` does **not** release worker-level and document-level resources — only `loadingTask.destroy()` does. Every call to `loadPdfForThumbnails()` leaks worker memory that accumulates until the tab crashes. Contrast with `pdf-reader-render.ts:23`, which correctly holds the task and exposes `destroy: () => loadingTask.destroy()`.

---

### [HIGH] B-2 — page.cleanup() never called after render (both files)
**Files:** `src/native/pdf-thumbnails.ts:29`, `src/native/pdf-reader-render.ts:187`

After `page.render(...).promise` resolves, `page.cleanup()` is not called in either file. pdfjs caches per-page resources (fonts, images, decoded streams) in the page proxy indefinitely. Reading through a large document accumulates all rendered pages in memory. On mobile, this is the primary OOM vector.

---

### [MED] B-3 — Uint8Array ownership transfer risk in pdf-thumbnails.ts
**File:** `src/native/pdf-thumbnails.ts:11`

```ts
pdfjsLib.getDocument({ data: bytes })
```

`bytes` is passed directly without `.slice()`. pdfjs may internally transfer ownership of the underlying `ArrayBuffer` (via structured-clone / `Transferable`). Any subsequent read of `bytes` by the caller is undefined behavior. `pdf-reader-render.ts:23` correctly uses `bytes.slice()` — apply the same fix here.

---

### [MED] B-4 — Recents deduplication by filename, not URI
**File:** `src/native/recents-store.ts:35`

```ts
const existing = entries.find((e) => e.name === entry.name);
```

Two distinct PDFs from different directories but with the same filename (e.g., `Downloads/report.pdf` and `Documents/report.pdf`) are treated as the same entry. The second open clobbers the URI and last-page position of the first. Deduplication key should be `uri` (when non-null) with `name` as a fallback.

---

### [MED] B-5 — Filesystem.stat() on content:// URI returns unreliable name
**File:** `src/native/file-bridge.ts:42–51`

```ts
const [stat, file] = await Promise.all([
  Filesystem.stat({ path: uri }),
  Filesystem.readFile({ path: uri }),
]);
// ...
return { name: stat.name, bytes: ... };
```

`Filesystem.stat()` is designed for paths within known Capacitor directories. When called with a raw `content://` URI (e.g., from an "Open with" intent), `stat.name` may return the last path segment of the URI (`document/primary:Downloads%2Ffile.pdf`) rather than the human-readable display name. On some Android versions the `stat()` call itself throws, which makes `Promise.all` reject and surfaces no file at all.

---

### [MED] B-6 — canvas: null passed to pdfjs render in night mode
**File:** `src/native/pdf-reader-render.ts:183–185`

```ts
const renderContext = nightMode
  ? { canvas: null as unknown as HTMLCanvasElement, canvasContext: createSmartDarkContext(ctx), viewport }
  : { canvas, viewport };
```

Passing `canvas: null` alongside `canvasContext` is not a documented pdfjs API combination. In normal mode `canvas` is provided (pdfjs derives its own context). In night mode `canvasContext` is the proxy but `canvas: null` is still included. This works by accident today but is fragile — future pdfjs versions that validate the `canvas` field will break night mode rendering silently.

---

## Permissions / Config

### [MED] P-1 — Unused CAMERA permission in AndroidManifest
**File:** `android/app/src/main/AndroidManifest.xml:50`

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

No camera feature is present anywhere in the codebase. This permission triggers a runtime grant prompt on Android 6+, appears in the Play Store's permission disclosure, and may trigger additional manual review. Remove it.

---

### [MED] P-2 — file_paths.xml missing internal files-path
**File:** `android/app/src/main/res/xml/file_paths.xml`

```xml
<paths>
    <external-path name="my_images" path="." />
    <cache-path name="my_cache_images" path="." />
</paths>
```

`files-path` (for `getFilesDir()` = `Directory.Data` internal storage) is absent. If any file stored via `savePdfPrivately()` or `movePrivateItem()` is ever exposed through `Share.share()` or another FileProvider consumer, Android will throw `FileUriExposedException` at runtime. Add `<files-path name="internal_files" path="." />`.

---

### [LOW] P-3 — BROWSABLE category on PDF VIEW intent-filter widens attack surface
**File:** `android/app/src/main/AndroidManifest.xml:29`

```xml
<category android:name="android.intent.category.BROWSABLE" />
```

`CATEGORY_BROWSABLE` allows any web page to invoke this activity with an arbitrary URI via an `<a href>` link or `Intent.ACTION_VIEW`. For a local PDF viewer that doesn't use App Links / deep-linking from the web, this category is unnecessary and increases the attack surface. Remove it unless HTTP/S deep-linking is intentional.

---

### [LOW] P-4 — No android block in capacitor.config.ts
**File:** `capacitor.config.ts`

Missing `android` configuration:
- No `backgroundColor` → white flash on cold start before the WebView loads.
- No explicit `webContentsDebuggingEnabled: false` → defaults may allow USB debugging of the WebView in release builds depending on Capacitor version.
- No `allowMixedContent` declaration.

---

### [LOW] P-5 — ProGuard/R8 disabled for release builds
**File:** `android/app/build.gradle:39`

```groovy
minifyEnabled false
```

Release APK is not shrunk or obfuscated. This inflates download size (pdfjs-dist alone is ~3 MB) and makes the app trivially reversible. Enable `minifyEnabled true` with appropriate keep rules for Capacitor.

---

## Integration

### [MED] I-1 — appUrlOpen listener handle discarded; duplicate registration possible
**File:** `src/native/app-links.ts:14–16`

```ts
void App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
  onUrl(event.url);
});
```

`addListener()` returns a `PluginListenerHandle` that is silently discarded. If `setupIncomingPdfLinks()` is called more than once (HMR, component remount, route change), multiple listeners accumulate. Each subsequent PDF open event fires `onUrl` N times. The function should return a cleanup handle, and callers must call `handle.remove()` on teardown.

---

### [LOW] I-2 — OpenDocument plugin has no iOS / web fallback
**File:** `src/native/open-document.ts:7`

```ts
const OpenDocument = registerPlugin<OpenDocumentPlugin>('OpenDocument');
```

No `web` implementation is provided. On iOS or in a browser context, `OpenDocument.pickPdf()` will throw "not implemented" (Capacitor's default). There is no platform guard before calling `pickPdfWithPersistentUri()`. Add a platform check (`Capacitor.getPlatform() === 'android'`) or a no-op web stub.

---

### [LOW] I-3 — getLaunchUrl() URL passed to handler without validation
**File:** `src/native/app-links.ts:10–11`

```ts
void App.getLaunchUrl().then((result) => {
  if (result?.url) onUrl(result.url);
});
```

Any URL string from the launch intent reaches `onUrl()` unvalidated. A non-PDF URI (e.g., a custom scheme from another app or a malformed "Open with" intent) propagates into the PDF reader without a MIME-type or extension check, potentially causing an unhandled error deep in the render pipeline.

---

## Robustness

### [HIGH] R-1 — No file size guard before reading entire PDF into memory
**Files:** `src/native/file-bridge.ts:41–51`, `src/native/file-bridge.ts:55–63`, `src/native/file-bridge.ts:67–73`

`readPdfFromUri()`, `pickPdf()`, and `pickPdfs()` all read the full PDF byte content into a `Uint8Array` in the JS heap (`readData: true`). A 150 MB PDF will exhaust the Android WebView heap (typically 128–256 MB limit). `pickPdfs()` loads multiple files simultaneously with no total-size cap.

Mitigation: check `stat.size` before reading; reject or warn for files exceeding a threshold (e.g., 50 MB); consider streaming / chunked loading for large files.

---

### [MED] R-2 — URI persistence failure silently hidden from caller
**File:** `android/app/src/main/java/com/eduplayconnect/quire/OpenDocumentPlugin.java:46–47`

```java
} catch (SecurityException ignored) {
    // Falls back to a one-time read; the caller still gets the URI.
}
```

When `takePersistableUriPermission` fails (e.g., the provider doesn't support persistable grants), the URI is returned to JS as if persistence succeeded. The recents store records it as a persistable URI. After process death, reopening that entry will fail with a `SecurityException` in the WebView, with no user-visible explanation. Return a `persistent: false` flag in the `JSObject` so the JS layer can decide to store only the filename (not the URI) in recents for that file.

---

### [MED] R-3 — No render cancellation; concurrent renders corrupt display
**File:** `src/native/pdf-reader-render.ts:149–213`

`renderReaderPage()` accepts no cancellation signal. During rapid page flipping, multiple `page.render()` tasks may execute concurrently on overlapping canvases, producing torn or overwritten frames. The render task returned by `page.render()` exposes a `cancel()` method — it should be tracked and cancelled when a new render for the same canvas is requested.

---

### [LOW] R-4 — No handling of app lifecycle during active render
**File:** `src/native/pdf-reader-render.ts`

When the Android app is backgrounded mid-render (e.g., user receives a call), the render continues consuming CPU/GPU in the background with no yield or cancellation. Capacitor exposes `App.addListener('appStateChange', ...)` — active renders should be cancelled or paused on background and optionally resumed on foreground.

---

*End of audit. Audit only — no source files were modified.*
