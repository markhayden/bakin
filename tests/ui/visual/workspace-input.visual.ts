import { expect, test } from 'playwright/test'

for (const expanded of [false, true]) {
  test(`terminal input ${expanded ? 'expanded' : 'compact'}`, async ({ page }, testInfo) => {
    await page.goto('/iframe.html?id=recipes-terminalinput--visual-capture&viewMode=story', { waitUntil: 'networkidle' })
    await expect(page.locator('#storybook-root')).toHaveAttribute('data-story-ready', 'true', { timeout: 20_000 })
    await expect(page.getByRole('region', { name: 'More keys' })).toHaveCount(0)
    // Expanded: the sheet open, a one-shot Control and a locked Option showing their states.
    if (expanded) {
      await page.getByRole('button', { name: 'More keys', exact: true }).click()
      await page.getByRole('button', { name: 'Control', exact: true }).click()
      await page.getByRole('button', { name: 'Option lock', exact: true }).click()
      // The sheet from its top: the Keys group is the narrow-screen layout to guard.
      await page.getByRole('region', { name: 'More keys' }).evaluate(region => { for (const element of [region, ...region.querySelectorAll('*')]) element.scrollTop = 0 })
    }
    await page.evaluate(async () => document.fonts.ready)
    const name = `terminal-input-${expanded ? 'expanded' : 'compact'}`
    await page.screenshot({ path: testInfo.outputPath(`${name}-candidate.png`), animations: 'disabled', caret: 'hide' })
    await expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide' })
  })
}
