import { expect, test } from 'playwright/test'

for (const width of [1280, 320]) {
  test(`contained history supports keyboard scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/iframe.html?id=components-conversation-panel-and-tool-detail--canonical-usage&viewMode=story')
    const history = page.getByRole('region', { name: 'Release review history' })
    await expect(history).toHaveAttribute('tabindex', '0')
    await history.focus()
    // Bound the real transcript so both viewports exercise actual overflow.
    await history.evaluate(el => { el.style.height = '64px'; el.scrollTop = 0 })
    await page.keyboard.press('PageDown')
    await expect.poll(() => history.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    await page.keyboard.press('Tab')
    await expect(history).not.toBeFocused()
  })
  test(`composer shares one rounded keyboard focus indicator at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/iframe.html?id=components-conversation-panel-and-tool-detail--canonical-usage&viewMode=story')
    const input = page.getByRole('textbox', { name: 'Message the release agent' })
    await expect(input).toBeVisible()
    const frame = input.locator('..')
    await expect(frame).toHaveCSS('outline-style', 'none')
    for (let index = 0; index < 12 && !await input.evaluate(el => el === document.activeElement); index++) {
      await page.keyboard.press('Tab')
    }
    await expect(input).toBeFocused()
    const focus = await frame.evaluate(el => {
      const style = getComputedStyle(el)
      return {
        width: parseFloat(style.outlineWidth), style: style.outlineStyle, color: style.outlineColor,
        offset: parseFloat(style.outlineOffset), radius: parseFloat(style.borderRadius),
      }
    })
    expect(focus.width).toBeGreaterThanOrEqual(2)
    expect(focus.style).toBe('solid')
    expect(focus.color).not.toBe('rgba(0, 0, 0, 0)')
    expect(focus.offset).toBeLessThan(0)
    expect(focus.radius).toBeGreaterThan(0)
    await expect(input).toHaveCSS('outline-style', 'none')
    await expect(input).toHaveCSS('border-top-width', '0px')
    await input.fill('A draft to preserve')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeFocused()
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCSS('outline-style', 'solid')
    await expect(frame).toHaveCSS('outline-style', 'none')
    await page.reload()
    await expect(input).toHaveValue('A draft to preserve')
    await page.keyboard.press('Tab')
    await input.focus()
    await page.screenshot({ path: test.info().outputPath(`composer-focus-${width}.png`) })
  })
}
