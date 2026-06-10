import { defineConfig, devices } from '@playwright/test';

// E2e tests drive the real app in web mode (/web.html, fixture backend).
// webkit runs first: it's the same engine family as the WKWebView the desktop
// app ships in. Files are *.e2e.ts so `bun test src` (unit) and Playwright
// never discover each other's tests.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:5176',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
      },
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    // Runs inside the devbox env of the invoking command (bun run test:e2e).
    command: 'bunx vite --port 5176 --strictPort',
    url: 'http://localhost:5176/web.html',
    reuseExistingServer: !process.env.CI,
  },
});
