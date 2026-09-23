import { expect, test } from 'playwright/test'

for (const width of [1280, 320]) {
  test(`composer has visible keyboard focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/iframe.html?id=components-conversation-panel-and-tool-detail--canonical-usage&viewMode=story')
    const input = page.getByRole('textbox', { name: 'Message the release agent' })
    await expect(input).toBeVisible()
    for (let index = 0; index < 12 && !await input.evaluate(el => el === document.activeElement); index++) {
      await page.keyboard.press('Tab')
    }
    await expect(input).toBeFocused()
    const focus = await input.evaluate(el => {
      const style = getComputedStyle(el)
      return { width: parseFloat(style.outlineWidth), style: style.outlineStyle, color: style.outlineColor }
    })
    expect(focus.width).toBeGreaterThanOrEqual(2)
    expect(focus.style).toBe('solid')
    expect(focus.color).not.toBe('rgba(0, 0, 0, 0)')
    await input.fill('A draft to preserve')
    await page.reload()
    await expect(input).toHaveValue('A draft to preserve')
    await page.keyboard.press('Tab')
    await input.focus()
    await page.screenshot({ path: test.info().outputPath(`composer-focus-${width}.png`) })
  })
}
