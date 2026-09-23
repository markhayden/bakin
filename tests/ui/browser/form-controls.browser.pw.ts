import { expect, test } from 'playwright/test'

test('field sizes align with their button peers', async ({ page }) => {
  await page.goto('/iframe.html?id=components-primitives-input--sizes-and-variants&viewMode=story')
  for (const [size, height] of [['sm', 32], ['md', 36], ['lg', 44]] as const) {
    for (const variant of ['outlined', 'filled', 'ghost']) {
      const input = page.getByRole('textbox', { name: `${variant} ${size}`, exact: true })
      await expect(input).toBeVisible()
      expect(await input.evaluate((el) => el.getBoundingClientRect().height)).toBe(height)
    }
  }
  await page.goto('/iframe.html?id=components-primitives-button--sizes&viewMode=story')
  await expect(page.getByRole('button', { name: 'Large', exact: true })).toBeVisible()
  expect(await page.getByRole('button', { name: 'Large', exact: true }).evaluate((el) => el.getBoundingClientRect().height)).toBe(44)
  const icon = page.locator('[data-slot=button][data-size=icon-lg]')
  expect(await icon.evaluate((el) => el.getBoundingClientRect().width)).toBe(44)
})

test('textarea auto growth is bounded, resets and responds to controlled updates', async ({ page }) => {
  await page.goto('/iframe.html?id=components-primitives-textarea--sizing-fixture&viewMode=story')
  const input = page.getByRole('textbox', { name: 'Automatic notes' })
  await expect(input).toBeVisible()
  const initial = await input.evaluate((el) => el.getBoundingClientRect().height)
  await page.getByRole('button', { name: 'Load notes' }).click()
  await expect.poll(() => input.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  expect(await input.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(initial)
  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.getByRole('button', { name: 'Reset notes' }).click()
  await expect(input).toHaveValue('')
  await expect.poll(() => input.evaluate((el) => {
    const style = getComputedStyle(el)
    const expected = 3 * parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    return Math.abs(el.getBoundingClientRect().height - expected)
  })).toBeLessThan(1)
  const manual = page.getByRole('textbox', { name: 'Manual notes' })
  await expect(manual).toHaveAttribute('rows', '3')
  expect(await manual.evaluate((el) => getComputedStyle(el).resize)).toBe('vertical')
})
