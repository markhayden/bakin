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
const conversationPageStory = '/iframe.html?id=patterns-conversation-and-inspector--conversation&viewMode=story'
const conversationUnavailableStory = '/iframe.html?id=patterns-conversation-and-inspector--conversation-unavailable&viewMode=story'
const inspectorStory = '/iframe.html?id=patterns-conversation-and-inspector--inspector&viewMode=story'
const inspectorUnavailableStory = '/iframe.html?id=patterns-conversation-and-inspector--inspector-unavailable&viewMode=story'
const verticalWorkflowStory = '/iframe.html?id=patterns-workflow-and-action-pages--vertical-workflow&viewMode=story'
const horizontalWorkflowStory = '/iframe.html?id=patterns-workflow-and-action-pages--horizontal-workflow&viewMode=story'
const reviewActionStory = '/iframe.html?id=patterns-workflow-and-action-pages--review-action&viewMode=story'
const workflowUnavailableStory = '/iframe.html?id=patterns-workflow-and-action-pages--workflow-unavailable&viewMode=story'
const saveFailureStory = '/iframe.html?id=patterns-destructive-and-dirty-state--save-failure&viewMode=story'
const typedConfirmationStory = '/iframe.html?id=patterns-destructive-and-dirty-state--typed-confirmation&viewMode=story'
const unsavedExitStory = '/iframe.html?id=patterns-destructive-and-dirty-state--unsaved-exit-decision&viewMode=story'
const facetFilterStory = '/iframe.html?id=patterns-filters-and-navigation--facet-filtering&viewMode=story'
const agentFilterStory = '/iframe.html?id=patterns-filters-and-navigation--agent-filtering&viewMode=story'
const segmentedNavigationStory = '/iframe.html?id=patterns-filters-and-navigation--segmented-navigation&viewMode=story'
const underlineNavigationStory = '/iframe.html?id=patterns-filters-and-navigation--underline-navigation&viewMode=story'
const sortableTableStory = '/iframe.html?id=patterns-filters-and-navigation--sortable-table&viewMode=story'
const statusLanguageStory = '/iframe.html?id=patterns-status-and-metrics--status-language&viewMode=story'
const denseMetricsStory = '/iframe.html?id=patterns-status-and-metrics--dense-metrics&viewMode=story'
const actionableMetricsStory = '/iframe.html?id=patterns-status-and-metrics--actionable-metrics&viewMode=story'
const chartExactDataStory = '/iframe.html?id=charts-exact-data-and-compact-trends--exact-data-table&viewMode=story'
const chartPaletteStory = '/iframe.html?id=charts-exact-data-and-compact-trends--stable-palette&viewMode=story'
const chartCompactTrendsStory = '/iframe.html?id=charts-exact-data-and-compact-trends--compact-trends&viewMode=story'
const lineChartsStory = '/iframe.html?id=charts-line-bar-and-stacked-charts--line-charts&viewMode=story'
const barChartsStory = '/iframe.html?id=charts-line-bar-and-stacked-charts--bar-charts&viewMode=story'
const stackedColumnsStory = '/iframe.html?id=charts-line-bar-and-stacked-charts--stacked-columns&viewMode=story'
const conversationToolActivityStory = '/iframe.html?id=conversation-tool-activity--states-and-disclosure&viewMode=story'

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
    await page.goto('/iframe.html?id=foundation-dialog--nested-behavior&viewMode=story&bakin-browser-fixture=1', { waitUntil: 'networkidle' })
    await expect(page.locator('#storybook-root')).toHaveAttribute('data-story-ready', 'true')
    const outerTrigger = page.getByRole('button', { name: 'Open workflow settings' })
    await page.keyboard.press('Tab')
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

