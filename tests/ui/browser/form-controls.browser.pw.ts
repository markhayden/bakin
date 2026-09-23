import { expect, test } from 'playwright/test'

test('outlined retains contrast and filled stays borderless with visible errors', async ({ page }) => {
  await page.goto('/iframe.html?id=components-primitives-input--surface-contexts&viewMode=story')
  for (const surface of ['Canvas', 'Default surface', 'Elevated surface']) {
    for (const variant of ['outlined', 'filled']) {
      const input = page.getByRole('textbox', { name: `${surface} ${variant}` })
      await expect(input).toBeVisible()
      if (variant === 'filled') {
        const sides = await input.evaluate(el => {
          const style = getComputedStyle(el)
          return [style.borderTopColor, style.borderBottomColor, style.borderLeftColor, style.borderRightColor]
        })
        expect(sides).toEqual(Array(4).fill('rgba(0, 0, 0, 0)'))
        continue
      }
      const ratio = await input.evaluate(el => {
        const style = getComputedStyle(el)
        const luminance = (color: string) => {
          const components = color.match(/[\d.]+/g)!.slice(0, 3).map(Number)
          return components.map(value => {
            const channel = value / 255
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
          }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
        }
        const border = luminance(style.borderBottomColor)
        const background = luminance(style.backgroundColor)
        return (Math.max(border, background) + 0.05) / (Math.min(border, background) + 0.05)
      })
      expect(ratio).toBeGreaterThanOrEqual(3)
    }
  }
  const invalid = page.getByRole('textbox', { name: 'filled invalid' })
  const errorBorder = await invalid.evaluate(el => {
    const style = getComputedStyle(el)
    return [style.borderTopColor, style.borderBottomColor, style.borderLeftColor, style.borderRightColor]
  })
  expect(errorBorder[0]).not.toBe('rgba(0, 0, 0, 0)')
  expect(new Set(errorBorder).size).toBe(1)
})

test('field sizes align with their button peers', async ({ page }) => {
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/iframe.html?id=components-primitives-input--sizes-and-variants&viewMode=story')
    for (const [size, height] of [['sm', 32], ['md', 36], ['lg', 44]] as const) {
      for (const variant of ['outlined', 'filled', 'ghost']) {
        const input = page.getByRole('textbox', { name: `${variant} ${size}`, exact: true })
        await expect(input).toBeVisible()
        expect(await input.evaluate((el) => el.getBoundingClientRect().height)).toBe(height)
      }
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
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await expect.poll(() => input.evaluate(el => {
    const style = getComputedStyle(el)
    return Math.abs((el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(style.lineHeight) - 3)
  })).toBeLessThan(0.1)
  await input.fill('A note that wraps when enlarged. '.repeat(20))
  await expect.poll(() => input.evaluate(el => {
    const style = getComputedStyle(el)
    const rows = (el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(style.lineHeight)
    return Math.abs(rows - 6)
  })).toBeLessThan(0.1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

test('field focus and invalid boundaries survive forced colors and reduced motion', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.goto('/iframe.html?id=components-primitives-input--surface-contexts&viewMode=story')
  const ghost = page.getByRole('textbox', { name: 'Canvas ghost' })
  await expect(ghost).toBeFocused()
  const focus = await ghost.evaluate(el => {
    const style = getComputedStyle(el)
    return { outline: style.outlineStyle, width: parseFloat(style.outlineWidth) }
  })
  expect(focus.outline).toBe('solid')
  expect(focus.width).toBeGreaterThanOrEqual(2)
  for (const variant of ['outlined', 'filled', 'ghost']) {
    const invalid = page.getByRole('textbox', { name: `${variant} invalid` })
    await expect(invalid).toHaveAttribute('aria-invalid', 'true')
    await expect(invalid).toHaveAccessibleDescription('Update this value at its source.')
    expect(await invalid.evaluate(el => parseFloat(getComputedStyle(el).borderTopWidth))).toBeGreaterThan(0)
  }
  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})
