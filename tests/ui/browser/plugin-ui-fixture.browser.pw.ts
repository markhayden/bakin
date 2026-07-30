import { expect, test, type Page, type Request } from 'playwright/test'

const registeredStory = '/iframe.html?id=testing-plugin-ui-fixture-host--registered-page-and-slots&viewMode=story'
const mobileStory = '/iframe.html?id=testing-plugin-ui-fixture-host--mobile-page-and-slots&viewMode=story'
const statesStory = '/iframe.html?id=testing-plugin-ui-fixture-host--canonical-system-states&viewMode=story'

function isCancelledStorybookA11yInstrumentation(request: Request): boolean {
  const failure = request.failure()?.errorText
  if (failure !== 'Load request cancelled') return false
  return /^\/assets\/axe-[^/]+\.js$/.test(new URL(request.url()).pathname)
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (isCancelledStorybookA11yInstrumentation(request)) return
    errors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })
  return errors
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
}

test('public plugin fixture mounts production routes, slots, and isolated portals', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(registeredStory, { waitUntil: 'networkidle' })
  const host = page.locator('[data-bakin-plugin-fixture-host]')
  await expect(host).toHaveAttribute('data-bakin-plugin-fixture-viewport', 'desktop')
  await expect(page.getByRole('heading', { name: 'Item 42' })).toBeVisible()
  await expect(page.getByText('The routed query remains an opaque string: 001.')).toBeVisible()

  const slotOwners = page.locator('[data-bakin-plugin-fixture-slot="fixture-toolbar"] [data-bakin-plugin]')
  await expect(slotOwners).toHaveCount(2)
  await expect(slotOwners.nth(0)).toHaveAttribute('data-bakin-plugin', 'fixture-alpha')
  await expect(slotOwners.nth(1)).toHaveAttribute('data-bakin-plugin', 'fixture-bravo')

  const overlays = page.locator('[data-plugin-fixture-overlay]')
  await expect(overlays).toHaveCount(2)
  const portalOwners = await overlays.evaluateAll((nodes) => nodes.map((node) => ({
    owner: node.closest('[data-bakin-plugin-portal]')?.getAttribute('data-bakin-plugin'),
    border: getComputedStyle(node).borderInlineStartColor,
  })))
  expect(portalOwners.map(({ owner }) => owner).sort()).toEqual(['fixture-alpha', 'fixture-bravo'])
  expect(new Set(portalOwners.map(({ border }) => border)).size).toBe(2)
  await expect(page.locator('[data-bakin-plugin-fixture-overlay-root]').locator('xpath=ancestor::*[@data-bakin-plugin]'))
    .toHaveCount(0)

  await page.getByRole('link', { name: 'Open item 43' }).click()
  await expect(page.getByRole('heading', { name: 'Item 43' })).toBeVisible()
  await expect(page.getByText('The routed query remains an opaque string: 002.')).toBeVisible()
  await expectNoDocumentOverflow(page)

  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto(mobileStory, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-bakin-plugin-fixture-host]'))
    .toHaveAttribute('data-bakin-plugin-fixture-viewport', 'mobile')
  await expect(page.getByRole('heading', { name: 'Item 42' })).toBeVisible()
  await expectNoDocumentOverflow(page)

  expect(browserErrors).toEqual([])
})

test('public plugin fixture exposes every canonical surface state', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(statesStory, { waitUntil: 'networkidle' })
  const host = page.locator('[data-bakin-plugin-fixture-host]')

  // The story's own play cycles every state and terminates on
  // permission-denied; wait for that terminal state so our clicks below
  // never interleave with the play's.
  await expect(host).toHaveAttribute('data-bakin-plugin-fixture-state', 'permission-denied')

  for (const state of ['ready', 'initial-empty', 'no-results', 'loading', 'error', 'permission-denied']) {
    await page.getByRole('button', { name: state, exact: true }).click()
    await expect(host).toHaveAttribute('data-bakin-plugin-fixture-state', state)
    if (state === 'ready') {
      await expect(page.getByRole('heading', { name: 'Item 42' })).toBeVisible()
    } else {
      await expect(host.locator('[data-slot="system-state"]')).toHaveAttribute('data-kind', state)
    }
  }

  expect(browserErrors).toEqual([])
})