test('conversation and inspector recipes preserve explicit scroll, state, and action ownership', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const [story, heading] of [[conversationPageStory, 'Conversation with Patch'], [inspectorStory, 'Launch publishing workflow']] as const) {
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

  await test.step('contained conversation gives only the named log an internal scroller', async () => {
    await page.setViewportSize({ width: 720, height: 900 })
    await page.goto(conversationPageStory, { waitUntil: 'networkidle' })
    const body = page.locator('[data-slot="conversation-page-body"]')
    const timeline = page.getByRole('log', { name: 'Conversation with Patch' })
    const composer = page.locator('[data-slot="conversation-page-composer"]')
    await expect(body).toHaveAttribute('data-mode', 'contained')
    expect(await timeline.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto')
    expect(await body.evaluate((element) => getComputedStyle(element).overflowY)).toBe('hidden')
    expect(await composer.evaluate((element, log) => element.contains(log as Node), await timeline.elementHandle())).toBe(false)

    const input = page.getByRole('textbox', { name: 'Message Patch' })
    await input.fill('Keep the handoff explicit.')
    await input.press('Enter')
    await expect(timeline).toContainText('Keep the handoff explicit.')
    await expect(input).toHaveValue('')
  })

  await test.step('document conversation and unavailable inspector replace content but preserve identity and actions', async () => {
    await page.goto(conversationUnavailableStory, { waitUntil: 'networkidle' })
    await expect(page.locator('[data-slot="conversation-page-body"]')).toHaveAttribute('data-mode', 'document')
    await expect(page.getByRole('heading', { level: 1, name: 'Conversation with Patch' })).toBeVisible()
    await expect(page.getByText('Conversation history is restricted', { exact: true })).toBeVisible()

    await page.goto(inspectorUnavailableStory, { waitUntil: 'networkidle' })
    const inspector = page.getByRole('region', { name: 'Unknown node inspector' })
    await expect(inspector.getByRole('heading', { level: 2, name: 'Unsupported node' })).toBeVisible()
    await expect(inspector.getByRole('button', { name: 'Close' })).toBeVisible()
    await expect(inspector.getByRole('button', { name: 'Delete preserved step' })).toBeVisible()
    await expect(inspector.getByRole('alert', { name: 'This node cannot be inspected' })).toBeVisible()
  })

  await test.step('inspector keeps contextual editing inside one named region', async () => {
    await page.goto(inspectorStory, { waitUntil: 'networkidle' })
    const inspector = page.getByRole('region', { name: 'Assemble social video node inspector' })
    await expect(inspector.getByRole('heading', { level: 2, name: 'Assemble social video' })).toBeVisible()
    await inspector.getByLabel('Display name').fill('Assemble final social video')
    await inspector.getByRole('button', { name: 'Apply changes' }).click()
    await expect(inspector.getByText('Node updated')).toBeVisible()
  })

  await test.step('200% conversation text remains contained at the minimum supported width', async () => {
    await page.setViewportSize({ width: 320, height: 1000 })
    await page.goto(conversationPageStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})

test('workflow and action recipes preserve real graph interaction, bounded overflow, and page decisions', async ({ page, browserName }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    // WebKit reports React Flow's internal observer delivery as a page error even
    // though the observer settles and the graph remains fully operable.
    if (browserName === 'webkit' && error.message === 'ResizeObserver loop completed with undelivered notifications.') return
    browserErrors.push(`pageerror: ${error.message}`)
  })
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const [story, heading] of [[verticalWorkflowStory, 'Launch publishing workflow'], [horizontalWorkflowStory, 'Launch publishing workflow'], [reviewActionStory, 'Review launch publishing workflow']] as const) {
    for (const width of responsiveWidths) {
      await test.step(`${heading} remains contained at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto(story, { waitUntil: 'networkidle' })
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
        await expect(page.locator('.react-flow')).toBeVisible()
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
      })
    }
  }

  await test.step('vertical is the default and graph controls stay in named regions', async () => {
    await page.setViewportSize({ width: 1024, height: 1000 })
    await page.goto(verticalWorkflowStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('toolbar', { name: 'Workflow canvas tools' })).toBeVisible()
    const canvas = page.getByRole('region', { name: 'Vertical launch publishing workflow canvas' })
    await expect(canvas).toHaveAttribute('data-orientation', 'vertical')
    await expect(canvas.locator('.react-flow')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Selected workflow node inspector' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Workflow changes' })).toBeVisible()

    const status = page.locator('p.bakin-workflow-story__selection')
    const before = Number((await status.textContent())?.match(/y (\d+)/)?.[1])
    await page.getByRole('button', { name: 'Move down' }).click()
    await expect.poll(async () => Number((await status.textContent())?.match(/y (\d+)/)?.[1])).toBeGreaterThan(before)

    await page.getByRole('button', { name: 'Horizontal', exact: true }).click()
    const horizontalCanvas = page.getByRole('region', { name: 'Horizontal launch publishing workflow canvas' })
    await expect(horizontalCanvas).toHaveAttribute('data-orientation', 'horizontal')
    await expect(page.getByRole('button', { name: 'Move right' })).toBeVisible()
  })

  await test.step('horizontal topology supports native keyboard movement and explicit non-drag actions', async () => {
    await page.goto(horizontalWorkflowStory, { waitUntil: 'networkidle' })
    const node = page.getByRole('button', { name: /Assemble social video, transform node/ })
    await node.click()
    const status = page.locator('p.bakin-workflow-story__selection')
    const before = Number((await status.textContent())?.match(/x (\d+)/)?.[1])
    await node.press('ArrowRight')
    await expect.poll(async () => Number((await status.textContent())?.match(/x (\d+)/)?.[1])).toBeGreaterThan(before)
    const keyboardPosition = Number((await status.textContent())?.match(/x (\d+)/)?.[1])
    await page.getByRole('button', { name: 'Move right' }).click()
    await expect.poll(async () => Number((await status.textContent())?.match(/x (\d+)/)?.[1])).toBeGreaterThan(keyboardPosition)
  })

  await test.step('page-level review and unavailable decisions remain outside the graph', async () => {
    await page.goto(reviewActionStory, { waitUntil: 'networkidle' })
    const actions = page.getByRole('group', { name: 'Publishing review actions' })
    await expect(actions.getByRole('button', { name: 'Approve publishing' })).toBeVisible()
    await expect(page.getByText('Publishing review approved')).toBeVisible()

    await page.goto(workflowUnavailableStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'Legacy publishing workflow' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back to workflows' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete preserved workflow' })).toBeVisible()
    await expect(page.getByRole('alert', { name: 'Workflow graph is unavailable' })).toBeVisible()
  })

  await test.step('200% workflow text stays document-contained with canvas-owned horizontal fallback', async () => {
    await page.setViewportSize({ width: 320, height: 1000 })
    await page.goto(verticalWorkflowStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    const canvas = page.getByRole('region', { name: 'Vertical launch publishing workflow canvas' })
    const canvasDimensions = await canvas.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
    expect(canvasDimensions.scrollWidth).toBeGreaterThan(canvasDimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})

test('destructive and dirty-state patterns preserve focus, exact intent, and mobile action order', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`retryable save remains contained at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(saveFailureStory, { waitUntil: 'networkidle' })
      const saveBar = page.getByRole('region', { name: 'Unsaved changes' })
      await expect(saveBar).toHaveAttribute('data-savebar-state', 'error')
      await expect(saveBar.getByRole('alert')).toContainText('last published definition is still active')
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('narrow save actions stack full width without changing keyboard order', async () => {
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto(saveFailureStory, { waitUntil: 'networkidle' })
    const actions = page.getByRole('group', { name: 'Draft actions' })
    const discard = actions.getByRole('button', { name: 'Discard' })
    const retry = actions.getByRole('button', { name: 'Retry save' })
    await expect(discard).toBeVisible()
    await expect(retry).toBeVisible()
    expect((await discard.boundingBox())?.width).toBe((await retry.boundingBox())?.width)
    expect(await actions.getByRole('button').allTextContents()).toEqual(['Discard', 'Retry save'])
  })

  await test.step('typed confirmation requires an exact value and returns focus on cancel', async () => {
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto(typedConfirmationStory, { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: 'Delete archived workflow' })
    let dialog = page.getByRole('dialog', { name: 'Delete archived workflow?' })
    if (await dialog.isVisible()) {
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }
    await trigger.click()
    dialog = page.getByRole('dialog', { name: 'Delete archived workflow?' })
    const input = dialog.getByLabel(/Type launch-publishing to confirm/)
    await expect(input).toBeFocused()
    await input.fill('Launch-publishing')
    await expect(dialog.getByRole('button', { name: 'Delete workflow' })).toBeDisabled()
    await input.fill('launch-publishing')
    await expect(dialog.getByRole('button', { name: 'Delete workflow' })).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  await test.step('unsaved exit keeps save, cancel, and discard as distinct decisions', async () => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(unsavedExitStory, { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: 'Leave settings' })
    let dialog = page.getByRole('dialog', { name: 'Unsaved changes' })
    if (await dialog.isVisible()) {
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }
    await trigger.click()
    dialog = page.getByRole('dialog', { name: 'Unsaved changes' })
    await expect(dialog.getByRole('button', { name: 'Save and exit' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Discard changes' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  expect(browserErrors).toEqual([])
})

test('filter and navigation patterns preserve keyboard selection, meaning, and bounded overflow', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`facet filtering remains contained at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(facetFilterStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { level: 1, name: 'Keep filter state visible and reversible' })).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('facet search exposes counts and clearing without taking URL ownership', async () => {
    const dialog = page.getByRole('dialog', { name: 'Filter by State' })
    await expect(dialog).toBeVisible()
    const search = dialog.getByRole('combobox', { name: 'Search State' })
    await search.fill('Running')
    await dialog.getByRole('option', { name: 'Running 12' }).click()
    await expect(page.getByRole('button', { name: 'State, 2 selected' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Clear State filters' }).click()
    await expect(page.getByRole('status')).toHaveText('Showing every task state')
  })

  await test.step('agent and compact view groups activate with arrow keys and skip disabled choices', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(agentFilterStory, { waitUntil: 'networkidle' })
    const allAgents = page.getByRole('radio', { name: 'All agents' })
    await allAgents.focus()
    await allAgents.press('ArrowRight')
    await expect(page.getByRole('radio', { name: 'Patch' })).toHaveAttribute('aria-checked', 'true')

    await page.goto(segmentedNavigationStory, { waitUntil: 'networkidle' })
    const taskView = page.getByRole('tablist', { name: 'Task view' })
    const sizing = await taskView.evaluate((element) => ({
      outer: element.clientWidth,
      visual: element.querySelector<HTMLElement>('[data-slot="segmented-control-list"]')?.getBoundingClientRect().width ?? 0,
    }))
    expect(Math.abs(sizing.outer - sizing.visual)).toBeLessThanOrEqual(1)
    const board = page.getByRole('tab', { name: 'Board' })
    await board.focus()
    await board.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Operational log with preserved context' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel')).toContainText('Operational log')
  })

  await test.step('page tabs link panels and sorting announces its direction', async () => {
    await page.goto(underlineNavigationStory, { waitUntil: 'networkidle' })
    const overview = page.getByRole('tab', { name: 'Overview' })
    await overview.focus()
    await overview.press('End')
    const activity = page.getByRole('tab', { name: 'Activity and recent operational history' })
    await expect(activity).toHaveAttribute('aria-controls', 'runtime-panel-activity')
    await expect(page.getByRole('tabpanel')).toContainText('Activity and recent operational history')

    await page.goto(sortableTableStory, { waitUntil: 'networkidle' })
    const updated = page.getByRole('columnheader', { name: 'Updated' })
    await expect(updated).toHaveAttribute('aria-sort', 'descending')
    await updated.getByRole('button').click()
    await expect(updated).toHaveAttribute('aria-sort', 'ascending')
  })

  await test.step('200% text preserves document containment and local horizontal fallbacks', async () => {
    await page.setViewportSize({ width: 320, height: 1000 })
    await page.goto(segmentedNavigationStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    const tablist = page.getByRole('tablist', { name: 'Task view' })
    const tabDimensions = await tablist.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
    expect(tabDimensions.scrollWidth).toBeGreaterThan(tabDimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})

test('status and metric patterns preserve visible meaning, exact values, and native actions', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const [story, heading] of [
    [statusLanguageStory, 'Say what changed, even without color'],
    [denseMetricsStory, 'Keep technical metrics dense and honest'],
    [actionableMetricsStory, 'Use a surface only when the metric is an object'],
  ] as const) {
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

  await test.step('every status keeps a visible label and canonical tone', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(statusLanguageStory, { waitUntil: 'networkidle' })
    for (const [label, tone] of [
      ['Draft', 'neutral'],
      ['Published', 'success'],
      ['Needs review', 'attention'],
      ['Blocked', 'danger'],
      ['Working now', 'accent'],
    ] as const) {
      const badge = page.locator('[data-status-badge]').filter({ hasText: label })
      await expect(badge).toBeVisible()
      await expect(badge).toHaveAttribute('data-tone', tone)
    }
    await expect(page.locator('[data-status-badge]').filter({ hasText: 'Published' }).locator('[aria-hidden="true"]')).toBeVisible()
  })

  await test.step('plain metrics retain exact accessible progress values', async () => {
    await page.goto(denseMetricsStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('progressbar', { name: 'Success rate' })).toHaveAttribute('aria-valuenow', '91.4')
    await expect(page.getByRole('progressbar', { name: 'Plugin migration coverage' })).toHaveAttribute('aria-valuenow', '91.428')
    await expect(page.locator('[data-stat-tile][data-variant="plain"]')).toHaveCount(4)
    const longLabel = page.getByText('Plugin migration coverage across official surfaces', { exact: true })
    expect(await longLabel.evaluate((element) => getComputedStyle(element).textOverflow)).not.toBe('ellipsis')
  })

  await test.step('surface metrics are native keyboard actions with retained focus', async () => {
    await page.goto(actionableMetricsStory, { waitUntil: 'networkidle' })
    const blocked = page.getByRole('button', { name: /Blocked tasks 3/ })
    await blocked.focus()
    await expect(blocked).toBeFocused()
    await blocked.press('Enter')
    await expect(page.getByRole('status')).toHaveText('Blocked tasks selected')
    await expect(blocked).toBeFocused()
  })

  await test.step('200% text remains document-contained', async () => {
    await page.setViewportSize({ width: 320, height: 1000 })
    await page.goto(denseMetricsStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expect(page.getByText('Plugin migration coverage across official surfaces', { exact: true })).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})

test('chart foundation preserves exact data, stable labels, gaps, and bounded overflow', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const [story, heading] of [
    [chartExactDataStory, 'A chart summary never hides the evidence'],
    [chartPaletteStory, 'Color follows the entity, not the filter'],
    [chartCompactTrendsStory, 'Shape supports the number; it does not replace it'],
  ] as const) {
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

  await test.step('exact table keeps missing values distinct and owns narrow overflow', async () => {
    await page.setViewportSize({ width: 320, height: 1000 })
    await page.goto(chartExactDataStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('cell', { name: 'Still processing' })).toHaveAttribute('data-missing', 'true')
    const region = page.getByRole('region', { name: 'Run outcomes exact data table' })
    await expect(region).toHaveAttribute('tabindex', '0')
    const dimensions = await region.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth)
    const disclosure = page.getByText('View Run outcomes exact data', { exact: true })
    await disclosure.focus()
    await disclosure.press('Enter')
    await expect(disclosure.locator('..')).not.toHaveAttribute('open', '')
    await disclosure.press('Enter')
    await expect(disclosure.locator('..')).toHaveAttribute('open', '')
    await region.focus()
    await region.press('ArrowRight')
    await expect.poll(
      () => region.evaluate((element) => element.scrollLeft),
      { message: 'the focused overflow region should respond to native arrow-key scrolling' },
    ).toBeGreaterThan(0)
  })

  await test.step('palette meaning remains visible without reading swatch color', async () => {
    await page.goto(chartPaletteStory, { waitUntil: 'networkidle' })
    await expect(page.getByText('Series slot 2')).toBeVisible()
    await expect(page.getByText('Other group', { exact: true })).toHaveCount(2)
    await expect(page.getByText('basil', { exact: true })).toBeVisible()
  })

  await test.step('sparkline point detail works from focus and missing windows stay gaps', async () => {
    await page.goto(chartCompactTrendsStory, { waitUntil: 'networkidle' })
    const point = page.getByRole('img', { name: 'Window 2: 24' })
    await point.focus()
    await expect(point).toBeFocused()
    await expect(page.getByRole('tooltip')).toHaveText('Window 2: 24')
    const median = page.getByRole('group', { name: 'Median queue time across the last six reporting windows' })
    await expect(median.locator('[role="img"]')).toHaveCount(5)
    await expect(page.getByText('Down 38 seconds from the prior window')).toBeVisible()
  })

  await test.step('200% text preserves document containment', async () => {
    await page.setViewportSize({ width: 320, height: 1000 })
    await page.goto(chartCompactTrendsStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expect(page.getByRole('heading', { name: 'Retry rate for scheduled workflows with delayed third-party acknowledgements' })).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})

test('visual charts preserve honest marks, exact data, and local plot overflow', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const [story, heading] of [
    [lineChartsStory, 'A missing point is a gap, not a collapse to zero'],
    [barChartsStory, 'Choose grouped bars for peers and stacked bars for totals'],
    [stackedColumnsStory, 'Stable entities stay legible as the series count grows'],
  ] as const) {
    for (const width of responsiveWidths) {
      await test.step(`${heading} remains document-contained at ${width}px`, async () => {
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

  await test.step('line gaps stay absent while exact missing values and keyboard detail remain', async () => {
    await page.setViewportSize({ width: 320, height: 1000 })
    await page.goto(lineChartsStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('img', { name: /Window 3 — Recovered/ })).toHaveCount(0)
    await expect(page.locator('[data-slot="line-chart"] td[data-missing="true"]').filter({ hasText: 'Not reported' })).toHaveCount(1)
    const mark = page.getByRole('img', { name: 'Window 4 — Recovered after retry: 3' })
    await mark.focus()
    await expect(mark).toBeFocused()
    await expect(page.getByRole('tooltip')).toHaveText('Window 4 — Recovered after retry: 3')

    const plot = page.getByRole('region', { name: 'Workflow outcomes plot' })
    const dimensions = await plot.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth)
    await plot.focus()
    await plot.press('ArrowRight')
    await expect.poll(() => plot.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  })

  await test.step('grouped and stacked bars expose the same series values', async () => {
    await page.goto(barChartsStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('group', { name: 'Grouped workflow outcomes' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Stacked workflow outcomes' })).toBeVisible()
    const mark = page.getByRole('img', { name: 'Window 2 — Failed: 3' }).first()
    await mark.focus()
    await expect(mark).toBeFocused()
    await expect(page.getByRole('tooltip')).toHaveText('Window 2 — Failed: 3')
    await expect(page.locator('[data-slot="bar-chart"]').first().locator('[data-slot="chart-exact-table"]')).toContainText('Not reported')
  })

  await test.step('stacked columns expose missing, partial, Other, and visible toggle meaning', async () => {
    await page.goto(stackedColumnsStory, { waitUntil: 'networkidle' })
    const missing = page.getByRole('img', { name: 'Jul 17: Not reported' })
    await expect(missing).toHaveAttribute('data-missing', 'true')
    await expect(page.getByRole('img', { name: /Jul 20 · still accumulating \(in progress\)/ })).toHaveAttribute('data-partial', 'true')
    await expect(page.getByRole('button', { name: 'Other (2)' })).toBeVisible()
    const firstSeries = page.getByRole('button', { name: 'agent-01' })
    await expect(firstSeries).toHaveAttribute('aria-pressed', 'true')
    await firstSeries.click()
    await expect(page.getByRole('button', { name: 'agent-01 (hidden)' })).toHaveAttribute('aria-pressed', 'false')
    await missing.focus()
    await expect(page.getByRole('tooltip')).toHaveText('Jul 17: Not reported')
  })

  await test.step('200% text preserves document containment and plot ownership', async () => {
    await page.setViewportSize({ width: 320, height: 1000 })
    await page.goto(stackedColumnsStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expect(page.getByRole('heading', { name: 'Stable entities stay legible as the series count grows' })).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    await expect(page.getByRole('region', { name: 'Agent activity by day plot' })).toBeVisible()
  })

  expect(browserErrors).toEqual([])
})

test('conversation tool activity preserves disclosure, exact status, motion, and containment', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`tool activity remains document-contained at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(conversationToolActivityStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { level: 1, name: 'Keep activity compact without hiding what happened' })).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('native disclosure retains focus and exact expanded state', async () => {
    await page.setViewportSize({ width: 1024, height: 1000 })
    await page.goto(conversationToolActivityStory, { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: /Searched the web.*3 calls.*1 failed/i })
    await trigger.focus()
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await trigger.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const call = page.getByRole('button', { name: /web_search.*Found seven release notes.*completed/i })
    expect((await call.boundingBox())?.height).toBeGreaterThanOrEqual(24)
    await call.click()
    await expect(page.getByRole('status')).toHaveText('Opened web_search: search-1')
  })

  await test.step('status meaning survives reduced motion', async () => {
    await expect(page.getByText('failed', { exact: true })).toBeVisible()
    await expect(page.getByText('running', { exact: true })).toBeVisible()
    const spinner = page.locator('[data-call-status="running"] [aria-hidden="true"]')
    await expect(spinner).toBeVisible()
    expect(await spinner.evaluate((element) => getComputedStyle(element).animationName)).toBe('none')
  })

  await test.step('200% text remains document-contained', async () => {
    await page.setViewportSize({ width: 320, height: 1000 })
    await page.goto(conversationToolActivityStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expect(page.getByText('No tool activity')).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})
