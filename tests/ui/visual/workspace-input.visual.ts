import { expect, test } from 'playwright/test'

for (const expanded of [false, true]) {
  test(`terminal input ${expanded ? 'expanded' : 'compact'}`, async ({ page }, testInfo) => {
    await page.goto('/iframe.html?id=recipes-terminalinput--compact-and-expanded&viewMode=story', { waitUntil: 'networkidle' })
    await expect(page.locator('#storybook-root')).toHaveAttribute('data-story-ready', 'true')
    const more = page.getByRole('button', { name: 'More', exact: true })
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    if (expanded) {
      await more.click()
      await page.getByRole('button', { name: 'Ctrl', exact: true }).click()
    }
    await page.evaluate(async () => document.fonts.ready)
    const name = `terminal-input-${expanded ? 'expanded' : 'compact'}`
    await page.screenshot({ path: testInfo.outputPath(`${name}-candidate.png`), animations: 'disabled', caret: 'hide' })
    await expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide' })
  })
}
