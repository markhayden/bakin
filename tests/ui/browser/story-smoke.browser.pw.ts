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
const layoutRecipesStory = '/iframe.html?id=layout-grid-section-and-overflow--responsive-composition&viewMode=story'
const formOverviewStory = '/iframe.html?id=forms-field-and-form-composition--overview&viewMode=story'
const asyncValidationStory = '/iframe.html?id=forms-field-and-form-composition--async-validation&viewMode=story'
const submissionWorkflowStory = '/iframe.html?id=forms-field-and-form-composition--submission-workflow&viewMode=story'
const systemStateStory = '/iframe.html?id=states-system-state-and-feedback--state-matrix&viewMode=story'
const feedbackStory = '/iframe.html?id=states-system-state-and-feedback--feedback&viewMode=story'
const listPageStory = '/iframe.html?id=patterns-list-and-detail-pages--list-index&viewMode=story'
const listNoResultsStory = '/iframe.html?id=patterns-list-and-detail-pages--list-no-results&viewMode=story'
const detailPageStory = '/iframe.html?id=patterns-list-and-detail-pages--detail&viewMode=story'
const detailUnavailableStory = '/iframe.html?id=patterns-list-and-detail-pages--detail-unavailable&viewMode=story'
const settingsPageStory = '/iframe.html?id=patterns-settings-and-dashboard-pages--settings-categories&viewMode=story'
const settingsUnavailableStory = '/iframe.html?id=patterns-settings-and-dashboard-pages--settings-unavailable&viewMode=story'
const dashboardPageStory = '/iframe.html?id=patterns-settings-and-dashboard-pages--dashboard-overview&viewMode=story'
const dashboardUnavailableStory = '/iframe.html?id=patterns-settings-and-dashboard-pages--dashboard-unavailable&viewMode=story'

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

test('grid recipes reflow by container and bound intrinsic overflow', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  const expectedColumns = new Map([[1024, 4], [720, 3], [480, 2], [320, 1]])
  for (const width of responsiveWidths) {
    await test.step(`${width}px grid selects its named responsive recipe`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(layoutRecipesStory, { waitUntil: 'networkidle' })
      const grid = page.getByTestId('responsive-grid')
      await expect(grid).toHaveAttribute('data-layout', 'quarters')
      const measurements = await grid.evaluate((element) => ({
        columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
      }))
      expect(measurements.columns).toBe(expectedColumns.get(width))
      expect(measurements.documentScrollWidth).toBeLessThanOrEqual(measurements.documentClientWidth)
    })
  }

  await test.step('wide content remains keyboard reachable inside its labelled boundary', async () => {
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto(layoutRecipesStory, { waitUntil: 'networkidle' })
    const overflow = page.getByRole('region', { name: 'Active operation details' })
    await overflow.focus()
    await expect(overflow).toBeFocused()
    const measurements = await overflow.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
    expect(measurements.scrollWidth).toBeGreaterThan(measurements.clientWidth)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => overflow.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  })

  expect(browserErrors).toEqual([])
})

