# UI / i18n / Build Audit — Quire (pdf-booklet-mobile)

**Date:** 2026-06-29  
**Scope:** `src/ui/app.ts`, `src/ui/styles.css`, `src/i18n/index.ts`, `src/main.ts`, `package.json`, `tsconfig.json`, `index.html`, capacitor config  
**Auditor:** coder-moto  

---

## 1. Monolith / Architecture

### [HIGH] `src/ui/app.ts` is a 4336-line single-function monolith

`initApp()` at `src/ui/app.ts:138` is the only exported function and contains **everything**: ~80+ nested functions, 147 `addEventListener` calls, all per-tool state variables, all render logic, all modal handling, file I/O wiring, reader, fullscreen, search, onboarding, settings, recents, and file explorer. This single closure makes the file untestable, unnavigable, and impossible to split without a major refactor.

**Suggested module split:**

| Proposed module | Lines (approx.) | Responsibility |
|---|---|---|
| `ui/shell.ts` | 100 | `showScreen`, `showToast`, nav, back button, top-bar |
| `ui/booklet-screen.ts` | 150 | Booklet picker → config → result flow |
| `ui/merge-screen.ts` | 200 | Merge picker + result |
| `ui/organize-screen.ts` | 250 | Organize picker + page list + result |
| `ui/rotate-screen.ts` | 220 | Rotate page list + result |
| `ui/page-numbers-screen.ts` | 200 | Page numbers settings + preview + result |
| `ui/watermark-screen.ts` | 230 | Watermark mode/settings + preview + result |
| `ui/image-to-pdf-screen.ts` | 200 | Camera/gallery capture + crop + result |
| `ui/reader-screen.ts` | 600 | Reader, fullscreen overlay, search |
| `ui/files-screen.ts` | 300 | Files explorer, sort sheet, modals |
| `ui/recents-screen.ts` | 100 | Recents list |
| `ui/settings-screen.ts` | 80 | Dark mode toggle, lang switch, clear cache |
| `ui/onboarding.ts` | 100 | Onboarding overlay |
| `ui/pickers.ts` | 150 | `promptAndPickPdfs`, Quire file picker modal |
| `ui/save-modal.ts` | 80 | Save document modal |

State currently trapped as closure variables (e.g. `mergeFiles`, `booklet`, `organizePageOrder`) would become module-level state or thin controller objects passed between screens.

### [MED] All 80+ inner functions share a single flat closure scope

Variable names like `organizeOriginalName`, `rotateOriginalName`, `pageNumbersOriginalName`, `watermarkOriginalName` are identical in shape and pollute the same scope (`src/ui/app.ts:337,363,394,437`). Each tool's state block is repeated 5 times with minor variation — a strong signal for a generic `ToolScreen<TState>` abstraction.

### [MED] No vite config file (`vite.config.ts`) exists

There is no `vite.config.ts` in the project root. This means there is no code-splitting, no `manualChunks`, and no chunk-size warning suppression. The CLAUDE.md explicitly notes "Chunk size 500kB+" as a known problem. Without a vite config, `pdfjs-dist` (~2 MB) and `pdf-lib` land in a single bundle with no lazy-loading option.

### [LOW] `src/ui/styles.css` is 2319 lines with no modular split

All styles for every screen, every modal, the reader, onboarding, and crop are in one file. No CSS modules or scoped imports. Fine today, but will grow with the app.

---

## 2. i18n

### [HIGH] `common.select` key is missing from `src/i18n/index.ts`

`index.html:1055` uses `data-i18n="common.select"` on the Quire file picker confirm button. Neither the `en` nor `tr` locale defines this key. The `t()` function falls back to the key string (`"common.select"`) being displayed to the user verbatim.

### [HIGH] Hardcoded Turkish toast strings not going through `t()`

These display raw Turkish to English-locale users:

| File | Line | Hardcoded string |
|---|---|---|
| `src/ui/app.ts` | 815 | `"PDF Kaynağı Seçiliyor..."` |
| `src/ui/app.ts` | 968 | `"PDF Kaynağı Seçiliyor (Çoklu)..."` |
| `src/ui/app.ts` | 1224 | `"PDF Kaynağı Seçiliyor..."` |
| `src/ui/app.ts` | 1457 | `"PDF Kaynağı Seçiliyor..."` |
| `src/ui/app.ts` | 1646 | `"PDF Kaynağı Seçiliyor..."` |
| `src/ui/app.ts` | 1868 | `"PDF Kaynağı Seçiliyor..."` |
| `src/ui/app.ts` | 1013 | `mergeSaveBtnLabel.textContent = 'Kaydet'` |

