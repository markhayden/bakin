import { expect, test } from 'playwright/test'

const responsiveWidths = [1024, 720, 480, 320] as const
const behaviorStory = '/iframe.html?id=foundation-button--behavior-fixture&viewMode=story'

test('public story keeps keyboard, focus, console, and responsive contracts', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`${width}px has no document overflow`, async () => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(behaviorStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('primary action retains visible keyboard focus and activation', async () => {
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto(behaviorStory, { waitUntil: 'networkidle' })
    const button = page.getByRole('button', { name: 'Continue', exact: true })
    await page.keyboard.press('Tab')
    await expect(button).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status')).toHaveText('Activated')
  })

  expect(browserErrors).toEqual([])
})
