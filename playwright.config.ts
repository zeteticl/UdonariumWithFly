import { defineConfig, devices } from '@playwright/test';

/**
 * Optional smoke E2E (P4). Run locally:
 *   npx playwright install chromium
 *   npm run e2e:smoke
 *
 * CI may skip if Playwright browsers are not cached.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'https://127.0.0.1:4200',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/write-git-version.mjs && npx ng serve --ssl --host 127.0.0.1 --port 4200',
    url: 'https://127.0.0.1:4200',
    reuseExistingServer: !process.env.CI,
    ignoreHTTPSErrors: true,
    timeout: 180_000,
  },
});
