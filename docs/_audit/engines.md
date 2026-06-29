# Engine Audit — `src/engine/*.ts`

Audited: 2026-06-29  
Auditor: coder-mide  
Test baseline: **38/38 passing** (`npm run test`)

---

## Bugs

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| B1 | **High** | `organize-engine.ts:26` | Out-of-bounds indices in `pageOrder` are never validated. `copyPages` throws a raw pdf-lib internal error instead of a typed `BookletError`. Any index `>= originalPageCount` or negative silently propagates. |
| B2 | **Med** | `rotate-engine.ts:19` | No validation that `angles[i]` ∈ {0, 90, 180, 270}. pdf-lib's `setRotation(degrees(37))` silently writes an illegal rotation value into the PDF spec, producing a non-compliant document. |
| B3 | **Med** | `image-to-pdf-engine.ts:18–58` | Outer `try/catch` re-wraps **all** exceptions as `BookletError`, including any `BookletError` thrown internally. Error type identity is lost; callers cannot distinguish image-format errors from other failures. |
| B4 | **Med** | `watermark-engine.ts:91–92` | Image watermark: `drawWidth = pageWidth * scale`; `drawHeight = drawWidth * (image.height / image.width)`. If `image.width === 0` (degenerate embedded image), this produces `Infinity`/`NaN` and silently draws nothing or corrupts the page stream. |
| B5 | **Med** | `perspective-warp.ts:37–39` | `solve8x8` throws a plain `new Error(...)` (not `BookletError`) when the pivot is near-zero (collinear/degenerate corners). Callers of `warpPerspective` catch `BookletError`; this error bypasses typed error handling. |
| B6 | **Low** | `watermark-engine.ts:60` | Opacity guard is `<= 0`, rejecting `opacity === 0`. Zero opacity is a valid value (invisible watermark) and a common use-case for templates. The error message says "0 ile 1 arasında" (0 to 1) but 0 itself is rejected — inconsistent. |
| B7 | **Low** | `perspective-warp.ts:152` | `new Blob([imgBytes as any])` — unnecessary `as any` cast; `Blob` constructor accepts `ArrayBufferView` directly. Type-safety hole that could hide a mismatched input type at call sites. |
| B8 | **Low** | `booklet-engine.ts:113–118` | No upper-bound validation for `gutter`/`creep`. With `gutter >= TARGET_WIDTH` (≥ 842), `shiftInward` pushes a page completely off the canvas. The page is embedded but no content is visible. Silently produces a blank output. |

---

## Edge Cases

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| E1 | **High** | `organize-engine.ts:26` | `pageOrder` containing duplicate indices (same page twice) works but is never documented or tested. Semantics are implicitly allowed—should be explicit. |
| E2 | **High** | `perspective-warp.ts:64–81` | `getHomographyMatrix` accesses `src[0]..src[3]` and `dst[0]..dst[3]` with no length check. Fewer than 4 points injects `undefined` → `NaN` into the matrix, yielding a silently wrong homography (no throw). |
| E3 | **Med** | `image-to-pdf-engine.ts:22–27` | `ImagePageInput.format` is typed `'png' | 'jpg'` but there is no runtime guard. If the calling UI passes `'webp'` or `'gif'` (possible via `File.type` mapping errors), the `else` branch calls `embedJpg` on a WebP file, which throws a generic error. |
| E4 | **Med** | `watermark-engine.ts:63` | `options.text.trim()` empty check does not guard against texts that are purely Unicode whitespace or zero-width characters that pass `.trim()` but render invisibly. |
| E5 | **Med** | `download-engine.ts:8–35` | No `Content-Type` header check before reading the body. A server returning `text/html` with status 200 is fully downloaded before `validatePdf` rejects it, wasting bandwidth on potentially large HTML responses. |
| E6 | **Low** | `page-numbers-engine.ts:46` | `top-left` and `top-center` are missing from `PageNumberPosition`. The `switch` falls through to `bottom-right` default for any unlisted value—silent fallback rather than an error. |
| E7 | **Low** | `booklet-engine.ts:83–90` | Blank padding pages use `lastPage`'s dimensions. If the last page is oddly sized (e.g., a scanned A4 rotated to landscape), the blank pages will be landscape while the rest are portrait. Visually inconsistent but not a crash. |
| E8 | **Low** | `merge-engine.ts:22` | `MergeInput.name` is part of the public interface but is never used in the engine. There is no de-duplication or conflict detection; two files with the same name merge silently. Confusion for callers who expect name to influence behavior. |

---

## Test Coverage Gaps

