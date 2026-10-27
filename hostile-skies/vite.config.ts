import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Hostile Skies lives beside Spinblade Arena and shares its node_modules (three, fonts, tooling) but builds on its own:
//   npm run skies           dev server on :5174
//   npm run skies:build     dist-skies/
//   npm run skies:single    dist-skies-single/hostile-skies.html (one self-contained file)
const here = import.meta.dirname;
const single = !!process.env.SINGLE;

export default defineConfig({
  root: here,
  base: './',
  cacheDir: resolve(here, '../node_modules/.vite-skies'),
  server: { host: true, port: 5174, fs: { allow: [resolve(here, '..')] } },
  preview: { host: true, port: 4174 },
  build: {
    outDir: resolve(here, single ? '../dist-skies-single' : '../dist-skies'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 9000,
    ...(single ? { assetsInlineLimit: 100_000_000, cssCodeSplit: false } : {}),
  },
});
