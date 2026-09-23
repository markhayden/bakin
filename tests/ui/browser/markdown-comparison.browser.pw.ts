import { expect, test } from 'playwright/test'

for (const width of [1280, 320]) {
  test(`Markdown comparison preserves document flow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/iframe.html?id=components-content-markdowncontent--whole-document-comparison&viewMode=story')
    const goal = page.getByRole('heading', { name: 'Goal', exact: true })
    const tasks = page.getByRole('heading', { name: 'Tasks', exact: true })
    await expect(goal).toBeVisible()
    const goalBounds = await goal.boundingBox()
    const tasksBounds = await tasks.boundingBox()
    // A short paragraph cannot allocate a viewport-sized Markdown editor frame.
    expect(tasksBounds!.y - goalBounds!.y).toBeLessThan(240)
    await expect(page.locator('[data-md-changed-block]')).toHaveCount(5)
    const edge = await page.locator('[data-md-changed-block]').first().evaluate(el => ({
      color: getComputedStyle(el).borderLeftColor,
      expected: getComputedStyle(document.documentElement).getPropertyValue('--bakin-color-action-primary-background').trim(),
    }))
    // Resolve the system token through the browser rather than pinning a palette hex.
    expect(await page.evaluate(({ color, expected }) => {
      const element = document.createElement('span')
      element.style.color = expected
      document.body.append(element)
      const matches = getComputedStyle(element).color === color
      element.remove()
      return matches
    }, edge)).toBe(true)
    await expect(page.locator('[data-markdown-content] ul')).toHaveCount(2)
    await expect(page.getByRole('table')).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Project reference' })).toHaveAttribute('href', '/projects/current')
    await page.getByRole('button', { name: 'Copy code' }).click()
    await expect(page.getByRole('button', { name: 'Copy code complete' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: test.info().outputPath(`markdown-comparison-${width}.png`), fullPage: true })
  })
}
