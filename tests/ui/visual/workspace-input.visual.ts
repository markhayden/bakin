import { expect, test } from 'playwright/test'

for (const expanded of [false, true]) {
  test(`terminal input ${expanded ? 'expanded' : 'compact'}`, async ({ page }, testInfo) => {
    await page.goto('/iframe.html?id=recipes-terminalinput--bar-and-sheet&viewMode=story', { waitUntil: 'networkidle' })
    await expect(page.locator('#storybook-root')).toHaveAttribute('data-story-ready', 'true')
    await expect(page.getByRole('region', { name: 'More keys' })).toHaveCount(0)
    // Expanded: the sheet open, a one-shot Control and a locked Option showing their states.
    if (expanded) {
      await page.getByRole('button', { name: 'More keys', exact: true }).click()
      await page.getByRole('button', { name: 'Control', exact: true }).click()
      await page.getByRole('button', { name: 'Option lock', exact: true }).click()
    }
    await page.evaluate(async () => document.fonts.ready)
    const name = `terminal-input-${expanded ? 'expanded' : 'compact'}`
    await page.screenshot({ path: testInfo.outputPath(`${name}-candidate.png`), animations: 'disabled', caret: 'hide' })
    await expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide' })
  })
}
