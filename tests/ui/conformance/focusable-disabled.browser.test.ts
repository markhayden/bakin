import { expect, test } from 'bun:test'
import { chromium } from 'playwright'
import { keyboardFocusFindings } from '../../../packages/sdk/src/testing/ui/conformance/runner'

const browserTest = process.env.BAKIN_UI_BROWSER_TEST === '1' ? test : test.skip

browserTest('focus checks include aria-disabled controls that remain in the tab order', async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.setContent('<button>Before</button><button aria-disabled="true">Unavailable action</button><button disabled>Native disabled</button><button>After</button>')
    expect(await keyboardFocusFindings(page, 'desktop')).toEqual([])
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('After')
  } finally { await browser.close() }
}, 15000)