| # | Severity | File | Gap |
|---|----------|------|-----|
| T1 | **High** | `perspective-warp.test.ts` | `warpPerspective` (the full WebGL render path) has **zero tests**. Only the math helper `getHomographyMatrix` is tested. Browser-side WebGL path is completely untested. |
| T2 | **High** | `perspective-warp.test.ts` | No test for fewer-than-4 corners → should throw/error path not exercised. |
| T3 | **High** | `validator.test.ts` | No test for `PDFEncryptedError` path (encrypted PDFs). This is a key user-facing error case. |
| T4 | **Med** | `booklet-engine.test.ts` | No tests for `gutter` or `creep` options. The imposition math is never exercised with non-zero options; the shift formulas at `booklet-engine.ts:113–118` are untested. |
| T5 | **Med** | `organize-engine.test.ts` | No test for out-of-bounds indices in `pageOrder`; expected to throw `BookletError` but currently throws a raw pdf-lib error (relates to Bug B1). |
| T6 | **Med** | `organize-engine.test.ts` | No test for duplicate page indices (same page repeated). |
| T7 | **Med** | `rotate-engine.test.ts` | No test for invalid angles (e.g., 45°) — should be rejected per B2 once fixed. No test for `0°` identity rotation. |
| T8 | **Med** | `watermark-engine.test.ts` | No test for `jpg`-format image watermark. Only PNG is exercised. |
| T9 | **Med** | `watermark-engine.test.ts` | No test for zero-dimension image (`image.width = 0`) → relates to Bug B4. |
| T10 | **Med** | `page-numbers-engine.test.ts` | No test for `startNumber > 1` (offset numbering); the `lastNumber = startNumber + pageCount - 1` formula is never verified with a non-1 start. |
| T11 | **Med** | `page-numbers-engine.test.ts` | No test for non-integer `startNumber` (float input); the `Number.isInteger` guard is tested for `0` but not for `1.5`. |
| T12 | **Low** | `booklet-engine.test.ts` | No test for `computeSheetMapping(0)` or `computeSheetMapping(2)` — non-multiples-of-4 for the pure math function. |
| T13 | **Low** | `watermark-engine.test.ts` | No test for `opacity: 0` boundary (relates to Bug B6; currently rejects it). |
| T14 | **Low** | `image-to-pdf-engine.test.ts` | No test for JPEG (`jpg`) format input. Only PNG is exercised. |
| T15 | **Low** | `download-engine.test.ts` | No test for `arrayBuffer()` rejection path → `PDFCorruptedError` from the body-read `try/catch` at `download-engine.ts:22–26` is untested (only the PDF-validation path exercises `PDFCorruptedError`). |

---

## Missing Features

| # | Priority | Description |
|---|----------|-------------|
| F1 | **High** | **PDF Split engine** — No engine for splitting a PDF into individual pages or a custom page range. Core PDF-tool feature; paired naturally with the existing organize engine. |
| F2 | **High** | **Unlock/decrypt encrypted PDFs** — `validatePdf` rejects encrypted PDFs with `PDFEncryptedError`. There is no engine to unlock them with a password. The error is surfaced to the user with no recovery path. |
| F3 | **Med** | **PDF compression/optimization** — No engine for reducing file size (image downsampling, re-compression, removing unused objects). Critical for mobile workflows where storage is limited. |
| F4 | **Med** | **PDF metadata editor** — No engine for reading or writing title, author, subject, keywords, or creation date. Standard feature for document management. |
| F5 | **Med** | **Booklet: configurable output paper size** — `makeBooklet` hardcodes A4 landscape (842×595 pt). No option for US Letter, A5, or custom sizes (`booklet-engine.ts:5–6`). |
| F6 | **Med** | **Image-to-PDF: Auto landscape detection** — Always creates A4 portrait pages. Landscape images (width > height) are scaled down to fit portrait A4 rather than using a landscape A4 page, wasting resolution. |
| F7 | **Low** | **Page numbers: Missing positions** — `top-left` and `top-center` are absent from `PageNumberPosition` (`page-numbers-engine.ts:5`). |
| F8 | **Low** | **Page numbers: Custom font/size** — `FONT_SIZE = 10` and `StandardFonts.Helvetica` are hardcoded (`page-numbers-engine.ts:20`). No user control over font face, size, or color. |
| F9 | **Low** | **Watermark: Per-page selection** — `addWatermark` applies the watermark to every page unconditionally. No option to skip specific pages (e.g., skip cover page, apply only to odd pages). |
| F10 | **Low** | **Perspective warp: PNG output option** — `warpPerspective` always outputs JPEG at hardcoded 90% quality (`perspective-warp.ts:264–271`). No option for lossless PNG output. |
| F11 | **Low** | **Booklet: Multi-signature support** — Only single-signature booklets are supported (all pages in one fold). No option for saddle-stitched multi-section booklets (e.g., signatures of 8 or 16 pages). |
