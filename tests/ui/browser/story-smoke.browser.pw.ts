import { expect, test, type Request } from 'playwright/test'

function isCancelledStorybookA11yInstrumentation(request: Request): boolean {
  const failure = request.failure()?.errorText
  if (failure !== 'Load request cancelled') return false

  const { pathname } = new URL(request.url())
  return /^\/assets\/axe-[^/]+\.js$/.test(pathname)
}

const responsiveWidths = [1024, 720, 480, 320] as const
const behaviorStory = '/iframe.html?id=primitives-button--behavior-fixture&viewMode=story'
const alertTonesStory = '/iframe.html?id=feedback-alert--tones&viewMode=story'
const cardStressStory = '/iframe.html?id=primitives-card--content-stress&viewMode=story'
const collapsibleCanonicalStory = '/iframe.html?id=primitives-collapsible--canonical-usage&viewMode=story'
const collapsibleBehaviorStory = '/iframe.html?id=primitives-collapsible--behavior&viewMode=story'
const skeletonLoadingStory = '/iframe.html?id=feedback-skeleton--loading-object&viewMode=story'
const separatorOrientationStory = '/iframe.html?id=primitives-separator--orientation&viewMode=story'
const avatarSizesStory = '/iframe.html?id=primitives-avatar--sizes-and-fallbacks&viewMode=story'
const inputStatesStory = '/iframe.html?id=primitives-input--states-and-mobile-modes&viewMode=story'
const checkboxStatesStory = '/iframe.html?id=primitives-checkbox--states&viewMode=story'
const switchStatesStory = '/iframe.html?id=primitives-switch--states&viewMode=story'
const dialogFocusReturnStory = '/iframe.html?id=overlays-dialog--controlled-focus-return&viewMode=story'
const anchoredCoexistenceStory = '/iframe.html?id=overlays-popover--anchored-layer-coexistence&viewMode=story'
const layoutFlowStory = '/iframe.html?id=layout-pageshell-and-flow--responsive-page&viewMode=story'
const layoutRecipesStory = '/iframe.html?id=layout-grid-section-and-overflow--responsive-composition&viewMode=story'
const formOverviewStory = '/iframe.html?id=forms-field-and-form-composition--overview&viewMode=story'
const asyncValidationStory = '/iframe.html?id=forms-field-and-form-composition--async-validation&viewMode=story'
const submissionWorkflowStory = '/iframe.html?id=forms-field-and-form-composition--submission-workflow&viewMode=story'
const systemStateStory = '/iframe.html?id=feedback-systemstate--state-matrix&viewMode=story'
const toastTonesStory = '/iframe.html?id=feedback-toast--tones-and-actions&viewMode=story'
const toastDismissStory = '/iframe.html?id=feedback-toast--dismiss-behavior&viewMode=story'
const bannerTonesStory = '/iframe.html?id=feedback-banner--tones-and-actions&viewMode=story'
const listPageStory = '/iframe.html?id=patterns-list-and-detail-pages--list-index&viewMode=story'
const listHeaderControlsStory = '/iframe.html?id=patterns-list-and-detail-pages--list-header-controls&viewMode=story'
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
const saveFailureStory = '/iframe.html?id=forms-savebar--save-failure&viewMode=story'
const typedConfirmationStory = '/iframe.html?id=feedback-confirmdialog--typed-confirmation&viewMode=story'
const unsavedExitStory = '/iframe.html?id=forms-unsavedchangesdialog--unsaved-exit-decision&viewMode=story'
const facetFilterStory = '/iframe.html?id=patterns-filters-and-navigation--facet-filtering&viewMode=story'
const searchBehaviorStory = '/iframe.html?id=patterns-filters-and-navigation--search-behavior&viewMode=story'
const longQueryStory = '/iframe.html?id=patterns-filters-and-navigation--long-query&viewMode=story'
const agentFilterStory = '/iframe.html?id=patterns-filters-and-navigation--agent-filtering&viewMode=story'
const segmentedNavigationStory = '/iframe.html?id=patterns-filters-and-navigation--segmented-navigation&viewMode=story'
const underlineNavigationStory = '/iframe.html?id=patterns-filters-and-navigation--underline-navigation&viewMode=story'
const sortableTableStory = '/iframe.html?id=patterns-filters-and-navigation--sortable-table&viewMode=story'
const statusLanguageStory = '/iframe.html?id=feedback-statusbadge--status-vocabulary&viewMode=story'
const denseMetricsStory = '/iframe.html?id=charts-stattile--dense-metrics&viewMode=story'
const actionableMetricsStory = '/iframe.html?id=charts-stattile--actionable-metrics&viewMode=story'
const chartExactDataStory = '/iframe.html?id=charts-exact-data-and-compact-trends--exact-data-table&viewMode=story'
const chartPaletteStory = '/iframe.html?id=charts-exact-data-and-compact-trends--stable-palette&viewMode=story'
const chartCompactTrendsStory = '/iframe.html?id=charts-exact-data-and-compact-trends--compact-trends&viewMode=story'
const lineChartsStory = '/iframe.html?id=charts-line-bar-and-stacked-charts--line-charts&viewMode=story'
const barChartsStory = '/iframe.html?id=charts-line-bar-and-stacked-charts--bar-charts&viewMode=story'
const stackedColumnsStory = '/iframe.html?id=charts-line-bar-and-stacked-charts--stacked-columns&viewMode=story'
const conversationToolActivityStory = '/iframe.html?id=conversation-tool-activity--states-and-disclosure&viewMode=story'
const conversationTurnsStory = '/iframe.html?id=conversation-turns-and-messages--complete-and-lifecycle-states&viewMode=story'
const conversationDocumentTimelineStory = '/iframe.html?id=conversation-timeline-and-empty-state--document-timeline&viewMode=story'
const conversationContainedStory = '/iframe.html?id=conversation-timeline-and-empty-state--contained-and-empty-states&viewMode=story'
const conversationProductComposerStory = '/iframe.html?id=conversation-composer-and-attachments--product-composer&viewMode=story'
const conversationComposerStatesStory = '/iframe.html?id=conversation-composer-and-attachments--attachment-and-availability-states&viewMode=story'
const conversationProductPanelStory = '/iframe.html?id=conversation-panel-and-tool-detail--product-panel&viewMode=story'
const conversationReadOnlyPanelStory = '/iframe.html?id=conversation-panel-and-tool-detail--read-only-states&viewMode=story'
const conversationToolDetailStory = '/iframe.html?id=conversation-panel-and-tool-detail--exact-tool-detail&viewMode=story'
const markdownReadingStory = '/iframe.html?id=content-markdown--reading-and-code&viewMode=story'
const markdownEditorStory = '/iframe.html?id=content-markdown--controlled-editor&viewMode=story'
const searchTrustStory = '/iframe.html?id=feedback-search-trust-states--availability-and-evidence&viewMode=story'
const agentIdentityStory = '/iframe.html?id=agents-identity-and-assignment--identity-and-presence&viewMode=story'
const agentAssignmentStory = '/iframe.html?id=agents-identity-and-assignment--assignment-and-filtering&viewMode=story'
const assetDialogStory = '/iframe.html?id=forms-assetpicker--dialog-library&viewMode=story'
const assetInlineStory = '/iframe.html?id=forms-assetpicker--inline-attach-relink-and-states&viewMode=story'
const modelSelectStory = '/iframe.html?id=forms-modelselect--grouped-catalog&viewMode=story'
const colorPickerStory = '/iframe.html?id=forms-colorpicker--palette-choices&viewMode=story'
const pluginSettingsStory = '/iframe.html?id=forms-plugin-settings-renderer--messaging-schema-workflow&viewMode=story'
const turnOutputStory = '/iframe.html?id=conversation-single-turn-output--embedded-output-states&viewMode=story'

