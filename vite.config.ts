import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          // MUST come before the pdf-lib rule: '@pdf-lib/fontkit' also contains
          // 'pdf-lib', so without this it is swept into the pdf-lib chunk, which
          // every PDF operation loads eagerly — inflating it from ~420kB to
          // ~1.1MB for a font embedder only the text watermark needs.
          if (id.includes('@pdf-lib/fontkit')) return 'fontkit';
          if (id.includes('pdf-lib')) return 'pdf-lib';
        },
      },
    },
  },
});
