import { expect, test } from 'playwright/test'

const responsiveWidths = [1024, 720, 480, 320] as const
const behaviorStory = '/iframe.html?id=foundation-button--behavior-fixture&viewMode=story'
const overviewStory = '/iframe.html?id=foundation-action-and-status--overview&viewMode=story'
const surfaceOverviewStory = '/iframe.html?id=foundation-surface-and-content--overview&viewMode=story'
const textFieldsOverviewStory = '/iframe.html?id=foundation-text-fields--overview&viewMode=story'
const selectionOverviewStory = '/iframe.html?id=foundation-selection-controls--overview&viewMode=story'
const modalOverviewStory = '/iframe.html?id=foundation-modal-and-side-overlays--overview&viewMode=story'
const anchoredOverviewStory = '/iframe.html?id=foundation-anchored-overlays--overview&viewMode=story'
const layoutFlowStory = '/iframe.html?id=layout-pageshell-and-flow--responsive-page&viewMode=story'

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

test('selection controls keep keyboard, state, target, and overflow contracts across browsers', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`${width}px selection overview has no document overflow`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(selectionOverviewStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Selection controls', exact: true })).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('long labels remain contained at 200% text sizing', async () => {
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto(selectionOverviewStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expect(page.getByText('Mirror protected runtime metadata with its complete long-form policy label')).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  await test.step('checkbox and switch retain labelled keyboard state', async () => {
    await page.goto('/iframe.html?id=foundation-checkbox--behavior&viewMode=story', { waitUntil: 'networkidle' })
    const checkbox = page.getByRole('checkbox', { name: 'Include archived tasks' })
    await expect(checkbox).toBeFocused()
    await expect(checkbox).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Partially selected workspaces' })).toHaveAttribute('aria-checked', 'mixed')
    expect((await checkbox.boundingBox())?.height).toBeGreaterThanOrEqual(24)

    await page.goto('/iframe.html?id=foundation-switch--behavior&viewMode=story', { waitUntil: 'networkidle' })
    const control = page.getByRole('switch', { name: 'Automatic retry' })
    await expect(control).toBeFocused()
    await expect(control).toBeChecked()
    await expect(page.getByRole('status')).toHaveText('Enabled')
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(24)
  })

  await test.step('select opens, groups, blocks disabled activation, selects, and returns focus', async () => {
    await page.goto('/iframe.html?id=foundation-select--behavior&viewMode=story', { waitUntil: 'networkidle' })
    const trigger = page.getByRole('combobox', { name: 'Execution runtime' })
    await expect(trigger).toBeFocused()
    await expect(trigger).toContainText('Pi')
    await expect(page.getByRole('listbox')).toBeHidden()
    expect((await trigger.boundingBox())?.height).toBeGreaterThanOrEqual(24)

    await trigger.press('Enter')
    await expect(page.getByRole('listbox')).toBeVisible()
    const unavailable = page.getByRole('option', { name: 'Unavailable runtime' })
    await expect(unavailable).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('End')
    await expect(unavailable).toHaveAttribute('data-highlighted', '')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('listbox')).toBeVisible()
    await expect(trigger).toContainText('Pi')
    await page.keyboard.press('ArrowUp')
    const managed = page.getByRole('option', { name: /Managed production runtime/ })
    await expect(managed).toHaveAttribute('data-highlighted', '')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('listbox')).toBeHidden()
    await expect(trigger).toContainText('Managed production runtime')
    await expect(trigger).toBeFocused()
  })

  expect(browserErrors).toEqual([])
})

