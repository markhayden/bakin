import { expect, test } from 'playwright/test'

// Candidate captures use --update-snapshots=none until exact PNG approval.
for (const [id, screenshot, heading] of [
  ['id=components-primitives-input--sizes-and-variants', 'input-sizes-and-variants', 'Input sizes and variants'],
  ['id=components-primitives-textarea--bounded-growth', 'textarea-bounded-growth', 'Bounded growth'],
  ['id=components-primitives-inputgroup--sizes-and-variants', 'inputgroup-sizes-and-variants', 'Grouped controls'],
  ['id=components-primitives-select--sizes-and-variants', 'select-sizes-and-variants', 'Select sizes and variants'],
  ['id=components-primitives-combobox--sizes-and-variants', 'combobox-sizes-and-variants', 'Combobox sizes and variants'],
  ['id=components-primitives-combobox--multiple-selection', 'combobox-multiple-selection', 'Selected runtimes'],
] as const) {
  test(`form controls: ${screenshot}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`/iframe.html?${id}&viewMode=story`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await page.evaluate(async () => document.fonts.ready)
    if (screenshot === 'combobox-multiple-selection') await expect(page.getByRole('status')).toHaveText('1 runtimes selected.')
    expect(errors).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(page).toHaveScreenshot(`${screenshot}.png`, { fullPage: true, animations: 'disabled', caret: 'hide' })
  })
}
