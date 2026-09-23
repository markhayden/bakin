import { expect, test } from 'playwright/test'

// Candidate captures use --update-snapshots=none until exact PNG approval.
for (const [id, screenshot, heading] of [
  ['id=components-primitives-input--sizes-and-variants', 'input-sizes-and-variants', 'Input sizes and variants'],
  ['id=components-primitives-textarea--bounded-growth', 'textarea-bounded-growth', 'Bounded growth'],
  ['id=components-primitives-inputgroup--sizes-and-variants', 'inputgroup-sizes-and-variants', 'Grouped controls'],
  ['id=components-primitives-select--sizes-and-variants', 'select-sizes-and-variants', 'Select sizes and variants'],
  ['id=components-primitives-combobox--sizes-and-variants', 'combobox-sizes-and-variants', 'Combobox sizes and variants'],
  ['id=components-primitives-input--surface-contexts', 'input-surface-contexts', 'Field appearances on surfaces'],
  ['id=components-primitives-combobox--control-states', 'combobox-control-states', 'Combobox states'],
  ['id=components-primitives-combobox--compact-and-object-values', 'combobox-compact-values', 'Chips or compact summary'],
  ['id=components-primitives-combobox--multiple-selection', 'combobox-multiple-selection', 'Selected runtimes'],
] as const) {
  test(`form controls: ${screenshot}`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(`/iframe.html?${id}&viewMode=story`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await page.evaluate(async () => document.fonts.ready)
    if (screenshot === 'textarea-bounded-growth') await expect(page.locator('#storybook-root')).toHaveAttribute('data-story-ready', 'true')
    if (screenshot === 'input-surface-contexts') await expect(page.getByRole('textbox', { name: 'Canvas ghost' })).toBeFocused()
    if (screenshot === 'combobox-compact-values') {
      await expect(page.getByLabel('Submitted runtime IDs')).toHaveText('pi, claw')
      await expect(page.getByRole('button', { name: 'Show compact summary' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Remove OpenClaw' })).toBeVisible()
    }
    if (screenshot === 'combobox-multiple-selection') await expect(page.getByRole('status')).toHaveText('1 runtimes selected.')
    expect(errors).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    // Keep a complete review artifact even when an unapproved baseline is absent.
    await page.screenshot({ path: testInfo.outputPath(`${screenshot}-candidate.png`), fullPage: true, animations: 'disabled', caret: 'hide' })
    await expect(page).toHaveScreenshot(`${screenshot}.png`, { fullPage: true, animations: 'disabled', caret: 'hide' })
  })
}
