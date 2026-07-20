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

test('public surface and content family visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  await page.goto('/iframe.html?id=foundation-surface-and-content--overview&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Surface and content', exact: true })).toBeVisible()
  await expect(page.getByText('Launch review workflow', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Advanced retry policy', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await page.evaluate(async () => document.fonts.ready)

  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('foundation-surface-content.png')
})

test('public text fields family visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  await page.goto('/iframe.html?id=foundation-text-fields--overview&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Text fields', exact: true })).toBeVisible()
  await expect(page.getByLabel('Owner email')).toHaveAttribute('inputmode', 'email')
  await expect(page.getByLabel('Generated identifier')).toHaveAttribute('readonly', '')
  await expect(page.getByLabel('Webhook URL')).toHaveAttribute('aria-invalid', 'true')
  await page.evaluate(async () => document.fonts.ready)

  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('foundation-text-fields.png')
})

test('public selection controls family visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  await page.goto('/iframe.html?id=foundation-selection-controls--overview&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Selection controls', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Apply to selected workspaces' })).toHaveAttribute('aria-checked', 'mixed')
  await expect(page.getByRole('switch', { name: 'Daily approval digest' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('combobox', { name: 'Fallback owner' })).toHaveAttribute('aria-invalid', 'true')
  await page.evaluate(async () => document.fonts.ready)

  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('foundation-selection-controls.png')
})

test('public dialog decision visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  await page.goto('/iframe.html?id=foundation-dialog--decision&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('dialog', { name: 'Delete runtime connection?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close dialog' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)

  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('foundation-dialog.png')
})

test('public right sheet visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  await page.goto('/iframe.html?id=foundation-sheet--right-panel&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  await expect(page.getByLabel('Title')).toHaveValue('Review routing migration evidence')
  await page.evaluate(async () => document.fonts.ready)

  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('foundation-sheet.png')
})

test('public BakinDrawer visual baseline', async ({ page }, testInfo) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  await page.goto('/iframe.html?id=foundation-bakindrawer--default&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('dialog', { name: 'Task detail' })).toBeVisible()
  const resizer = page.locator('[role="separator"][aria-label="Resize panel"]')
  if (testInfo.project.name === 'chromium-desktop') {
    await expect(resizer).toHaveAttribute('aria-valuenow', '810')
  } else {
    await expect(resizer).toBeHidden()
  }
  await page.evaluate(async () => document.fonts.ready)

  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('foundation-bakin-drawer.png')
})

test('public Popover visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`) })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`))

  await page.goto('/iframe.html?id=foundation-popover--context&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.locator('[data-slot="popover-content"]')).toBeVisible()
  await expect(page.getByText('Active filters', { exact: true })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('foundation-popover.png')
})

test('public DropdownMenu visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`) })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`))

  await page.goto('/iframe.html?id=foundation-dropdownmenu--actions&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('menu', { name: 'Task actions' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Delete task' })).toHaveAttribute('data-variant', 'danger')
  await page.evaluate(async () => document.fonts.ready)
  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('foundation-dropdown-menu.png')
})

test('public Tooltip visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`) })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`))

  await page.goto('/iframe.html?id=foundation-tooltip--supplemental-help&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('tooltip')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Explain blocked state' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('foundation-tooltip.png')
})