test('canonical forms keep association, validation, submission, and mobile action contracts', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`${width}px form composition remains contained`, async () => {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(formOverviewStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'One form language for every builder' })).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('real controls own their mechanical label and message associations', async () => {
    await page.setViewportSize({ width: 1024, height: 1000 })
    await page.goto(formOverviewStory, { waitUntil: 'networkidle' })
    const workspaceName = page.getByRole('textbox', { name: 'Workspace name' })
    await page.getByText('Workspace name', { exact: true }).click()
    await expect(workspaceName).toBeFocused()
    await expect(workspaceName).toHaveAttribute('required', '')

    const descriptionId = await page.getByText('Shown in page chrome and plugin-contributed sections.').getAttribute('id')
    expect((await workspaceName.getAttribute('aria-describedby'))?.split(' ')).toContain(descriptionId)

    const domain = page.getByRole('textbox', { name: 'Public asset domain' })
    const domainErrorId = await page.getByText('Enter a valid hostname without spaces.').getAttribute('id')
    await expect(domain).toHaveAttribute('aria-invalid', 'true')
    expect((await domain.getAttribute('aria-describedby'))?.split(' ')).toContain(domainErrorId)
    await expect(page.getByRole('group', { name: 'Contribution settings' })).toHaveAttribute('aria-describedby', /.+/)
  })

  await test.step('mobile actions stack into full-width controls', async () => {
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto(formOverviewStory, { waitUntil: 'networkidle' })
    const actions = page.getByRole('form', { name: 'Workspace settings specimen' }).locator('[data-slot="form-actions"]')
    const cancel = actions.getByRole('button', { name: 'Cancel' })
    const save = actions.getByRole('button', { name: 'Save settings' })
    expect(await actions.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('column')
    expect(Math.round((await cancel.boundingBox())?.width ?? 0)).toBe(Math.round((await actions.boundingBox())?.width ?? -1))
    expect(Math.round((await save.boundingBox())?.width ?? 0)).toBe(Math.round((await actions.boundingBox())?.width ?? -1))
  })

  await test.step('async validation announces and clears its field-level error', async () => {
    await page.setViewportSize({ width: 720, height: 900 })
    await page.goto(asyncValidationStory, { waitUntil: 'networkidle' })
    const slug = page.getByRole('textbox', { name: 'Plugin slug' })
    await slug.fill('workflow-tools')
    await slug.press('Tab')
    await expect(page.getByRole('alert')).toHaveText('Use a plugin- prefix.')
    await expect(slug).toHaveAttribute('aria-invalid', 'true')
    await slug.fill('plugin-workflow-tools')
    await slug.press('Tab')
    await expect(page.getByText('Use a plugin- prefix.')).toBeHidden()
  })

  await test.step('server failure returns to the field and a later submission succeeds', async () => {
    await page.goto(submissionWorkflowStory, { waitUntil: 'networkidle' })
    const slug = page.getByRole('textbox', { name: 'Plugin slug' })
    await slug.fill('plugin-existing')
    await page.getByRole('button', { name: 'Register plugin' }).click()
    await expect(page.getByRole('button', { name: 'Registering plugin' })).toBeDisabled()
    await expect(page.getByText('This plugin slug is already registered.')).toBeVisible()
    await expect(slug).toHaveAttribute('aria-invalid', 'true')

    await slug.fill('plugin-routing-tools')
    await page.getByRole('button', { name: 'Register plugin' }).click()
    await expect(page.getByRole('status')).toContainText('Plugin registered')
  })

  expect(browserErrors).toEqual([])
})

test('system states keep recovery, announcement, motion, and responsive contracts', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`${width}px state matrix remains contained`, async () => {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(systemStateStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Every data surface tells the truth' })).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('state cause controls semantics and recovery', async () => {
    await expect(page.getByRole('status', { name: 'No workflows match' })).toHaveAttribute('aria-live', 'polite')
    await expect(page.getByRole('status', { name: 'Loading workflows' })).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByRole('alert', { name: 'Workflows could not be refreshed' })).toHaveAttribute('data-recovery', 'available')
    await expect(page.getByRole('alert', { name: 'Run history expired' })).toHaveAttribute('data-recovery', 'unavailable')
    await expect(page.getByText('Workflow details are restricted').locator('..').locator('..')).not.toHaveAttribute('role')
  })

  await test.step('loading motion has a stable reduced-motion presentation', async () => {
    const signal = page.getByRole('status', { name: 'Loading workflows' }).locator('[data-slot="system-state-signal"]')
    const animations = await signal.evaluate((element) => element.getAnimations({ subtree: true }).map((animation) => animation.effect?.getTiming().duration ?? 0))
    expect(animations.every((duration) => duration === 0)).toBe(true)
  })

  await test.step('feedback roles and dismissal stay operable', async () => {
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto(feedbackStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('region', { name: 'Example notifications' })).toBeVisible()
    await expect(page.getByRole('status', { name: 'Runtime reconnected' })).toHaveAttribute('aria-live', 'polite')
    const errorToast = page.getByRole('alert', { name: 'Action failed' })
    await expect(errorToast).toBeVisible()
    await page.getByRole('button', { name: 'Dismiss notification' }).click()
    await expect(errorToast).toBeHidden()
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})

