import { defineConfig } from 'vite';

// Single-file build for the Artifact page (see scripts/make-artifact.mjs). Everything is inlined: JS, CSS, fonts.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-artifact', emptyOutDir: true, target: 'es2022', cssCodeSplit: false,
    assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 4000,
    rollupOptions: { input: 'artifact.html', output: { format: 'iife', inlineDynamicImports: true } },
  },
} as Parameters<typeof defineConfig>[0]);
