import { expect, test } from 'bun:test'
import { keyboardFocusFindings } from '../../../packages/sdk/src/testing/ui/conformance/runner'

// Run by scripts/ui/verify-plugin-conformance.ts (ui:test:conformance), which
// sets the env flag; the plain suite skips it. Playwright loads lazily — an
// eager import in a bun --isolate child can segfault the runner even when
// every test in the file is skipped.
const browserTest = process.env.BAKIN_UI_BROWSER_TEST === '1' ? test : test.skip

browserTest('focus checks include aria-disabled controls that remain in the tab order', async () => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.setContent('<button>Before</button><button aria-disabled="true">Unavailable action</button><button disabled>Native disabled</button><button>After</button>')
    expect(await keyboardFocusFindings(page, 'desktop')).toEqual([])
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('After')
  } finally { await browser.close() }
}, 15000)