test('public Command visual baseline', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`) })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`))

  await page.goto('/iframe.html?id=foundation-command--search&viewMode=story', { waitUntil: 'networkidle' })
  await expect(page.getByRole('combobox', { name: 'Find a task action' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Open task' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  expect(browserErrors).toEqual([])
  await expect(page).toHaveScreenshot('foundation-command.png')
})

test('public PageShell and flow visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=layout-pageshell-and-flow--responsive-page&viewMode=story')
  await expect(page.getByRole('heading', { name: 'Coordinate active work' })).toBeVisible()
  await expect(page).toHaveScreenshot('foundation-layout-flow.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public responsive layout recipes visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=layout-grid-section-and-overflow--responsive-composition&viewMode=story')
  await expect(page.getByRole('heading', { name: 'Structure changes with available space' })).toBeVisible()
  await expect(page).toHaveScreenshot('foundation-layout-recipes.png', {
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
  await page.goto('/iframe.html?id=states-system-state-and-feedback--state-matrix&viewMode=story')
  await expect(page.getByRole('heading', { name: 'Every data surface tells the truth' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-system-states.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public banner and toast feedback visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=states-system-state-and-feedback--feedback&viewMode=story')
  await expect(page.getByRole('heading', { name: 'Persistent context and transient outcomes' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-system-feedback.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public list/index page recipe visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=patterns-list-and-detail-pages--list-index&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Coordinate active work' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-list-page.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public detail page recipe visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=patterns-list-and-detail-pages--detail&viewMode=story')
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
  await page.goto('/iframe.html?id=patterns-settings-and-dashboard-pages--settings-categories&viewMode=story')
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
  await page.goto('/iframe.html?id=patterns-settings-and-dashboard-pages--dashboard-overview&viewMode=story')
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
  await page.goto('/iframe.html?id=patterns-conversation-and-inspector--conversation&viewMode=story')
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
  await page.goto('/iframe.html?id=patterns-conversation-and-inspector--inspector&viewMode=story')
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
  await page.goto('/iframe.html?id=patterns-workflow-and-action-pages--vertical-workflow&viewMode=story')
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
  await page.goto('/iframe.html?id=patterns-workflow-and-action-pages--horizontal-workflow&viewMode=story')
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
  await page.goto('/iframe.html?id=patterns-destructive-and-dirty-state--save-failure&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Keep a failed draft actionable' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Unsaved changes' })).toHaveAttribute('data-savebar-state', 'error')
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-save-failure.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public typed confirmation pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=patterns-destructive-and-dirty-state--typed-confirmation&viewMode=story')
  const dialog = page.getByRole('dialog', { name: 'Delete archived workflow?' })
  if (!await dialog.isVisible()) {
    await page.getByRole('button', { name: 'Delete archived workflow' }).click()
  }
  await expect(dialog).toBeVisible()
  await page.getByLabel(/Type launch-publishing to confirm/).fill('launch')
  await expect(dialog.getByRole('button', { name: 'Delete workflow' })).toBeDisabled()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-typed-confirmation.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public facet filter pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=patterns-filters-and-navigation--facet-filtering&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Keep filter state visible and reversible' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Filter by State' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Needs attention because a dependency is unavailable Selected 3' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-facet-filter.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public agent filter pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=patterns-filters-and-navigation--agent-filtering&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Filter by an agent without losing names' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Filter by agent' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-agent-filter.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public segmented navigation pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=patterns-filters-and-navigation--segmented-navigation&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Switch modes with one compact control' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Task view' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-segmented-navigation.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public underline navigation pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=patterns-filters-and-navigation--underline-navigation&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Keep page sections anchored to their content' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Runtime sections' })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-underline-navigation.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public sortable table pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=patterns-filters-and-navigation--sortable-table&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Put sort meaning on the column header' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute('aria-sort', 'descending')
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-sortable-table.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public status language pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=patterns-status-and-metrics--status-language&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Say what changed, even without color' })).toBeVisible()
  await expect(page.locator('[data-status-badge]').filter({ hasText: 'Published' })).toHaveAttribute('data-tone', 'success')
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-status-language.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public dense metrics pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=patterns-status-and-metrics--dense-metrics&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Keep technical metrics dense and honest' })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Plugin migration coverage' })).toHaveAttribute('aria-valuenow', '91.428')
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-dense-metrics.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})

test('public actionable metrics pattern visual baseline', async ({ page }) => {
  await page.goto('/iframe.html?id=patterns-status-and-metrics--actionable-metrics&viewMode=story')
  await expect(page.getByRole('heading', { level: 1, name: 'Use a surface only when the metric is an object' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Needs review 8/ })).toBeVisible()
  await page.evaluate(async () => document.fonts.ready)
  await expect(page).toHaveScreenshot('foundation-actionable-metrics.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  })
})
