import { expect, test } from 'playwright/test'

for (const [id, name, ready] of [
  ['components-agents-agentselect--sizes-and-variants', 'agent-field-appearance', '[aria-label="filled sm owner"]'],
  ['components-content-markdowncontent--whole-document-comparison', 'markdown-comparison', '[data-md-changed-block]'],
  ['components-content-markdowncontent--managed-document-context', 'managed-markdown-context', '[data-bakin-block="plan"]'],
  ['components-conversation-panel-and-tool-detail--draft-handle', 'embedded-draft-handle', '[aria-label="Project idea"]'],
] as const) {
  test(`Projects foundation: ${name}`, async ({ page }, info) => {
    await page.goto(`/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'networkidle' })
    await expect(page.locator(ready).first()).toBeVisible()
    await page.evaluate(async () => document.fonts.ready)
    if (name === 'embedded-draft-handle') {
      await expect(page.getByRole('status')).toHaveText('Draft is present')
      await page.keyboard.press('Tab')
      await page.getByRole('textbox', { name: 'Project idea' }).focus()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${name}-candidate.png`), fullPage: true, animations: 'disabled', caret: 'hide' })
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true })
  })
}
