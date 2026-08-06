import { expect, test } from 'playwright/test'

test('public Button visual baseline', async ({ page }, testInfo) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
  })

  await page.goto('/iframe.html?id=primitives-button--canonical-usage&viewMode=story', { waitUntil: 'networkidle' })
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
  await expect(page).toHaveScreenshot('primitives-button.png')
})


test('public dialog decision visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
  })

  await page.goto('/iframe.html?id=overlays-dialog--decision&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('dialog', { name: 'Delete runtime connection?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close dialog' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)

  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('overlays-dialog.png')
})

test('public right sheet visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
  })

  await page.goto('/iframe.html?id=overlays-sheet--right-panel&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  await expect(page.getByLabel('Title')).toHaveValue('Review routing migration evidence')
  await page.evaluate(async () => document.fonts.ready)

  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('overlays-sheet.png')
})

test('public Drawer visual baseline', async ({ page }, testInfo) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
  })

  await page.goto('/iframe.html?id=overlays-drawer--default&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('dialog', { name: 'Task detail' })).toBeVisible()
  const resizer = page.locator('[role="separator"][aria-label="Resize panel"]')
  if (testInfo.project.name === 'chromium-desktop') {
    await expect(resizer).toHaveAttribute('aria-valuenow', '810')
  } else {
    await expect(resizer).toBeHidden()
  }
  await page.evaluate(async () => document.fonts.ready)

  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('overlays-drawer.png')
})