test('list and detail recipes preserve page identity, state slots, and responsive scroll ownership', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const [story, heading] of [[listPageStory, 'Coordinate active work'], [detailPageStory, 'Launch approval']] as const) {
    for (const width of responsiveWidths) {
      await test.step(`${heading} remains contained at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto(story, { waitUntil: 'networkidle' })
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
      })
    }
  }

  await test.step('list controls filter the named result region without replacing page chrome', async () => {
    await page.setViewportSize({ width: 720, height: 900 })
    await page.goto(listPageStory, { waitUntil: 'networkidle' })
    const filter = page.getByRole('button', { name: 'Needs attention' })
    await filter.click()
    await expect(filter).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('region', { name: 'Task results' }).getByRole('listitem')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: 'Coordinate active work' })).toBeVisible()
  })

  await test.step('replacement states retain identity and their controlling region', async () => {
    await page.goto(listNoResultsStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('region', { name: 'Task list controls' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Task results' })).toHaveAttribute('data-content-state', 'replaced')
    await expect(page.getByRole('status', { name: 'No tasks match this view' })).toBeVisible()

    await page.goto(detailUnavailableStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'Archived campaign approval' })).toBeVisible()
    await expect(page.getByText('Workflow definition is restricted')).toBeVisible()
  })

  await test.step('detail aside reflows without creating a nested page scroller', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(detailPageStory, { waitUntil: 'networkidle' })
    const grid = page.locator('[data-slot="detail-page-grid"] [data-slot="grid"]')
    expect((await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length))).toBe(2)
    await page.setViewportSize({ width: 320, height: 900 })
    expect((await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length))).toBe(1)
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe('scroll')
  })

  await test.step('200% text remains contained at the minimum supported width', async () => {
    await page.setViewportSize({ width: 320, height: 1000 })
    await page.goto(listPageStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})

test('settings and dashboard recipes preserve priority, named regions, and responsive ownership', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const [story, heading] of [[settingsPageStory, 'Settings'], [dashboardPageStory, 'Keep Bakin ready to work']] as const) {
    for (const width of responsiveWidths) {
      await test.step(`${heading} remains contained at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto(story, { waitUntil: 'networkidle' })
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
      })
    }
  }

  await test.step('settings categories preserve the named active form region', async () => {
    await page.setViewportSize({ width: 720, height: 1000 })
    await page.goto(settingsPageStory, { waitUntil: 'networkidle' })
    const navigation = page.getByRole('navigation', { name: 'Settings categories' })
    await expect(navigation).toBeVisible()
    await page.getByRole('button', { name: 'Extensions' }).click()
    await expect(page.getByRole('region', { name: 'Extensions', exact: true })).toHaveAttribute('data-content-state', 'ready')
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()

    await page.goto(settingsUnavailableStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('navigation', { name: 'Settings categories' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Integrations and keys settings' })).toHaveAttribute('data-content-state', 'replaced')
    await expect(page.getByRole('alert', { name: 'Integration settings could not be loaded' })).toBeVisible()
  })

  await test.step('settings navigation and dashboard metrics reflow without nested page scrolling', async () => {
    await page.setViewportSize({ width: 1024, height: 1000 })
    await page.goto(settingsPageStory, { waitUntil: 'networkidle' })
    const navigation = page.getByRole('navigation', { name: 'Settings categories' })
    expect(await navigation.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('column')
    await page.setViewportSize({ width: 320, height: 1000 })
    expect(await navigation.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('row')

    await page.goto(dashboardPageStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('region', { name: 'Health overview' })).toHaveAttribute('data-content-state', 'ready')
    await expect(page.locator('dt').filter({ hasText: /^Active agents$/ })).toBeVisible()
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe('scroll')
  })

  await test.step('dashboard replacement state keeps page actions and identity', async () => {
    await page.goto(dashboardUnavailableStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'Runtime capabilities' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Runtime capability overview' })).toHaveAttribute('data-content-state', 'replaced')
    await expect(page.getByRole('alert', { name: 'Runtime capabilities are unavailable' })).toBeVisible()
  })

  await test.step('200% dashboard text remains contained at the minimum supported width', async () => {
    await page.setViewportSize({ width: 320, height: 1000 })
    await page.goto(dashboardPageStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})
