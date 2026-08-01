import { defineConfig } from 'playwright/test'

const baseURL = 'http://127.0.0.1:6108'
const prebuilt = process.env.BAKIN_UI_STORYBOOK_PREBUILT === '1'

export default defineConfig({
  testDir: './tests/ui/browser',
  testMatch: '**/*.browser.pw.ts',
  outputDir: 'test-results/ui-browser',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['line'],
    ['html', { outputFolder: 'playwright-report/ui-browser', open: 'never' }],
  ],
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    colorScheme: 'dark',
    contextOptions: {
      reducedMotion: 'reduce',
    },
    locale: 'en-US',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    video: 'off',
    viewport: { width: 1024, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: prebuilt
      ? 'node scripts/ui/serve-storybook.mjs'
      : 'bun run ui:test:serve',
    env: { BAKIN_UI_STORYBOOK_PORT: '6108' },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