test('public story keeps keyboard, focus, console, and responsive contracts', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (isCancelledStorybookA11yInstrumentation(request)) return
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`${width}px overview has no document overflow`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(alertTonesStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('alert')).toContainText('Connection failed')
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('semantic state remains available without visual inspection', async () => {
    await expect(page.getByRole('alert')).toContainText('Connection failed')
    await expect(page.getByRole('status')).toHaveCount(4)

    await page.goto('/iframe.html?id=feedback-progress--states&viewMode=story', { waitUntil: 'networkidle' })
    await expect(page.getByRole('progressbar', { name: 'Generating assets' })).toHaveAttribute('aria-valuenow', '42')
    await expect(page.getByRole('progressbar', { name: 'Connecting to runtime' })).not.toHaveAttribute('aria-valuenow')
  })

  await test.step('interactive badge and alert actions expose keyboard focus', async () => {
    await page.goto('/iframe.html?id=primitives-badge--interactive&viewMode=story', { waitUntil: 'networkidle' })
    await expect(page.getByRole('link', { name: 'Open 4 filtered tasks' })).toBeFocused()

    await page.goto('/iframe.html?id=feedback-alert--with-action&viewMode=story', { waitUntil: 'networkidle' })
    await expect(page.getByRole('button', { name: 'Retry' })).toBeFocused()
  })

  await test.step('progress interaction updates the exact accessible value', async () => {
    await page.goto('/iframe.html?id=feedback-progress--behavior&viewMode=story', { waitUntil: 'networkidle' })
    await expect(page.getByRole('progressbar', { name: 'Migration' })).toHaveAttribute('aria-valuenow', '40')
  })

  expect(browserErrors).toEqual([])
})

