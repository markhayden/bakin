import { defineConfig } from 'playwright/test'

const baseURL = 'http://127.0.0.1:6107'
const prebuilt = process.env.BAKIN_UI_STORYBOOK_PREBUILT === '1'

export default defineConfig({
  testDir: './tests/ui/visual',
  testMatch: '**/*.visual.ts',
  outputDir: 'test-results/ui-visual',
  snapshotPathTemplate: 'tests/ui/snapshots/{projectName}/{testFilePath}/{arg}{ext}',
  // Snapshot captures are per-test-isolated pages; two CI workers halve the
  // wall clock without changing rendering. Local (including the canonical
  // update-snapshots run) stays serial so baseline generation keeps its
  // proven posture.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: [
    ['line'],
    ['html', { outputFolder: 'playwright-report/ui', open: 'never' }],
  ],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixels: 0,
      scale: 'css',
      threshold: 0.1,
    },
  },
  use: {
    baseURL,
    browserName: 'chromium',
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    locale: 'en-US',
    contextOptions: {
      reducedMotion: 'reduce',
    },
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium-mobile',
      use: {
        hasTouch: true,
        isMobile: true,
        viewport: { width: 320, height: 800 },
      },
    },
  ],
  webServer: {
    command: prebuilt
      ? 'node scripts/ui/serve-storybook.mjs'
      : 'bun run ui:test:serve',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
