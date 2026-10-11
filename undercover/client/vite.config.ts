import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const demoOnly = process.env.LOCAL_BUILD === '1';

export default defineConfig({
  plugins: [react()],
  base: demoOnly ? './' : '/',
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/healthz': 'http://localhost:8080',
    },
  },
  build: {
    outDir: demoOnly ? 'dist-local' : 'dist',
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      input: demoOnly ? { local: resolve(__dirname, 'local.html') } : { main: resolve(__dirname, 'index.html'), local: resolve(__dirname, 'local.html') },
    },
  },
});
