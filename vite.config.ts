import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: process.env.SINGLE
    ? { target: 'es2022', chunkSizeWarningLimit: 9000, assetsInlineLimit: 100_000_000, cssCodeSplit: false }
    : { target: 'es2022', chunkSizeWarningLimit: 2500 },
  server: { host: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as Parameters<typeof defineConfig>[0]);
