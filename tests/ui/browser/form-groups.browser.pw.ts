import { expect, test } from 'playwright/test'

test('group shells contain addons at every size, narrow widths and enlarged text', async ({ page }) => {
  await page.goto('/iframe.html?id=components-primitives-inputgroup--sizes-and-variants&viewMode=story')
  await expect(page.getByRole('group', { name: 'outlined sm', exact: true })).toBeVisible()
  for (const [size, height] of [['sm', 32], ['md', 36], ['lg', 44]] as const) {
    for (const variant of ['outlined', 'filled', 'ghost']) {
      const group = page.getByRole('group', { name: `${variant} ${size}`, exact: true })
      expect(await group.evaluate(el => el.getBoundingClientRect().height)).toBe(height)
      await group.getByRole('textbox').focus()
      expect(await group.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid')
    }
  }
  await page.setViewportSize({ width: 320, height: 800 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  const escaped = await page.locator('[data-slot=input-group]').evaluateAll(groups => groups.flatMap(group => {
    const box = group.getBoundingClientRect()
    return [...group.querySelectorAll('input, button')].filter(child => {
      const childBox = child.getBoundingClientRect()
      return childBox.left < box.left || childBox.right > box.right || childBox.height > box.height
    }).map(child => child.getAttribute('aria-label'))
  }))
  expect(escaped).toEqual([])
})