test('public Popover visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`) })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`))

  await page.goto('/iframe.html?id=overlays-popover--context&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.locator('[data-slot="popover-content"]')).toBeVisible()
  await expect(page.getByText('Active filters', { exact: true })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('overlays-popover.png')
})

test('public DropdownMenu visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`) })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`))

  await page.goto('/iframe.html?id=overlays-dropdownmenu--actions&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('menu', { name: 'Task actions' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('data-variant', 'danger')
  await page.evaluate(async () => document.fonts.ready)
  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('overlays-dropdown-menu.png')
})

test('public Tooltip visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`) })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`))

  await page.goto('/iframe.html?id=overlays-tooltip--supplemental-help&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('tooltip')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Explain blocked state' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('overlays-tooltip.png')
})

test('public Command visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`) })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`))

  await page.goto('/iframe.html?id=navigation-command--search&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('combobox', { name: 'Find a task action' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Open task' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('navigation-command.png')
})

test('public PageShell and flow visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=layout-pageshell--responsive-page&viewMode=story')
  await expect(page.getByRole('heading', { name: 'Coordinate active work' })).toBeVisible()
  await expect(page).toHaveScreenshot('layout-page-shell.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public responsive layout recipes visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=layout-grid--responsive-recipes&viewMode=story')
  await expect(page.getByRole('heading', { name: 'Structure changes with available space' })).toBeVisible()
  await expect(page).toHaveScreenshot('layout-grid.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public canonical form composition visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=forms-field-and-form-composition--overview&viewMode=story')
  await expect(page.getByRole('heading', { name: 'One form language for every builder' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-form-composition.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public system-state matrix visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=feedback-systemstate--state-matrix&viewMode=story')
  await expect(page.getByRole('heading', { name: 'Every data surface tells the truth' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('feedback-system-state.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public toast feedback visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=feedback-toast--tones-and-actions&viewMode=story')
  await expect(page.getByRole('alert', { name: 'Action failed' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('feedback-toast.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public banner feedback visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=feedback-banner--tones-and-actions&viewMode=story')
  await expect(page.getByRole('status', { name: 'Runtime reconnected' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('feedback-banner.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public list/index page recipe visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=recipes-list-and-detail-pages--list-index&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Coordinate active work' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-list-page.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public page header controls visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=recipes-list-and-detail-pages--list-header-controls&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Task search, view, and actions' })).toBeVisible()
  await expect(page.locator('[data-slot="search-input-control"]')).toHaveAttribute('data-state', 'empty')
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-page-header-controls.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public detail page recipe visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=recipes-list-and-detail-pages--detail&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Launch approval' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Workflow context' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-detail-page.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public settings page recipe visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=recipes-settings-and-dashboard-pages--settings-categories&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Settings categories' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-settings-page.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public dashboard page recipe visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=recipes-settings-and-dashboard-pages--dashboard-overview&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Keep Bakin ready to work' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Health overview' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-dashboard-page.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public conversation page recipe visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=recipes-conversation-and-inspector-pages--conversation&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Conversation with Patch' })).toBeVisible()
  await expect(page.getByRole('log', { name: 'Conversation with Patch' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-conversation-page.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public inspector recipe visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=recipes-conversation-and-inspector-pages--inspector&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Launch publishing workflow' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Assemble social video node inspector' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-inspector-panel.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public vertical workflow recipe visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=recipes-workflow-and-action-pages--vertical-workflow&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Launch publishing workflow' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Vertical launch publishing workflow canvas' })).toHaveAttribute('data-orientation', 'vertical')
  await expect(page.locator('.react-flow')).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-workflow-vertical.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public horizontal workflow recipe visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=recipes-workflow-and-action-pages--horizontal-workflow&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Launch publishing workflow' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Horizontal launch publishing workflow canvas' })).toHaveAttribute('data-orientation', 'horizontal')
  await expect(page.locator('.react-flow')).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-workflow-horizontal.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public retryable save pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=forms-savebar--save-failure&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Keep a failed draft actionable' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Unsaved changes' })).toHaveAttribute('data-savebar-state', 'error')
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('forms-save-bar.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public typed confirmation pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=feedback-confirmdialog--typed-confirmation&viewMode=story')
  const dialog = page.getByRole('dialog', { name: 'Delete archived workflow?' })
  if (!await dialog.isVisible()) {
    await page.getByRole('button', { name: 'Delete archived workflow' }).click()
  }
  await expect(dialog).toBeVisible()
  await page.getByLabel(/Type launch-publishing to confirm/).fill('launch')
  await expect(dialog.getByRole('button', { name: 'Delete workflow' })).toBeDisabled()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('feedback-confirm-dialog.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public facet filter pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=navigation-facetfilter--facet-filtering&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Keep filter state visible and reversible' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Filter by State' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Needs attention because a dependency is unavailable Selected 3' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('navigation-facet-filter.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public compact search behavior visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=navigation-searchinput--long-query&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Expand search without moving the page' })).toBeVisible()
  await expect(page.locator('[data-slot="search-input-control"]')).toHaveAttribute('data-state', 'filled')
  await expect(page.getByRole('status')).toContainText('blocked launch approval tasks')
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('navigation-search-input.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public agent filter pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=agents-agentselect--agent-filtering&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Filter by an agent without losing names' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Filter by agent' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('agents-agent-filter.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public segmented navigation pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=navigation-segmentedcontrol--segmented-navigation&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Switch modes with one compact control' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Task view' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('navigation-segmented-control.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public underline navigation pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=navigation-tabs--underline-navigation&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Keep page sections anchored to their content' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Runtime sections' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('navigation-tabs.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public sortable table pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=navigation-sortablehead--sortable-table&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Put sort meaning on the column header' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute('aria-sort', 'descending')
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('navigation-sortable-head.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public status language pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=feedback-statusbadge--status-vocabulary&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Say what changed, even without color' })).toBeVisible()
  await expect(page.locator('[data-status-badge]').filter({ hasText: 'Published' })).toHaveAttribute('data-tone', 'success')
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('feedback-status-badge.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public dense metrics pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=charts-stattile--dense-metrics&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Keep technical metrics dense and honest' })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Plugin migration coverage' })).toHaveAttribute('aria-valuenow', '91.428')
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('charts-stat-tile.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public actionable metrics pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=charts-stattile--actionable-metrics&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Use a surface only when the metric is an object' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Needs review 8/ })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('charts-stat-tile-actionable.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public exact chart data visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=charts-chartdatatable--exact-data-disclosure&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'A chart summary never hides the evidence' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Run outcomes exact data' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('charts-chart-data-table.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public chart palette visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=charts-stackedcolumnchart--stable-palette&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Color follows the entity, not the filter' })).toBeVisible()
  await expect(page.getByText('Slot 1')).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('charts-stacked-column-palette.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public compact chart trends visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=charts-sparkline--compact-trends&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Shape supports the number; it does not replace it' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Completed tasks across the last six reporting windows' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('charts-sparkline.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public line chart visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=charts-linechart--missing-data-and-empty&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'A missing point is a gap, not a collapse to zero' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Workflow outcomes' })).toBeVisible()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await expect.poll(() => page.getByRole('region', { name: 'Workflow outcomes plot' }).evaluate((element) => element.scrollLeft)).toBe(0)
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('charts-line-chart.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public bar chart visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=charts-barchart--grouped-and-stacked&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Choose grouped bars for peers and stacked bars for totals' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Grouped workflow outcomes' })).toBeVisible()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('charts-bar-chart.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public stacked column chart visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=charts-stackedcolumnchart--dense-composition&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Stable entities stay legible as the series count grows' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'agent-01' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('charts-stacked-column-chart.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public conversation tool activity visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=conversation-tool-activity--states-and-disclosure&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Keep activity compact without hiding what happened' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Searched the web.*3 calls.*1 failed/i })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('No tool activity')).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-conversation-tool-activity.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public conversation header visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=conversation-header--canonical-usage&viewMode=story')
  await expect(page.getByText('Release review')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: /Context 45\.3k of 272k/ })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-conversation-header.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public context meter states visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=conversation-header--meter-states&viewMode=story')
  await expect(page.getByRole('progressbar', { name: /\(91%\)/ })).toBeVisible()
  await expect(page.getByText(/compacted/)).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-context-meter-states.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public conversation turns visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=conversation-turns-and-messages--complete-and-lifecycle-states&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Keep the speaker and state unmistakable' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Your message' })).toBeVisible()
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-conversation-turns.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public document-first conversation timeline visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=conversation-timeline-and-empty-state--document-timeline&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Review the release plan' })).toBeVisible()
  await expect(page.getByRole('log', { name: 'Release plan review' })).toBeVisible()
  await expect(page.locator('[data-conv-timeline]')).toHaveAttribute('data-mode', 'document')
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-conversation-timeline.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public contained conversation and empty state visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=conversation-timeline-and-empty-state--contained-and-empty-states&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Bounded history and a useful starting point' })).toBeVisible()
  await expect(page.locator('[data-conv-scroller]').first()).toHaveClass(/overflow-y-auto/)
  await expect(page.getByRole('button', { name: 'Check blocked routes' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-conversation-empty.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public product conversation composer visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=conversation-composer-and-attachments--product-composer&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Ask a focused follow-up' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message the release agent' })).toBeVisible()
  await expect(page.getByRole('separator', { name: 'Resize message input' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-conversation-composer.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public conversation composer attachment states visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=conversation-composer-and-attachments--attachment-and-availability-states&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Keep attachment and reply state unambiguous' })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Uploading release-evidence.png' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Upload failed')
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-conversation-composer-states.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public embedded conversation panel visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=conversation-panel-and-tool-detail--product-panel&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Coordinate an embedded release review' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Release review' })).toBeVisible()
  await expect(page.getByRole('separator', { name: 'Resize conversation panel' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-conversation-panel.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public exact tool detail visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=conversation-panel-and-tool-detail--exact-tool-detail&viewMode=story')
  await expect(page.getByRole('dialog', { name: 'route_audit' })).toBeVisible()
  await expect(page.getByText(/Captured output was truncated/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy output' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-conversation-tool-detail.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

// Primitives entries (storybook-refit T2.1): one baseline per migrated entry.
// Anchors target each story's play end-state; toHaveScreenshot's stability
// polling absorbs any remaining play settle.
const PRIMITIVES_BASELINES = [
  { url: '/iframe.html?id=primitives-input--states-and-mobile-modes&viewMode=story', png: 'primitives-input.png', role: 'textbox' as const, name: 'Invalid URL', unstableContent: true },
  { url: '/iframe.html?id=primitives-textarea--content-and-states&viewMode=story', png: 'primitives-textarea.png', role: 'textbox' as const, name: 'Required rationale' },
  { url: '/iframe.html?id=primitives-label--association&viewMode=story', png: 'primitives-label.png', text: 'Project name' },
  { url: '/iframe.html?id=primitives-inputgroup--adornments&viewMode=story', png: 'primitives-inputgroup.png', text: 'Repository path' },
  { url: '/iframe.html?id=primitives-badge--canonical-usage&viewMode=story', png: 'primitives-badge.png', text: 'Published' },
  { url: '/iframe.html?id=primitives-avatar--canonical-usage&viewMode=story', png: 'primitives-avatar.png', text: 'MB' },
  { url: '/iframe.html?id=primitives-card--canonical-usage&viewMode=story', png: 'primitives-card.png', text: 'Resolve launch blockers' },
  { url: '/iframe.html?id=primitives-card--interactive-card&viewMode=story', png: 'primitives-card-interactive.png', role: 'button' as const, name: 'Open Spring launch' },
  { url: '/iframe.html?id=primitives-card--media-cover&viewMode=story', png: 'primitives-card-media-cover.png', text: 'Daybreak Studio' },
  { url: '/iframe.html?id=primitives-card--row-media&viewMode=story', png: 'primitives-card-row-media.png', text: 'Gourmet seasoned popcorn' },
  { url: '/iframe.html?id=primitives-card--selected-and-tone&viewMode=story', png: 'primitives-card-selected-tone.png', text: 'Dispatch failed' },
  { url: '/iframe.html?id=primitives-card--meta-footer&viewMode=story', png: 'primitives-card-meta-footer.png', text: '2 steps · custom' },
  { url: '/iframe.html?id=primitives-separator--orientation&viewMode=story', png: 'primitives-separator.png', text: 'Deployment policy' },
  { url: '/iframe.html?id=primitives-checkbox--states&viewMode=story', png: 'primitives-checkbox.png', text: 'Partially selected' },
  { url: '/iframe.html?id=primitives-switch--states&viewMode=story', png: 'primitives-switch.png', text: 'Compact operational setting' },
  { url: '/iframe.html?id=primitives-select--states&viewMode=story', png: 'primitives-select.png', text: 'Canonical states' },
  { url: '/iframe.html?id=primitives-collapsible--canonical-usage&viewMode=story', png: 'primitives-collapsible.png', role: 'button' as const },
  { url: '/iframe.html?id=feedback-skeleton--loading-object&viewMode=story', png: 'feedback-skeleton.png', text: 'Loading assigned workflow' },
  { url: '/iframe.html?id=feedback-progress--tones&viewMode=story', png: 'feedback-progress.png', text: 'Approaching budget limit' },
  { url: '/iframe.html?id=feedback-alert--tones&viewMode=story', png: 'feedback-alert.png', text: 'Connection failed' },
  { url: '/iframe.html?id=feedback-statusmarker--dense-view-markers&viewMode=story', png: 'feedback-status-marker.png', role: 'img' as const, name: 'Published' },
  { url: '/iframe.html?id=charts-statgroup--compact-metrics&viewMode=story', png: 'charts-stat-group.png', role: 'group' as const, name: 'Task summary metrics' },
  { url: '/iframe.html?id=feedback-search-trust-states--availability-and-evidence&viewMode=story', png: 'feedback-search-trust.png', role: 'note' as const, name: 'Search relevance details' },
  { url: '/iframe.html?id=forms-assetpicker--inline-attach-relink-and-states&viewMode=story', png: 'forms-asset-picker.png', text: 'Reuse the same chooser inside attach and relink flows' },
  { url: '/iframe.html?id=forms-modelselect--grouped-catalog&viewMode=story', png: 'forms-model-select.png', text: 'Keep catalog choices explicit' },
  { url: '/iframe.html?id=forms-colorpicker--palette-choices&viewMode=story', png: 'forms-color-picker.png', text: 'Keep palette choices explicit' },
  { url: '/iframe.html?id=feedback-dangerzone--consequence-first-placement&viewMode=story', png: 'feedback-danger-zone.png', text: 'Separate dangerous work from routine settings' },
  { url: '/iframe.html?id=forms-unsavedchangesdialog--canonical-usage&viewMode=story', png: 'forms-unsaved-changes-dialog.png', role: 'dialog' as const, name: 'Unsaved changes' },
  { url: '/iframe.html?id=forms-plugin-settings-renderer--messaging-schema-workflow&viewMode=story', png: 'forms-plugin-settings-renderer.png', text: 'Let plugin settings feel native without hiding their rules' },
  { url: '/iframe.html?id=recipes-destructive-settings-flow--settings-flow&viewMode=story', png: 'recipes-destructive-settings-flow.png', text: 'Workspace deletion confirmed' },
  { url: '/iframe.html?id=navigation-pagination--paged-boundaries&viewMode=story', png: 'navigation-pagination.png', text: 'Showing 21–40 of 94' },
  { url: '/iframe.html?id=charts-rankedbarchart--ranked-comparison&viewMode=story', png: 'charts-ranked-bar-chart.png', text: 'Rank long labels without forcing them onto an axis' },
  { url: '/iframe.html?id=charts-chartexplainer--canonical-usage&viewMode=story', png: 'charts-chart-explainer.png', role: 'note' as const },
  { url: '/iframe.html?id=charts-piechart--donut-fold-and-empty&viewMode=story', png: 'charts-pie-chart.png', text: 'Five slices is the ceiling for part-to-whole' },
  { url: '/iframe.html?id=charts-areachart--stacked-and-missing-data&viewMode=story', png: 'charts-area-chart.png', text: 'The line carries identity; the fill carries magnitude' },
  { url: '/iframe.html?id=charts-compositionbar--composition-strips&viewMode=story', png: 'charts-composition-bar.png', text: 'One strip for how a whole divides' },
  { url: '/iframe.html?id=pages-page--aside-layout&viewMode=story', png: 'pages-page.png', role: 'complementary' as const, name: 'Workflow context' },
  { url: '/iframe.html?id=lists-datatable--sorted-paged-dual-render&viewMode=story', png: 'lists-data-table.png', text: 'Showing 4–6 of 8', unstableContent: true },
  { url: '/iframe.html?id=lists-datatable--narrow-roles&viewMode=story', png: 'lists-data-table-narrow.png', text: 'Narrow roles compose the mobile card' },
  { url: '/iframe.html?id=lists-timeline--status-rail-expansion-nesting&viewMode=story', png: 'lists-timeline.png', role: 'list' as const, name: 'Dispatch activity' },
  { url: '/iframe.html?id=lists-calendargrid--week-and-day-structure&viewMode=story', png: 'lists-calendar-grid.png', role: 'grid' as const, name: 'Week of July 12, 2026' },
  { url: '/iframe.html?id=navigation-navlist--selection-and-keyboard&viewMode=story', png: 'navigation-nav-list.png', role: 'navigation' as const, name: 'Plugin settings' },
  { url: '/iframe.html?id=agents-agentavatar--sizes-and-presence&viewMode=story', png: 'agents-agent-avatar.png', text: 'Keep identity recognizable at every density' },
  { url: '/iframe.html?id=agents-agentstatus--presence-language&viewMode=story', png: 'agents-agent-status.png', text: 'Say the state in words, not color' },
  { url: '/iframe.html?id=content-markdowncontent--reading-and-code&viewMode=story', png: 'content-markdown-content.png', text: 'Release evidence' },
  { url: '/iframe.html?id=content-markdowneditor--controlled-editor&viewMode=story', png: 'content-markdown-editor.png', role: 'textbox' as const, name: 'Release handoff content' },
  { url: '/iframe.html?id=lists-kanban--task-board-composition&viewMode=story', png: 'lists-kanban.png', text: 'Keep lanes quiet and tasks scannable' },
  { url: '/iframe.html?id=conversation-single-turn-output--canonical-usage&viewMode=story', png: 'conversation-turn-output.png', role: 'status' as const },
  { url: '/iframe.html?id=layout-stack-and-inline--gap-scale-and-wrapping&viewMode=story', png: 'layout-stack-inline.png', text: 'One finite spacing scale' },
  { url: '/iframe.html?id=layout-section--spacing-and-dividers&viewMode=story', png: 'layout-section.png', text: 'Consistent section separation' },
  { url: '/iframe.html?id=feedback-systemstate--scope-and-recovery&viewMode=story', png: 'feedback-system-state-scopes.png', text: 'Match the state to its owning region' },
  { url: '/iframe.html?id=layout-panel--tone-rail&viewMode=story', png: 'layout-panel.png', text: 'Skill drift detected.' },
  { url: '/iframe.html?id=layout-panel--code-frame&viewMode=story', png: 'layout-panel-code.png', text: 'bakin agents sync --check copywriter' },
  { url: '/iframe.html?id=layout-disclosurepanel--open-by-default&viewMode=story', png: 'layout-disclosure-panel.png', text: 'Session detail' },
  { url: '/iframe.html?id=layout-boundedoverflow--wide-operations-table&viewMode=story', png: 'layout-bounded-overflow.png', role: 'region' as const, name: 'Active operation details' },
  { url: '/iframe.html?id=foundations-semantic-tokens--catalog&viewMode=story', png: 'foundations-semantic-tokens.png', text: 'Semantic UI tokens' },
  { url: '/iframe.html?id=testing-plugin-ui-fixture-host--canonical-usage&viewMode=story', png: 'testing-plugin-ui-fixture.png', text: 'Canonical fixture page' },
  { url: '/iframe.html?id=pages-workspacepage--canonical-usage&viewMode=story', png: 'pages-workspace-page.png', role: 'region' as const, name: 'Workspace canvas' },
  { url: '/iframe.html?id=lists-listrows--list-varieties&viewMode=story', png: 'lists-list-rows.png', role: 'list' as const, name: 'Bordered lesson rows' },
  { url: '/iframe.html?id=primitives-radiogroup--states&viewMode=story', png: 'primitives-radio-group.png', role: 'radiogroup' as const },
  { url: '/iframe.html?id=primitives-fileinput--states&viewMode=story', png: 'primitives-file-input.png', role: 'heading' as const, name: 'FileInput' },
  { url: '/iframe.html?id=forms-colorinput--paired-hex-field&viewMode=story', png: 'forms-color-input.png', text: 'Swatch and hex are one value' },
  { url: '/iframe.html?id=agents-channelicon--known-and-unknown-channels&viewMode=story', png: 'agents-channel-icon.png', role: 'heading' as const, name: 'ChannelIcon' },
  { url: '/iframe.html?id=forms-assetlibrarypicker--library-states&viewMode=story', png: 'forms-asset-library-picker.png', text: 'Honest library states' },
  { url: '/iframe.html?id=feedback-progress--markers&viewMode=story', png: 'feedback-progress-markers.png', role: 'progressbar' as const },
  { url: '/iframe.html?id=foundations-elevation--ladder&viewMode=story', png: 'foundations-elevation.png', role: 'heading' as const, name: 'Elevation' },
  { url: '/iframe.html?id=primitives-shimmertext--states-and-highlights&viewMode=story', png: 'primitives-shimmer-text.png', text: 'Sweep only what is actually in motion' },
]

for (const baseline of PRIMITIVES_BASELINES) {
  test(`public ${baseline.png.replace('.png', '')} visual baseline`, async ({ page }) => {
    await page.goto(baseline.url)
    const anchor = 'text' in baseline && baseline.text
      ? page.getByText(baseline.text, { exact: true }).first()
      : page.getByRole(baseline.role!, baseline.name ? { name: baseline.name } : undefined).first()
    await expect(anchor).toBeVisible()
    await page.evaluate(async () => document.fonts.ready)
    // Stories whose plays resize or retype content have racy full-page
    // heights; those entries pin a fixed viewport crop with a bounded pixel
    // allowance instead of flapping on dimensions.
    const unstable = 'unstableContent' in baseline && baseline.unstableContent
    await expect(page).toHaveScreenshot(baseline.png, {
      animations: 'disabled',
      caret: 'hide',
      fullPage: !unstable,
      maxDiffPixels: unstable ? 4096 : 0,
    })
  })
}
