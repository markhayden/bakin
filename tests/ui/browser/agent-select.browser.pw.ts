import { expect, test } from 'playwright/test'

test('agent selector uses shared geometry and keeps keyboard selection at narrow widths', async ({ page }) => {
  await page.goto('/iframe.html?id=components-agents-agentselect--sizes-and-variants&viewMode=story')
  for (const variant of ['outlined', 'filled', 'ghost']) {
    for (const [size, height] of [['sm', 32], ['md', 36], ['lg', 44]] as const) {
      const trigger = page.getByRole('combobox', { name: `${variant} ${size} owner` })
      await expect(trigger).toBeVisible()
      const bounds = await trigger.boundingBox()
      expect(bounds!.height).toBe(height)
      const avatar = await trigger.locator('[data-slot=avatar]').boundingBox()
      expect(avatar!.y).toBeGreaterThan(bounds!.y)
      expect(avatar!.y + avatar!.height).toBeLessThan(bounds!.y + bounds!.height)
      if (variant === 'filled') {
        expect(await trigger.evaluate(el => getComputedStyle(el).borderBottomColor)).toBe('rgba(0, 0, 0, 0)')
      }
    }
  }

  await page.setViewportSize({ width: 320, height: 800 })
  const compact = page.getByRole('combobox', { name: 'filled sm owner' })
  await compact.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(compact).toBeFocused()
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})
