import { expect, test } from 'playwright/test'

const responsiveWidths = [1024, 720, 480, 320] as const
const behaviorStory = '/iframe.html?id=foundation-button--behavior-fixture&viewMode=story'
const overviewStory = '/iframe.html?id=foundation-action-and-status--overview&viewMode=story'
const surfaceOverviewStory = '/iframe.html?id=foundation-surface-and-content--overview&viewMode=story'
const textFieldsOverviewStory = '/iframe.html?id=foundation-text-fields--overview&viewMode=story'

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

test('action and status family keeps responsive semantics across browsers', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`${width}px overview has no document overflow`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(overviewStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Actions and status', exact: true })).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('semantic state remains available without visual inspection', async () => {
    await expect(page.getByRole('status').first()).toContainText('Saved')
    await expect(page.getByRole('alert')).toContainText('Connection failed')
    await expect(page.getByRole('progressbar', { name: 'Plugin migration' })).toHaveAttribute('aria-valuenow', '64')
    await expect(page.getByRole('progressbar', { name: 'Connecting to runtime' })).not.toHaveAttribute('aria-valuenow')
  })

  await test.step('interactive badge and alert actions expose keyboard focus', async () => {
    await page.goto('/iframe.html?id=foundation-badge--interactive&viewMode=story', { waitUntil: 'networkidle' })
    await expect(page.getByRole('link', { name: 'Open 4 filtered tasks' })).toBeFocused()

    await page.goto('/iframe.html?id=foundation-alert--with-action&viewMode=story', { waitUntil: 'networkidle' })
    await expect(page.getByRole('button', { name: 'Retry' })).toBeFocused()
  })

  await test.step('progress interaction updates the exact accessible value', async () => {
    await page.goto('/iframe.html?id=foundation-progress--behavior&viewMode=story', { waitUntil: 'networkidle' })
    await expect(page.getByRole('progressbar', { name: 'Migration' })).toHaveAttribute('aria-valuenow', '40')
  })

  expect(browserErrors).toEqual([])
})

test('surface and content family keeps disclosure and loading semantics across browsers', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`${width}px surface overview has no document overflow`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(surfaceOverviewStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Surface and content', exact: true })).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('collapsible retains focus and exact expanded state', async () => {
    await page.goto(surfaceOverviewStory, { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: 'Advanced retry policy', exact: true })
    await page.keyboard.press('Tab')
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText(/Retry failed dispatches twice/)).toBeVisible()
  })

  await test.step('loading and meaningful structure remain semantic', async () => {
    await page.goto(surfaceOverviewStory, { waitUntil: 'networkidle' })
    await expect(page.locator('section[aria-busy="true"]')).toHaveAttribute('aria-labelledby', 'loading-heading')
    await expect(page.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal')
    await expect(page.getByRole('group', { name: 'Three assigned agents' })).toBeVisible()
  })

  expect(browserErrors).toEqual([])
})

test('text fields keep native state, focus, and mobile-mode contracts across browsers', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`${width}px text-field overview has no document overflow`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(textFieldsOverviewStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Text fields', exact: true })).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('labels, native states, and explicit descriptions remain associated', async () => {
    const owner = page.getByLabel('Owner email')
    await page.getByText('Owner email', { exact: true }).click()
    await expect(owner).toBeFocused()
    await expect(owner).toHaveAttribute('required', '')
    await expect(owner).toHaveAttribute('inputmode', 'email')
    await expect(owner).toHaveAttribute('autocomplete', 'email')
    await expect(owner).toHaveAttribute('aria-describedby', 'overview-owner-description')
    await expect(page.getByLabel('Generated identifier')).toHaveAttribute('readonly', '')
    await expect(page.getByLabel('Managed source')).toBeDisabled()
    await expect(page.getByLabel('Webhook URL')).toHaveAttribute('aria-invalid', 'true')
  })

  await test.step('adornment text focuses the editable control without stealing button semantics', async () => {
    await page.goto('/iframe.html?id=foundation-inputgroup--adornments&viewMode=story', { waitUntil: 'networkidle' })
    const repository = page.getByLabel('Repository path')
    await page.getByText('github.com/', { exact: true }).click()
    await expect(repository).toBeFocused()
    await expect(page.getByRole('button', { name: 'Copy' })).toHaveAttribute('type', 'button')
    await expect(page.getByRole('textbox', { name: 'Execution prompt', exact: true })).toHaveAttribute('aria-invalid', 'true')
  })

  await test.step('specialized virtual-keyboard hints survive the public component', async () => {
    await page.goto('/iframe.html?id=foundation-input--states-and-mobile-modes&viewMode=story', { waitUntil: 'networkidle' })
    await expect(page.getByLabel('Required email')).toHaveAttribute('inputmode', 'email')
    await expect(page.getByLabel('Numeric mobile mode')).toHaveAttribute('inputmode', 'numeric')
    await expect(page.getByLabel('Numeric mobile mode')).toHaveAttribute('autocomplete', 'one-time-code')
  })

  expect(browserErrors).toEqual([])
})
