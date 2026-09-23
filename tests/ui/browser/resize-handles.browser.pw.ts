import { expect, test } from 'playwright/test'

test('closing a drawer during a drag restores normal page interaction', async ({ page }) => {
  await page.goto('/iframe.html?id=components-overlays-drawer--canonical-usage&viewMode=story', { waitUntil: 'networkidle' })
  const handle = page.getByRole('separator', { name: 'Resize panel' })
  const bounds = (await handle.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x - 32, bounds.y + bounds.height / 2)
  await expect(handle).toHaveAttribute('data-resizing', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect.poll(() => page.evaluate(() => ({ cursor: document.body.style.cursor, userSelect: document.body.style.userSelect })))
    .toEqual({ cursor: '', userSelect: '' })
  await page.mouse.up()
})

for (const example of [
  { story: 'components-overlays-drawer--canonical-usage', label: 'Resize panel', axis: 'x', grow: 'ArrowLeft', shrink: 'ArrowRight' },
  { story: 'components-conversation-panel-and-tool-detail--document-divider-panel', label: 'Resize conversation panel', axis: 'y', grow: 'ArrowUp', shrink: 'ArrowDown' },
] as const) {
  test(`${example.label} shares idle, hover, focus, and drag feedback`, async ({ page }) => {
    await page.goto(`/iframe.html?id=${example.story}&viewMode=story`, { waitUntil: 'networkidle' })
    const handle = page.getByRole('separator', { name: example.label })
    const grip = handle.locator('span')
    if (example.axis === 'x') await page.keyboard.press('Tab')
    await page.mouse.move(0, 0)
    await expect(grip).toHaveCSS('opacity', '0.6')
    const idleColor = await grip.evaluate(element => getComputedStyle(element).backgroundColor)
    await expect(handle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    // Resolve the semantic accent using the browser's color serialization.
    const accent = await grip.evaluate(element => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--bakin-color-signal-accent)'
      element.append(probe)
      const color = getComputedStyle(probe).backgroundColor
      probe.remove()
      return color
    })
    expect(accent).not.toBe(idleColor)
    await handle.hover()
    await expect(grip).toHaveCSS('background-color', accent)
    await expect(grip).toHaveCSS('opacity', '1')
    const hoverBackground = await handle.evaluate(element => getComputedStyle(element).backgroundColor)
    expect(hoverBackground).not.toBe('rgba(0, 0, 0, 0)')
    await page.mouse.move(0, 0)
    await expect(grip).toHaveCSS('background-color', idleColor)
    await handle.focus()
    const initial = Number(await handle.getAttribute('aria-valuenow'))
    await page.keyboard.press(example.grow)
    await expect(handle).toHaveAttribute('aria-valuenow', String(initial + 16))
    await expect(grip).toHaveCSS('background-color', accent)
    await expect(handle).toHaveCSS('background-color', hoverBackground)
    await page.keyboard.press(example.shrink)
    await page.keyboard.press('Tab')

    const bounds = (await handle.boundingBox())!
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    // Leave the thin hit area; capture must keep the drag and pink feedback alive.
    await page.mouse.move(example.axis === 'x' ? x - 32 : x, example.axis === 'y' ? y - 32 : y)
    await expect(handle).toHaveAttribute('data-resizing', 'true')
    await expect(handle).toHaveCSS('background-color', accent)
    await expect(handle).toHaveAttribute('aria-valuenow', String(initial + 32))
    await expect(grip).toHaveCSS('background-color', accent)
    await page.mouse.up()
    await expect(handle).toHaveAttribute('data-resizing', 'false')
    await page.reload({ waitUntil: 'networkidle' })
    await expect(handle).toHaveAttribute('aria-valuenow', String(initial + 32))
    await page.setViewportSize({ width: 320, height: 800 })
    if (example.axis === 'x') await expect(handle).toBeHidden()
    else await expect(handle).toBeVisible()
  })
}