### [MED] Hardcoded Turkish default file name suffixes

Generated file names hardcode Turkish suffixes regardless of selected language:

| File | Line | Value |
|---|---|---|
| `src/ui/app.ts` | 316 | `'Birlesik_'` (merged file prefix) |
| `src/ui/app.ts` | 891 | `'kitapcik'` (booklet fallback name) |
| `src/ui/app.ts` | 1092 | `'birlesik.pdf'` (share filename for merge) |
| `src/ui/app.ts` | 1250, 1333 | `'_duzenli'` suffix (organize result) |
| `src/ui/app.ts` | 1487, 1570 | `'_donduruldu'` suffix (rotate result) |
| `src/ui/app.ts` | 1698, 1781 | `'_numarali'` suffix (page numbers result) |
| `src/ui/app.ts` | 1961, 2044 | `'_filigranli'` suffix (watermark result) |

These should be i18n keys (e.g. `'common.suffix.merged'`, `'common.suffix.edited'`).

### [MED] Default variable names hardcoded in Turkish

Module-level fallback variable defaults use Turkish strings:

| File | Line | Value |
|---|---|---|
| `src/ui/app.ts` | 337 | `let organizeOriginalName = 'belge'` |
| `src/ui/app.ts` | 363 | `let rotateOriginalName = 'belge'` |
| `src/ui/app.ts` | 394 | `let pageNumbersOriginalName = 'belge'` |
| `src/ui/app.ts` | 437 | `let watermarkOriginalName = 'belge'` |
| `src/ui/app.ts` | 479 | `let readerName = 'Belge'` |

### [MED] "Open in..." modal title not i18n-ized

`index.html:939`: `<h3 class="modal-title">Open in...</h3>` — no `data-i18n` attribute. This string is missing from both locales.

### [LOW] Hub search input `aria-label` bypasses i18n

`index.html:31`: `aria-label="Search tools"` is hardcoded English with no `data-i18n-aria-label` fallback attribute, unlike every other button in the same file.

### [LOW] `tr` locale has same key count as `en` (parity confirmed)

Both locales have identical key sets (except `common.select` which is missing from both). i18n parity is otherwise good.

---

## 3. Accessibility

### [HIGH] Modal dialogs lack `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`

All seven modal overlays (`moveDocModal`, `fileActionsModal`, `openInToolSheet`, `saveDocModal`, `downloadPdfModal`, `pdfSourceModal`, `quireFilePickerModal`) in `index.html:907–1058` are plain `<div>` elements with no ARIA dialog role. Screen readers will not announce them as dialogs, and focus will not be trapped.

Minimal fix per modal:
```html
<div class="modal-overlay hidden" id="saveDocModal"
     role="dialog" aria-modal="true" aria-labelledby="saveDocModalTitle">
```

### [HIGH] No focus trap in modals; no Escape-to-close keyboard handling

`src/ui/app.ts` has zero `keydown` Escape handlers and only one `focus()` call (`src/ui/app.ts:2894`, inside the reader search panel). Opening any modal leaves keyboard focus behind it, making the app unusable with a keyboard or switch access device.

### [MED] No `role="alert"` or `aria-live="assertive"` on error toasts

The `#toast` div uses `aria-live="polite"` (`index.html:1060`), which queues announcements. Error messages (e.g. file open failure) should use `aria-live="assertive"` or `role="alert"` so they are announced immediately.

### [MED] Dynamically built page-list items (`renderOrganizeList`, `renderRotateList`) lack accessible labels on thumbnails

Thumbnail `<img>` tags inserted by `loadThumbnail` and `loadRotateThumbnail` use empty `alt=""` (`src/ui/app.ts:1156, 1195, 1403`). The page label text exists as a sibling span but is not associated via `aria-label` or `aria-describedby` on the row.

### [MED] No `prefers-reduced-motion` CSS media query

`src/ui/styles.css` defines 31 animation/transition rules but has no `@media (prefers-reduced-motion: reduce)` block. Users who opt into reduced motion (common for vestibular disorders) will still experience all slide-in and spinner animations.

### [LOW] Bottom-nav buttons have no `aria-current` attribute

`index.html:833–848`: The active nav tab has `class="is-active"` but no `aria-current="page"`, which is the semantic indicator screen readers use to identify the current page in a navigation.

### [LOW] `<section>` screens not labelled

Each `<section class="screen">` represents a distinct app view but has no `aria-label` or `aria-labelledby`. Screen reader users navigating by landmarks will encounter unlabelled sections.

---

## 4. Build / Config

### [HIGH] No `vite.config.ts` — no code splitting, no build optimizations

