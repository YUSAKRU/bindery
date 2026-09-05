// Standalone perf probe (not a vitest test — .bench.mjs is outside vitest's
// `test.include`, so `npm run test` never touches it) for renderReaderList()'s
// page-aspect scan loop in src/ui/app.ts. Run manually:
//   node --expose-gc src/native/pdf-reader-scan.bench.mjs
//
// Mirrors the exact loop shape from renderReaderList:
//   SIZE_SCAN_BATCH = 8
//   for (start += 8) { batch of doc.proxy.getPage(p).then(page => page.getViewport({scale:1})) }
//   await Promise.all(batch) before moving to the next group
//
// Caveat: production wires pdfjsLib.GlobalWorkerOptions.workerSrc to a real
// Web Worker, so document parsing happens off the main thread in the browser.
// This Node benchmark uses pdfjs-dist's "legacy" build, which runs the
// "worker" in-process (fake worker) — so it's a pessimistic stand-in for
// main-thread cost; real-world blocking should be less than what's measured here.

import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const SIZE_SCAN_BATCH = 8;
const A4 = [595.28, 841.89];
const LETTER = [612, 792];

async function makeSyntheticPdf(numPages, { mixedSizes = false, withText = false } = {}) {
  const doc = await PDFDocument.create();
  const font = withText ? await doc.embedFont(StandardFonts.Helvetica) : null;
  for (let i = 0; i < numPages; i += 1) {
    const size = mixedSizes && i % 3 === 0 ? LETTER : A4;
    const page = doc.addPage(size);
    if (font) {
      for (let line = 0; line < 20; line += 1) {
        page.drawText(`Page ${i + 1} — line ${line} of synthetic body text for benchmarking.`, {
          x: 50,
          y: size[1] - 60 - line * 20,
          size: 11,
          font,
        });
      }
    }
  }
  return doc.save();
}

/** Exact port of renderReaderList's aspect-scan loop. */
async function scanPageAspects(proxy, numPages, { onBatch } = {}) {
  const aspects = new Array(numPages);
  for (let start = 1; start <= numPages; start += SIZE_SCAN_BATCH) {
    const end = Math.min(numPages, start + SIZE_SCAN_BATCH - 1);
    const batchStart = performance.now();
    const batch = [];
    for (let p = start; p <= end; p += 1) {
      batch.push(
        proxy.getPage(p).then((page) => {
          const vp = page.getViewport({ scale: 1 });
          aspects[p - 1] = vp.height / vp.width;
        }),
      );
    }
    await Promise.all(batch);
    onBatch?.(performance.now() - batchStart, start, end);
  }
  return aspects;
}

function fmtMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function runCase(label, numPages, opts) {
  const bytes = await makeSyntheticPdf(numPages, opts);

  if (global.gc) global.gc();
  const memBefore = process.memoryUsage();

  const loadStart = performance.now();
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const proxy = await loadingTask.promise;
  const loadMs = performance.now() - loadStart;

  let maxBatchMs = 0;
  let totalBatches = 0;
  const scanStart = performance.now();
  const aspects = await scanPageAspects(proxy, numPages, {
    onBatch: (ms) => {
      maxBatchMs = Math.max(maxBatchMs, ms);
      totalBatches += 1;
    },
  });
  const scanMs = performance.now() - scanStart;

  if (global.gc) global.gc();
  const memAfter = process.memoryUsage();

  await loadingTask.destroy();

  console.log(
    `\n=== ${label} (${numPages} pages${opts?.mixedSizes ? ', mixed sizes' : ''}${opts?.withText ? ', with text' : ''}) ===`,
  );
  console.log(`  file size:        ${fmtMB(bytes.byteLength)}`);
  console.log(`  document load:    ${loadMs.toFixed(1)} ms`);
  console.log(`  aspect scan total:${scanMs.toFixed(1)} ms  (${totalBatches} batches of ${SIZE_SCAN_BATCH})`);
  console.log(`  worst single batch: ${maxBatchMs.toFixed(1)} ms`);
  console.log(`  avg batch:          ${(scanMs / totalBatches).toFixed(2)} ms`);
  console.log(`  heapUsed delta:     ${fmtMB(memAfter.heapUsed - memBefore.heapUsed)}`);
  console.log(`  rss delta:          ${fmtMB(memAfter.rss - memBefore.rss)}`);
  console.log(`  aspects sampled:    first=${aspects[0]?.toFixed(4)} last=${aspects[aspects.length - 1]?.toFixed(4)}`);

  return { label, numPages, loadMs, scanMs, maxBatchMs, totalBatches };
}

async function main() {
  const results = [];
  results.push(await runCase('uniform A4', 50));
  results.push(await runCase('uniform A4', 150));
  results.push(await runCase('uniform A4', 500));
  results.push(await runCase('mixed sizes', 500, { mixedSizes: true }));
  results.push(await runCase('text-heavy', 500, { withText: true }));

  console.log('\n=== Summary (scan-loop time = the part renderReaderList spends before painting placeholders) ===');
  for (const r of results) {
    console.log(
      `${r.label.padEnd(12)} ${String(r.numPages).padStart(4)}p -> scan ${r.scanMs.toFixed(1)}ms total, worst batch ${r.maxBatchMs.toFixed(1)}ms`,
    );
  }
}

main().catch((e) => {
  console.error('BENCH FAILED', e);
  process.exit(1);
});