test('surface and content primitives keep disclosure and loading semantics across browsers', async ({ page }) => {
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

  for (const width of responsiveWidths) {
    await test.step(`${width}px card content stress has no document overflow`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(cardStressStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Long and technical content', exact: true })).toBeVisible()
      await expect(page.getByText(/extraordinarily-long-cross-functional-campaign-name/)).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('collapsible retains focus and exact expanded state', async () => {
    await page.goto(collapsibleCanonicalStory, { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: 'Advanced retry policy', exact: true })
    // The story's play function clicks the trigger open and asserts the expanded contract.
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText(/Retry twice/)).toBeVisible()
    await expect(trigger).toBeFocused()
  })

  await test.step('collapsible keyboard toggle cycle settles collapsed with focus retained', async () => {
    await page.goto(collapsibleBehaviorStory, { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: 'Advanced retry policy', exact: true })
    // The play function tabs to the trigger and toggles open then closed via Enter;
    // its terminal state is focused and collapsed, and any play failure surfaces as a console error.
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText(/Retry twice/)).toBeHidden()
  })

  await test.step('loading and meaningful structure remain semantic', async () => {
    await page.goto(skeletonLoadingStory, { waitUntil: 'networkidle' })
    await expect(page.locator('section[aria-busy="true"]')).toHaveAttribute('aria-labelledby', 'loading-object-heading')

    await page.goto(separatorOrientationStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal')

    await page.goto(avatarSizesStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('group', { name: 'Assigned to Alex, Jordan, Sam, and three more agents' })).toBeVisible()
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`${width}px input states story has no document overflow`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(inputStatesStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Input', exact: true })).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('labels, native states, and explicit descriptions remain associated', async () => {
    // Wait for the story's play function to finish typing before interacting.
    await expect(page.getByRole('textbox', { name: 'Default' })).toHaveValue('Nightly digest')
    const email = page.getByLabel('Required email')
    await page.getByText('Required email', { exact: true }).click()
    await expect(email).toBeFocused()
    await expect(email).toHaveAttribute('required', '')
    await expect(email).toHaveAttribute('inputmode', 'email')
    await expect(email).toHaveAttribute('autocomplete', 'email')
    await expect(page.getByLabel('Read-only identifier')).toHaveAttribute('readonly', '')
    await expect(page.getByLabel('Disabled source')).toBeDisabled()
    const invalidUrl = page.getByLabel('Invalid URL')
    await expect(invalidUrl).toHaveAttribute('aria-invalid', 'true')
    const errorId = await page.getByText('Enter a complete HTTPS URL.').getAttribute('id')
    expect((await invalidUrl.getAttribute('aria-describedby'))?.split(' ')).toContain(errorId)
  })

  await test.step('adornment text focuses the editable control without stealing button semantics', async () => {
    await page.goto('/iframe.html?id=primitives-inputgroup--adornments&viewMode=story', { waitUntil: 'networkidle' })
    const repository = page.getByLabel('Repository path')
    await page.getByText('github.com/', { exact: true }).click()
    await expect(repository).toBeFocused()
    await expect(page.getByRole('button', { name: 'Copy' })).toHaveAttribute('type', 'button')
    await expect(page.getByRole('textbox', { name: 'Execution prompt', exact: true })).toHaveAttribute('aria-invalid', 'true')
  })

  await test.step('specialized virtual-keyboard hints survive the public component', async () => {
    await page.goto(inputStatesStory, { waitUntil: 'networkidle' })
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
  })

  for (const [story, heading] of [[checkboxStatesStory, 'Checkbox'], [switchStatesStory, 'Switch']] as const) {
    for (const width of responsiveWidths) {
      await test.step(`${width}px ${heading} states story has no document overflow`, async () => {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(story, { waitUntil: 'networkidle' })
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
      })
    }
  }

  await test.step('long labels remain contained at 200% text sizing', async () => {
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto(checkboxStatesStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expect(page.getByText('Disabled choice with a label long enough to wrap at 200% text zoom')).toBeVisible()
    const checkboxDimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(checkboxDimensions.scrollWidth).toBeLessThanOrEqual(checkboxDimensions.clientWidth)

    await page.goto(switchStatesStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expect(page.getByText('Disabled organization-managed setting with a long wrapping label')).toBeVisible()
    const switchDimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(switchDimensions.scrollWidth).toBeLessThanOrEqual(switchDimensions.clientWidth)
  })

  await test.step('checkbox and switch retain labelled keyboard state', async () => {
    await page.goto('/iframe.html?id=primitives-checkbox--behavior&viewMode=story', { waitUntil: 'networkidle' })
    const checkbox = page.getByRole('checkbox', { name: 'Include archived tasks' })
    // The play function tabs to the checkbox and toggles it on then off with Space;
    // its terminal state is focused and unchecked, and any play failure surfaces as a console error.
    await expect(checkbox).toBeFocused()
    await expect(checkbox).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Partially selected workspaces' })).toHaveAttribute('aria-checked', 'mixed')
    expect((await checkbox.boundingBox())?.height).toBeGreaterThanOrEqual(24)

    await page.goto('/iframe.html?id=primitives-switch--behavior&viewMode=story', { waitUntil: 'networkidle' })
    const control = page.getByRole('switch', { name: 'Automatic retry' })
    // Same terminal-state contract: the play toggles on then off and announces each state.
    await expect(control).toBeFocused()
    await expect(control).not.toBeChecked()
    await expect(page.getByRole('status')).toHaveText('Disabled')
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(24)
  })

  await test.step('select opens, groups, blocks disabled activation, selects, and returns focus', async () => {
    await page.goto('/iframe.html?id=primitives-select--behavior&viewMode=story', { waitUntil: 'networkidle' })
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`${width}px controlled dialog returns focus without document overflow`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(dialogFocusReturnStory, { waitUntil: 'networkidle' })
      // The play function opens the controlled dialog, dismisses it with Escape, and
      // requires focus to return to the launching control; waiting on that terminal
      // state also settles the story before measuring overflow.
      await expect(page.getByRole('button', { name: 'Open decision dialog' })).toBeFocused()
      await expect(page.getByRole('dialog', { name: 'Publish workflow?' })).toBeHidden()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('nested dialog escape closes one layer at a time and returns focus', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/iframe.html?id=overlays-dialog--nested-behavior&viewMode=story&bakin-browser-fixture=1', { waitUntil: 'networkidle' })
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
    await page.goto('/iframe.html?id=overlays-dialog--busy&viewMode=story', { waitUntil: 'networkidle' })
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
    await page.goto('/iframe.html?id=overlays-sheet--right-panel&viewMode=story', { waitUntil: 'networkidle' })
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
  })

  for (const width of responsiveWidths) {
    await test.step(`${width}px anchored layer coexistence has no document overflow`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(anchoredCoexistenceStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'One collision-safe layer', exact: true })).toBeVisible()
      // The play function opens a menu above the default-open popover and requires the
      // popover to survive the nested layer's Escape; the panel stays visible throughout.
      await expect(page.getByRole('dialog', { name: 'Active filters' })).toBeVisible()
      const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('popover remains viewport-bounded and returns focus on Escape', async () => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/iframe.html?id=overlays-popover--behavior&viewMode=story', { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: 'Open route context' })
    // The play function opens and Escape-dismisses the popover itself; wait for its
    // terminal focus-return state before driving the trigger again.
    await expect(trigger).toBeFocused()
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
    await page.goto('/iframe.html?id=overlays-dropdownmenu--behavior&viewMode=story', { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: 'Task actions' })
    // The play function walks the same submenu path and ends with focus returned to
    // the trigger; wait for that terminal state before reopening the menu.
    await expect(trigger).toBeFocused()
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
    await page.goto('/iframe.html?id=overlays-tooltip--behavior&viewMode=story&bakinCrossBrowser=1', { waitUntil: 'networkidle' })
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
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

  await expect(page.getByRole('group', { name: 'Page actions' })).toBeVisible()
  expect(browserErrors).toEqual([])
})

test('grid recipes reflow by container and bound intrinsic overflow', async ({ page }) => {
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
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
    const rejectedSubmission = page.getByRole('button', { name: 'Register plugin' }).click()
    await expect(page.getByRole('button', { name: 'Registering plugin' })).toBeDisabled()
    await rejectedSubmission
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
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
    await page.goto(bannerTonesStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('status', { name: 'Runtime reconnected' })).toHaveAttribute('aria-live', 'polite')

    await page.goto(toastTonesStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('region', { name: 'Example notifications' })).toBeVisible()
    await expect(page.getByRole('alert', { name: 'Action failed' })).toBeVisible()
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)

    // The dismiss story's play already exercises the click; assert its
    // terminal state — the region remains (empty, so zero-size), toast gone.
    await page.goto(toastDismissStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('region', { name: 'Example notifications' })).toBeAttached()
    await expect(page.getByRole('alert')).toHaveCount(0)
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
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

  await test.step('desktop header search expands inside its slot without moving peer controls', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(listHeaderControlsStory, { waitUntil: 'networkidle' })
    const search = page.getByRole('searchbox', { name: 'Search tasks' })
    const control = page.locator('[data-slot="search-input-control"]')
    const board = page.getByRole('tab', { name: 'Board' })
    const action = page.getByRole('button', { name: 'New task' })
    await expect(control).toHaveAttribute('data-state', 'empty')
    const compact = await control.boundingBox()
    const boardTop = (await board.boundingBox())?.y
    const actionTop = (await action.boundingBox())?.y

    await search.focus()
    await expect(control).toHaveAttribute('data-state', 'focused')
    await page.waitForTimeout(220)
    const expanded = await control.boundingBox()
    expect(expanded!.width).toBeGreaterThan(compact!.width)
    expect((await board.boundingBox())?.y).toBe(boardTop)
    expect((await action.boundingBox())?.y).toBe(actionTop)
    await expect(page.locator('html')).toHaveAttribute('data-bakin-reduced-motion', 'false')
    expect(await control.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0.18s')

    await search.fill('blocked launch approval tasks with a deliberately long owner name')
    await page.getByRole('heading', { level: 2 }).click()
    await expect(control).toHaveAttribute('data-state', 'filled')
    await expect(search).toHaveValue('blocked launch approval tasks with a deliberately long owner name')
    expect((await control.boundingBox())!.width).toBeLessThanOrEqual((await page.locator('[data-slot="search-input-reserve"]').boundingBox())!.width)
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
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

  await test.step('search behavior remains contained at the minimum width and 200% text', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(searchBehaviorStory, { waitUntil: 'networkidle' })
    const search = page.getByRole('searchbox', { name: 'Search tasks' })
    const control = page.locator('[data-slot="search-input-control"]')
    const compact = await control.boundingBox()
    await search.focus()
    await page.waitForTimeout(220)
    expect((await control.boundingBox())!.width).toBeGreaterThan(compact!.width)
    await expect(page.locator('html')).toHaveAttribute('data-bakin-reduced-motion', 'false')
    expect(await control.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0.18s')

    await page.setViewportSize({ width: 320, height: 1000 })
    await page.goto(searchBehaviorStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toBeVisible()
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  await test.step('long queries truncate behind a canonical clear action without losing their value', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(longQueryStory, { waitUntil: 'networkidle' })
    const search = page.getByRole('searchbox', { name: 'Search tasks' })
    await expect(search).toHaveValue('blocked launch approval tasks with a deliberately long owner name')
    await expect(search).toHaveCSS('text-overflow', 'ellipsis')
    const clear = page.getByRole('button', { name: 'Clear Search tasks' })
    await expect(clear).toBeVisible()
    await clear.click()
    await expect(search).toHaveValue('')
    await expect(search).toBeFocused()
    await expect(clear).toBeHidden()
  })

  await test.step('agent and compact view groups activate with arrow keys and skip disabled choices', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(agentFilterStory, { waitUntil: 'networkidle' })
    const allAgents = page.getByRole('radio', { name: 'All' })
    await allAgents.focus()
    await allAgents.press('ArrowRight')
    const patch = page.getByRole('radio', { name: 'Patch' })
    await expect(patch).toHaveAttribute('aria-checked', 'true')
    const avatarCenters = await patch.locator('[data-slot="agent-filter-visual"]').evaluate((element) => {
      const slot = element.getBoundingClientRect()
      const visual = element.firstElementChild!.getBoundingClientRect()
      return {
        x: (visual.x + visual.width / 2) - (slot.x + slot.width / 2),
        y: (visual.y + visual.height / 2) - (slot.y + slot.height / 2),
      }
    })
    expect(Math.abs(avatarCenters.x)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(avatarCenters.y)).toBeLessThanOrEqual(0.5)

    await page.goto(segmentedNavigationStory, { waitUntil: 'networkidle' })
    const taskView = page.getByRole('tablist', { name: 'Task view' })
    const sizing = await taskView.evaluate((element) => ({
      outer: element.clientWidth,
      visual: element.querySelector<HTMLElement>('[data-slot="segmented-control-list"]')?.getBoundingClientRect().width ?? 0,
    }))
    expect(Math.abs(sizing.outer - sizing.visual)).toBeLessThanOrEqual(1)
    const board = page.getByRole('tab', { name: 'Board' })
    const selectedStyle = await board.evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, border: style.borderColor, shadow: style.boxShadow }
    })
    expect(selectedStyle.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(selectedStyle.border).toBe('rgba(0, 0, 0, 0)')
    expect(selectedStyle.shadow).toBe('none')
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
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
    const ceilingMark = page.getByRole('img', { name: 'Current window with a deliberately long exact label — Completed: 42' })
    await ceilingMark.focus()
    await expect(page.getByRole('tooltip')).toHaveAttribute('data-placement', 'below')
    const plotBox = await plot.boundingBox()
    const tooltipBox = await page.getByRole('tooltip').boundingBox()
    expect(plotBox).not.toBeNull()
    expect(tooltipBox).not.toBeNull()
    expect(tooltipBox!.y).toBeGreaterThanOrEqual(plotBox!.y)

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
    const reason = request.failure()?.errorText ?? ''
    // Navigation cancels in-flight lazy chunks; an abort is not a failed resource.
    if (reason === 'NS_BINDING_ABORTED' || reason === 'net::ERR_ABORTED') return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
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

test('conversation turns preserve identity, lifecycle, attachments, and containment', async ({ page }) => {
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

  for (const width of responsiveWidths) {
    await test.step(`turns remain document-contained at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 1100 })
      await page.goto(conversationTurnsStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Keep the speaker and state unmistakable' })).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('identity, attachment type, and lifecycle are explicit', async () => {
    await page.setViewportSize({ width: 1024, height: 1100 })
    await page.goto(conversationTurnsStory, { waitUntil: 'networkidle' })
    await expect(page.getByText('Main operations agent', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('img', { name: 'route-map.png' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'routing-compatibility-appendix.pdf' })).toBeVisible()
    await expect(page.getByText('Stopped', { exact: true })).toBeVisible()
    await expect(page.getByText('archive_unavailable')).toBeVisible()
    const spinner = page.locator('[aria-live="polite"] [aria-hidden="true"]')
    await expect(spinner).toBeVisible()
    expect(await spinner.evaluate((element) => getComputedStyle(element).animationName)).toBe('none')
  })

  await test.step('retry remains keyboard owned by the consumer', async () => {
    const retry = page.getByRole('button', { name: 'Try again' })
    await retry.focus()
    await expect(retry).toBeFocused()
    await retry.press('Enter')
    await expect(page.getByRole('status')).toHaveText('Retry requested')
  })

  await test.step('200% text remains document-contained', async () => {
    await page.setViewportSize({ width: 320, height: 1100 })
    await page.goto(conversationTurnsStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expect(page.getByText('archive_unavailable')).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})

test('conversation timeline preserves page scroll ownership, bounded history, and honest empty actions', async ({ page }) => {
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

  for (const [story, heading] of [
    [conversationDocumentTimelineStory, 'Review the release plan'],
    [conversationContainedStory, 'Bounded history and a useful starting point'],
  ] as const) {
    for (const width of responsiveWidths) {
      await test.step(`${heading} remains document-contained at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1100 })
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

  await test.step('the product default delegates scrolling to the named page log', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(conversationDocumentTimelineStory, { waitUntil: 'networkidle' })
    const log = page.getByRole('log', { name: 'Release plan review' })
    const conversation = page.locator('[data-conv-timeline]')
    const scroller = conversation.locator('[data-conv-scroller]')
    await expect(log).toHaveCount(1)
    await expect(conversation).toHaveAttribute('data-mode', 'document')
    expect(await scroller.evaluate((element) => getComputedStyle(element).overflowY)).toBe('visible')
  })

  await test.step('the explicit contained mode owns local history and its jump action', async () => {
    await page.goto(conversationContainedStory, { waitUntil: 'networkidle' })
    const scroller = page.locator('[data-mode="contained"] [data-conv-scroller]')
    expect(await scroller.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto')
    const dimensions = await scroller.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }))
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight)
    const jump = page.getByRole('button', { name: 'Jump to latest' })
    await expect(jump).toBeVisible()
    await jump.click()
    await expect(jump).toHaveCount(0)
  })

  await test.step('empty prompts remain actionable and 200% text stays contained', async () => {
    await page.setViewportSize({ width: 320, height: 1100 })
    await page.goto(conversationContainedStory, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Summarize release evidence' }).click()
    await expect(page.getByRole('status')).toHaveText('Summarize release evidence')
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expect(page.getByRole('region', { name: 'Start a release review' })).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})

test('conversation composer preserves keyboard, persistence, attachment, and busy-state contracts', async ({ page }) => {
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

  for (const [story, heading] of [
    [conversationProductComposerStory, 'Ask a focused follow-up'],
    [conversationComposerStatesStory, 'Keep attachment and reply state unambiguous'],
  ] as const) {
    for (const width of responsiveWidths) {
      await test.step(`${heading} remains contained at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1100 })
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

  await test.step('draft and keyboard resize preferences survive a reload', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(conversationComposerStatesStory, { waitUntil: 'networkidle' })
    const input = page.getByRole('textbox', { name: 'Queue a follow-up' })
    await input.fill('Keep this draft')
    const separator = page.getByRole('separator', { name: 'Resize message input' }).first()
    await separator.focus()
    await page.keyboard.press('ArrowUp')
    await expect(separator).toHaveAttribute('aria-valuenow', '104')
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByRole('textbox', { name: 'Queue a follow-up' })).toHaveValue('Keep this draft')
    await expect(page.getByRole('separator', { name: 'Resize message input' }).first()).toHaveAttribute('aria-valuenow', '104')
  })

  await test.step('busy and attachment state remains textual and actionable', async () => {
    await page.goto(conversationComposerStatesStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('status', { name: 'Uploading release-evidence.png' })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('Upload failed')
    const unavailable = page.locator('[data-composer-attach]').last()
    await expect(unavailable).toBeDisabled()
    await expect(unavailable).toHaveAttribute('title', 'This agent model cannot inspect images.')
    const busyInput = page.getByRole('textbox', { name: 'Queue a follow-up' })
    await busyInput.fill('Queued while the reply is active')
    await busyInput.press('Enter')
    await expect(busyInput).toHaveValue('Queued while the reply is active')
    await page.getByRole('button', { name: 'Stop the reply' }).click()
    await expect(page.getByText('Stop requested')).toBeVisible()
  })

  await test.step('200% text preserves horizontal containment', async () => {
    await page.setViewportSize({ width: 320, height: 1100 })
    await page.goto(conversationComposerStatesStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expect(page.getByRole('textbox', { name: 'Message a text-only agent' })).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})

test('conversation panel preserves bounded history, resize, read-only, and exact-detail contracts', async ({ page }) => {
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

  for (const [story, heading] of [
    [conversationProductPanelStory, 'Coordinate an embedded release review'],
    [conversationReadOnlyPanelStory, 'Say why a conversation cannot change'],
  ] as const) {
    for (const width of responsiveWidths) {
      await test.step(`${heading} remains contained at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1100 })
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

  for (const width of responsiveWidths) {
    await test.step(`exact tool detail remains contained at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 1100 })
      await page.goto(conversationToolDetailStory, { waitUntil: 'networkidle' })
      await expect(page.getByRole('dialog', { name: 'route_audit' })).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    })
  }

  await test.step('panel and composer resize preferences survive reload independently', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(conversationProductPanelStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => localStorage.removeItem('bakin-vresize:conv-panel:storybook-product-panel'))
    await page.reload({ waitUntil: 'networkidle' })
    const panelResize = page.getByRole('separator', { name: 'Resize conversation panel' })
    await expect(panelResize).toHaveAttribute('aria-valuenow', '420')
    await panelResize.focus()
    await page.keyboard.press('ArrowUp')
    await expect(panelResize).toHaveAttribute('aria-valuenow', '436')
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByRole('separator', { name: 'Resize conversation panel' })).toHaveAttribute('aria-valuenow', '436')
  })

  await test.step('timeline evidence opens the canonical exact-detail drawer', async () => {
    await page.goto(conversationProductPanelStory, { waitUntil: 'networkidle' })
    await page.locator('button[data-conv-activity-header]').click()
    await page.locator('button[data-conv-call]').click()
    const dialog = page.getByRole('dialog', { name: 'route_audit' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Captured output was truncated/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Copy input' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Close panel' }).click()
    await expect(dialog).toHaveCount(0)
  })

  await test.step('read-only mode always replaces the composer with an explanation', async () => {
    await page.goto(conversationReadOnlyPanelStory, { waitUntil: 'networkidle' })
    await expect(page.getByText('This conversation is read-only.')).toBeVisible()
    await expect(page.getByText(/Archived after release/)).toBeVisible()
    await expect(page.getByRole('textbox')).toHaveCount(0)
  })

  expect(browserErrors).toEqual([])
})

test('markdown and search patterns preserve overflow, keyboard, and trust contracts', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    // WebKit may cancel Storybook's lazy a11y instrumentation when this test
    // intentionally navigates between stories. Product request failures and
    // every other Storybook asset failure remain fatal.
    if (isCancelledStorybookA11yInstrumentation(request)) return
    browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  for (const story of [markdownReadingStory, markdownEditorStory, searchTrustStory]) {
    for (const width of responsiveWidths) {
      await test.step(`${story} remains contained at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1100 })
        await page.goto(story, { waitUntil: 'networkidle' })
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
      })
    }
  }

  await test.step('wide Markdown evidence owns its internal horizontal overflow', async () => {
    await page.setViewportSize({ width: 320, height: 1100 })
    await page.goto(markdownReadingStory, { waitUntil: 'networkidle' })
    const tableRegion = page.locator('[data-md-table]')
    await expect(tableRegion).toBeVisible()
    expect(await tableRegion.evaluate((element) => getComputedStyle(element).overflowX)).toBe('auto')
  })

  await test.step('editor mode is host-controlled and remains keyboard operable', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(markdownEditorStory, { waitUntil: 'networkidle' })
    const preview = page.getByRole('tab', { name: 'Preview' })
    await preview.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('region', { name: 'Release handoff content preview' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Completed checklist item' })).toBeDisabled()
  })

  await test.step('partial search disclosure names exact sources from keyboard focus', async () => {
    await page.goto(searchTrustStory, { waitUntil: 'networkidle' })
    const partial = page.getByRole('button', { name: /Partial results/ })
    await partial.focus()
    await expect(page.getByRole('tooltip')).toContainText('assets: keyword-only (230ms)')
    await expect(page.getByRole('tooltip')).toContainText('memory: no answer in time (500ms)')
    await expect(page.getByRole('alert')).toContainText('Browsing and filters still work')
    await expect(page.getByRole('note', { name: 'Search relevance details' })).toContainText('matched: title, caption')
  })

  await test.step('200% text remains horizontally contained', async () => {
    await page.setViewportSize({ width: 320, height: 1100 })
    await page.goto(markdownReadingStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})

test('agent identity and assignment preserve exact status, keyboard, and narrow-width contracts', async ({ page }) => {
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

  for (const story of [agentIdentityStory, agentAssignmentStory]) {
    for (const width of responsiveWidths) {
      await test.step(`${story} remains contained at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1100 })
        await page.goto(story, { waitUntil: 'networkidle' })
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
      })
    }
  }

  await test.step('presence remains named without relying on color', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(agentIdentityStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('status', { name: 'Release Operations With A Deliberately Long Name status' })).toContainText('Working')
    await expect(page.getByRole('status', { name: 'Maya Chen status' }).filter({ hasText: 'Needs attention' })).toBeVisible()
  })

  await test.step('assignment and filtering work from the keyboard', async () => {
    await page.goto(agentAssignmentStory, { waitUntil: 'networkidle' })
    const owner = page.locator('#agent-pattern-owner')
    await owner.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.getByRole('option', { name: 'Release team' }).click()
    await expect(page.getByRole('status')).toContainText('Selected owner: Release team')

    const allAgents = page.getByRole('radio', { name: 'All' })
    await allAgents.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: 'Maya Chen' })).toHaveAttribute('aria-checked', 'true')
  })

  await test.step('200% text remains horizontally contained', async () => {
    await page.setViewportSize({ width: 320, height: 1100 })
    await page.goto(agentIdentityStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})

test('asset, model, and color pickers preserve controlled state, keyboard, and narrow-width contracts', async ({ page }) => {
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

  for (const story of [assetDialogStory, assetInlineStory, modelSelectStory, colorPickerStory]) {
    for (const width of responsiveWidths) {
      await test.step(`${story} remains contained at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1100 })
        await page.goto(story, { waitUntil: 'networkidle' })
        await expect(page.getByRole('main')).toBeVisible()
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
      })
    }
  }

  await test.step('dialog search commits an exact asset id and restores trigger focus', async () => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(assetDialogStory, { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: 'Open asset library' })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Choose campaign artwork' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('searchbox', { name: 'Search assets' }).fill('brief')
    await dialog.getByRole('button', { name: 'Select Launch brief' }).click()
    await expect(page.getByRole('status')).toHaveText('Selected asset: brief-1')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  await test.step('inline attach keeps exact empty, loading, and selection state visible', async () => {
    await page.goto(assetInlineStory, { waitUntil: 'networkidle' })
    await expect(page.getByText('No assets yet')).toBeVisible()
    await expect(page.getByText('Loading assets')).toBeVisible()
    await page.getByRole('button', { name: 'Select Campaign hero' }).click()
    await expect(page.getByText('Attachment candidate: hero-1', { exact: true })).toBeVisible()
  })

  await test.step('model choices remain keyboard complete and block disabled options', async () => {
    await page.goto(modelSelectStory, { waitUntil: 'networkidle' })
    const model = page.getByRole('combobox', { name: 'Model' })
    await model.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('option', { name: 'Retired preview' })).toHaveAttribute('aria-disabled', 'true')
    await page.getByRole('option', { name: 'Acme Fast' }).click()
    await expect(page.getByRole('status')).toHaveText('Model: acme-fast.')
  })

  await test.step('color choices remain keyboard complete', async () => {
    await page.goto(colorPickerStory, { waitUntil: 'networkidle' })
    const violet = page.getByRole('radio', { name: 'Violet' })
    await violet.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: 'Teal' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('status')).toHaveText('Color: series-3.')
  })

  await test.step('200% text remains horizontally contained', async () => {
    await page.setViewportSize({ width: 320, height: 1100 })
    await page.goto(colorPickerStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})

test('plugin settings and single-turn output preserve validation, evidence, and narrow-width contracts', async ({ page }) => {
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

  for (const story of [pluginSettingsStory, turnOutputStory]) {
    for (const width of responsiveWidths) {
      await test.step(`${story} remains contained at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1400 })
        await page.goto(story, { waitUntil: 'networkidle' })
        await expect(page.getByRole('main').or(page.getByRole('form')).first()).toBeVisible()
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
      })
    }
  }

  await test.step('Messaging schema keeps exact labels, list grouping, and durable save feedback', async () => {
    await page.setViewportSize({ width: 720, height: 1400 })
    await page.goto(pluginSettingsStory, { waitUntil: 'networkidle' })
    await expect(page.getByRole('textbox', { name: 'Messaging workspace name' })).toHaveValue('Publishing operations')
    await expect(page.getByRole('group', { name: 'Content types row 2' })).toBeVisible()
    await expect(page.getByRole('status')).toContainText('Messaging settings saved')
    await expect(page.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  })

  await test.step('turn output keeps tool status, live status, typed failure, and keyboard-scrollable code', async () => {
    await page.goto(turnOutputStory, { waitUntil: 'networkidle' })
    await expect(page.getByText('failed', { exact: true })).toBeVisible()
    await expect(page.getByRole('status')).toContainText('waiting for the publishing agent')
    await expect(page.getByRole('alert')).toContainText('session_died')
    const code = page.getByRole('region', { name: 'Code output' })
    await code.focus()
    await expect(code).toBeFocused()
    expect(await code.evaluate((element) => getComputedStyle(element).overflowX)).toBe('auto')
  })

  await test.step('200% text remains horizontally contained at the minimum supported width', async () => {
    await page.setViewportSize({ width: 320, height: 1400 })
    await page.goto(pluginSettingsStory, { waitUntil: 'networkidle' })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })

  expect(browserErrors).toEqual([])
})
