import { expect, test } from 'playwright/test'

test('public Button visual baseline', async ({ page }, testInfo) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  await page.goto('/iframe.html?id=foundation-button--default&viewMode=story', { waitUntil: 'networkidle' })
  const button = page.locator('#storybook-root').getByRole('button', { name: 'Continue', exact: true })
  await expect(button).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)

  await expect(page.locator('html')).toHaveAttribute('data-bakin-color-scheme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-bakin-reduced-motion', 'true')
  expect(await page.evaluate(() => new Date().toISOString())).toBe('2026-01-15T12:00:00.000Z')
  expect(testInfo.project.use.viewport).toEqual(
    testInfo.project.name === 'chromium-desktop'
      ? { width: 1440, height: 900 }
      : { width: 320, height: 800 },
  )

  if (process.env.BAKIN_UI_VISUAL_SEED_DIFF === '1') {
    await page.addStyleTag({
      content: '#storybook-root { transform: translateX(12px) !important; }',
    })
  }

  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('foundation-button.png')
})

test('public action and status family visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  await page.goto('/iframe.html?id=foundation-action-and-status--overview&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Actions and status', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create task', exact: true })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Plugin migration', exact: true })).toHaveAttribute('aria-valuenow', '64')
  await page.evaluate(async () => document.fonts.ready)

  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('foundation-action-status.png')
})
