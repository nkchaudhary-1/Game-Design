import { defineConfig } from '@playwright/test';

const PORT = 8099;

export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
    chromiumSandbox: false,
    launchOptions: {
      args: ['--no-sandbox'],
      ...(process.env.CHROMIUM_PATH || process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' } : {}),
    },
  },
  webServer: {
    command: `cd .. && npm run build && TIMER_SCALE=0.15 PORT=${PORT} node server/dist/index.js`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