`pdfjs-dist` v6 is ~2 MB minified. Without a vite config with `manualChunks` or dynamic `import()`, everything lands in one synchronous chunk, dramatically slowing cold start. Recommended:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
          'pdf-lib': ['pdf-lib'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
```

### [HIGH] `legacy-dep-removed` listed as a runtime `dependency`

`package.json:29`: `"legacy-dep-removed": "^2.0.0"` is in `dependencies` (not `devDependencies`) and is not imported anywhere in `src/`. This package is an MCP server tool with no role in the mobile app bundle. It adds unnecessary weight to `node_modules` and will be included in any bundler resolution scan. It should be removed entirely.

### [MED] TypeScript `strict` mode not enabled

`tsconfig.json` enables individual lint rules (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`) but does **not** set `"strict": true`. This means `strictNullChecks`, `strictFunctionTypes`, `noImplicitAny`, and `strictPropertyInitialization` are all off. The codebase uses `!` non-null assertions extensively (e.g. `src/ui/app.ts:939, 952, 1153`) which `strict` mode would require to be justified.

### [MED] `pdfjs-dist` is a `dependency` — its worker is not explicitly configured

`pdfjs-dist` v6 requires a worker. Without a vite config to alias or copy `pdf.worker.mjs`, the default CDN worker URL may be used, which will fail in offline Capacitor scenarios or be blocked by CSP.

### [LOW] `devDependencies` versions are overly broad

`"vite": "^8.0.12"` and `"vitest": "^4.1.9"` use `^` (caret) ranges which permit major-compatible bumps. For a mobile app with a specific build toolchain, pinning exact versions or using `~` reduces the risk of unexpected tooling changes between developer machines.

### [LOW] `capacitor.config.ts` has no `server` or `hostname` config

`capacitor.config.ts` only defines `appId`, `appName`, and `webDir`. No `server.allowNavigation`, `server.hostname`, or `plugins` config. For production, setting `hostname` prevents the default `localhost` from appearing in Android network traffic logs.

### [LOW] Left-over `[DEBUG]` `console.error` calls in production code

8 `console.error("[DEBUG] ...")` calls at `src/ui/app.ts:744, 823, 976, 1232, 1465, 1654, 1876, 3055` will appear in production LogCat output. These should be removed or replaced with a proper error logger.

---

## 5. UX

### [MED] No loading state when opening a PDF source modal

The `pickFileBtn`, `organizePickBtn`, `rotatePickBtn`, `pageNumbersPickBtn`, `watermarkPickBtn` all show an untranslated Turkish toast ("PDF Kaynağı Seçiliyor...") as the only loading signal before the source modal appears. If the modal is shown instantly (it is), the toast is misleading. The button itself should become `disabled` with a spinner.

### [MED] `confirm()` dialog used for overwrite confirmation

`src/ui/app.ts:1056, 1296, 1533, 1744` use the native `window.confirm()` for overwrite prompts. On Android WebView, `confirm()` blocks the JS thread and its appearance is OS-styled and not localized by the app's i18n system. A custom modal should be used.

### [MED] "Back" button navigates using static `PARENT_SCREEN` map but does not preserve tool state

`PARENT_SCREEN` (`src/ui/app.ts:68`) maps every screen to a fixed parent. Navigating back from `rotate-result` → `hub` discards the rotate session. Users expecting "back" to return to the rotate page list will find all their work lost.

### [LOW] Hub search filters only by current language strings

`src/ui/app.ts:590–597`: the hub search reads `.textContent` from rendered DOM nodes. If the user types a search term in Turkish while the UI is in English (or vice versa), terms not matching the rendered language are unfindable. The search should query the i18n catalogue for both locales.

### [LOW] "New File" buttons do not confirm before discarding in-progress work

`mergeNewBtn`, `organizeNewBtn`, `rotateNewBtn`, `pageNumbersNewBtn`, `watermarkNewBtn` immediately reset state without asking the user to confirm if there is an unsaved result PDF in memory.

### [LOW] `pageNumbers.pageOfTotal` i18n value is a hardcoded example ("Page 1 / 12"), not a format string

`src/i18n/index.ts:133,440` define `pageNumbers.pageOfTotal` as a literal example string, not a parameterized template. The segmented-button label in `index.html:431` shows this static example string instead of a dynamic preview.

### [LOW] Image-to-PDF gallery input visible only via `<label>` wrapper; no keyboard accessible route for gallery pick

`index.html:607–610`: the gallery file input is `display:none` and only accessible by clicking its `<label>`. The label has no `tabindex` and the input itself is not reachable by Tab key, making gallery selection inaccessible without a pointer device.

---

*End of audit. 30 findings total: 6 High, 10 Med, 14 Low.*
