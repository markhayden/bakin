import { defineConfig } from 'playwright/test'

const baseURL = 'http://127.0.0.1:6108'
const prebuilt = process.env.BAKIN_UI_STORYBOOK_PREBUILT === '1'

export default defineConfig({
  testDir: './tests/ui/browser',
  testMatch: '**/*.browser.pw.ts',
  outputDir: 'test-results/ui-browser',
  // Behavior checks carry no pixel snapshots — tests are independent pages
  // against the static storybook server, so CI parallelism is safe. Local
  // stays serial (matches the historical debugging posture).
  // BAKIN_UI_WORKERS lets heavier engines run fewer workers: firefox
  // starves at 4 on a 4-vCPU runner (page.goto timeouts), chromium/webkit
  // are fine.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? Number(process.env.BAKIN_UI_WORKERS ?? 4) : 1,
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
  // BAKIN_UI_BROWSER shards CI by engine (one matrix job per browser);
  // unset runs all three (the local posture).
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' as const } },
    { name: 'firefox', use: { browserName: 'firefox' as const } },
    { name: 'webkit', use: { browserName: 'webkit' as const } },
  ].filter((project) => !process.env.BAKIN_UI_BROWSER || project.name === process.env.BAKIN_UI_BROWSER),
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