test('modal and side overlays keep focus, dismissal, motion, and viewport contracts across browsers', async ({ page }) => {
  test.setTimeout(60_000)
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`${width}px overlay overview has no document overflow`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(modalOverviewStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Modal and side overlays', exact: true })).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('nested dialog escape closes one layer at a time and returns focus', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/iframe.html?id=foundation-dialog--nested-behavior&viewMode=story', { waitUntil: 'networkidle' })
    const outerTrigger = page.getByRole('button', { name: 'Open workflow settings' })
    await expect(outerTrigger).toBeFocused()
    await outerTrigger.click()
    const outerDialog = page.getByRole('dialog', { name: 'Workflow settings' })
    await expect(outerDialog).toBeVisible()
    const nestedTrigger = outerDialog.getByRole('button', { name: 'Reset workflow', exact: true })
    await nestedTrigger.click()
    await expect(page.getByRole('dialog', { name: 'Reset this workflow?' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(nestedTrigger).toBeFocused()
    await expect(outerDialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(outerTrigger).toBeFocused()
  })

  await test.step('busy dialogs block every dismissal path and expose state', async () => {
    await page.goto('/iframe.html?id=foundation-dialog--busy&viewMode=story', { waitUntil: 'networkidle' })
    const dialog = page.getByRole('dialog', { name: 'Publishing workflow' })
    await expect(dialog).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByRole('button', { name: 'Close dialog' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden')
  })

  await test.step('mobile side sheets fill the viewport and disable motion', async () => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/iframe.html?id=foundation-sheet--right-panel&viewMode=story', { waitUntil: 'networkidle' })
    const sheet = page.getByRole('dialog', { name: 'Edit task' })
    const bounds = await sheet.boundingBox()
    expect(bounds?.width).toBe(320)
    expect(bounds?.height).toBe(800)
    const animations = await sheet.evaluate((element) => element.getAnimations({ subtree: true }).map((animation) => animation.effect?.getTiming().duration ?? 0))
    expect(animations.every((duration) => duration === 0)).toBe(true)
  })

  await test.step('BakinDrawer resize and dirty confirmation remain keyboard operable', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/iframe.html?id=foundation-bakindrawer--dirty-behavior&viewMode=story', { waitUntil: 'networkidle' })
    const resizer = page.getByRole('separator', { name: 'Resize panel' })
    const initialWidth = Number(await resizer.getAttribute('aria-valuenow'))
    await resizer.focus()
    await page.keyboard.press('ArrowRight')
    await expect(resizer).toHaveAttribute('aria-valuenow', String(Math.max(initialWidth - 16, 320)))
    await page.getByRole('button', { name: 'Close panel' }).click()
    const dirtyDialog = page.getByRole('dialog', { name: 'Unsaved changes' })
    await expect(dirtyDialog).toBeVisible()
    await page.getByRole('button', { name: 'Keep editing' }).click()
    await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  })

  expect(browserErrors).toEqual([])
})

test('anchored overlays keep collision, keyboard, focus, and labelling contracts across browsers', async ({ page }) => {
  test.setTimeout(60_000)
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`${width}px anchored overview has no document overflow`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(anchoredOverviewStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Context without disorientation', exact: true })).toBeVisible()
      const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('popover remains viewport-bounded and returns focus on Escape', async () => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/iframe.html?id=foundation-popover--behavior&viewMode=story', { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: 'Open route context' })
    await trigger.click()
    const content = page.locator('[data-slot="popover-content"]')
    await expect(content).toBeVisible()
    const bounds = await content.boundingBox()
    expect((bounds?.x ?? -1) >= 0).toBe(true)
    expect((bounds?.x ?? 0) + (bounds?.width ?? 321)).toBeLessThanOrEqual(320)
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  })

  await test.step('menu subnavigation and shortcut naming remain semantic', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/iframe.html?id=foundation-dropdownmenu--behavior&viewMode=story', { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: 'Task actions' })
    await trigger.click()
    await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('menuitem', { name: 'Needs attention' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  })

  await test.step('tooltip opens from keyboard focus and dismisses without moving focus', async () => {
    await page.goto('/iframe.html?id=foundation-tooltip--behavior&viewMode=story&bakinCrossBrowser=1', { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: 'Show retry guidance' })
    await trigger.focus()
    await expect(trigger).toBeFocused()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  await test.step('command filtering and dialog focus restoration remain keyboard operable', async () => {
    await page.goto('/iframe.html?id=foundation-command--dialog-behavior&viewMode=story', { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: 'Open command palette' })
    await trigger.click()
    const input = page.getByRole('combobox', { name: 'Find a task action' })
    await input.fill('blocked')
    await expect(page.getByRole('option', { name: 'Mark blocked' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  })

  expect(browserErrors).toEqual([])
})

test('page and flow layout follows its container without document overflow', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  const expectedInlinePadding = new Map([[1024, 32], [720, 32], [480, 24], [320, 16]])
  for (const width of responsiveWidths) {
    await test.step(`${width}px page rhythm remains contained`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(layoutFlowStory, { waitUntil: 'networkidle' })
      const shell = page.locator('[data-slot="page-shell"]')
      const content = page.locator('[data-slot="page-shell-content"]')
      await expect(page.getByRole('heading', { name: 'Coordinate active work' })).toBeVisible()
      await expect(shell).toHaveAttribute('data-width', 'wide')

      const measurements = await content.evaluate((element) => {
        const styles = getComputedStyle(element)
        return {
          clientWidth: document.documentElement.clientWidth,
          paddingInlineStart: Number.parseFloat(styles.paddingInlineStart),
          right: element.getBoundingClientRect().right,
          scrollWidth: document.documentElement.scrollWidth,
        }
      })
      expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.clientWidth)
      expect(measurements.right).toBeLessThanOrEqual(width)
      expect(measurements.paddingInlineStart).toBe(expectedInlinePadding.get(width))
    })
  }

  await expect(page.getByRole('navigation', { name: 'Page actions' })).toBeVisible()
  expect(browserErrors).toEqual([])
})
