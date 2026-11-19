import { defineConfig } from 'vite';

// The client is plain Vite. In dev, src/server/main.ts embeds Vite as middleware so one process
// (one port) serves the page and the game WebSocket at /ws.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as Parameters<typeof defineConfig>[0]);
