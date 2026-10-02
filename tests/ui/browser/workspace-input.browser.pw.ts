import { expect, test } from 'playwright/test'

const story = '/iframe.html?id=recipes-terminalinput--compact-and-expanded&viewMode=story'

test('a collapsed keyboard-aware workspace exposes one header to keyboard navigation', async ({ page }) => {
  await page.goto('/iframe.html?id=components-pages-workspacepage--keyboard-aware-input&viewMode=story')
  await expect(page.getByRole('textbox', { name: 'Workspace note' })).toHaveValue('Write a note here. ✓')
  const workspace = page.locator('[data-archetype="workspace"]')
  const identity = page.locator('[data-slot="workspace-page-header"]')
  await workspace.evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(identity).toHaveAttribute('inert', '')
  await expect(identity).toHaveAttribute('aria-hidden', 'true')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await workspace.evaluate(el => { el.scrollTop = 0 })
  await expect(identity).not.toHaveAttribute('inert')
  await expect(identity).not.toHaveAttribute('aria-hidden')
})

test('compact keys preserve focus, fit narrow screens, and leave output above the accessory', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto(story)
  await expect(page.locator('#storybook-root')).toHaveAttribute('data-story-ready', 'true')
  const input = page.getByRole('textbox', { name: 'Example input' })
  await input.focus()
  await page.getByRole('button', { name: 'Tab', exact: true }).click()
  await expect(input).toBeFocused()
  await expect(page.getByRole('status')).toHaveText('Tab')
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await expect(input).toBeFocused()
  for (const size of [{ width: 320, height: 800 }, { width: 740, height: 320 }, { width: 820, height: 1180 }]) {
    await page.setViewportSize(size)
    await expect.poll(() => page.evaluate(() => {
      const canvas = document.querySelector('[data-slot="workspace-page-canvas"]')!.getBoundingClientRect()
      const accessory = document.querySelector('[data-slot="workspace-page-input-accessory"]')!.getBoundingClientRect()
      return canvas.height > 40 && canvas.bottom <= accessory.top + 1 && accessory.bottom <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth
    })).toBe(true)
  }
  const smallTargets = await page.getByRole('group', { name: 'Terminal keys', exact: true }).getByRole('button').evaluateAll(buttons => buttons.filter(button => {
    const rect = button.getBoundingClientRect()
    return rect.height < 44 || rect.width < 44
  }).map(button => button.textContent))
  expect(smallTargets).toEqual([])
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('button', { name: 'Ctrl', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: 'Ctrl', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'More', exact: true })).toBeFocused()
})

test('visual viewport resize, panning and fractional geometry bound only the opted-in workspace', async ({ page }) => {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { height: 800, width: 320, offsetTop: 0, offsetLeft: 0, scale: 1 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  })
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto(story)
  await expect(page.locator('#storybook-root')).toHaveAttribute('data-story-ready', 'true')
  await expect(page.getByRole('textbox', { name: 'Example input' })).toBeVisible()
  for (const [height, offsetTop, width, offsetLeft] of [[350.5, 0, 320, 0], [310.25, 60.5, 280.5, 20.25], [800, 0, 320, 0]]) {
    await page.evaluate(({ height, offsetTop, width, offsetLeft }) => {
      Object.assign(window.visualViewport!, { height, offsetTop, width, offsetLeft })
      window.visualViewport!.dispatchEvent(new Event('resize'))
      window.visualViewport!.dispatchEvent(new Event('scroll'))
    }, { height, offsetTop, width, offsetLeft })
    await expect.poll(() => page.locator('[data-archetype="workspace"]').evaluate(el => el.getBoundingClientRect().height)).toBeCloseTo(height, 1)
    const bounds = await page.locator('[data-archetype="workspace"]').boundingBox()
    expect(bounds!.y).toBeCloseTo(offsetTop, 1)
    expect(bounds!.x).toBeCloseTo(offsetLeft, 1)
    expect(bounds!.width).toBeCloseTo(width, 1)
  }
  expect(await page.evaluate(() => document.body.style.height)).toBe('')
})

test('missing VisualViewport retains host sizing and enlarged text stays reachable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined }))
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto(story)
  await expect(page.locator('#storybook-root')).toHaveAttribute('data-story-ready', 'true')
  await expect(page.getByRole('button', { name: 'More', exact: true })).toBeVisible()
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('button', { name: 'Ctrl+W', exact: true }).scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Ctrl+W', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Ctrl+W')
})
