import { expect, test } from 'bun:test'
import { keyboardFocusFindings } from '../../../packages/sdk/src/testing/ui/conformance/runner'

// Run by scripts/ui/verify-plugin-conformance.ts (ui:test:conformance), which
// sets the env flag; the plain suite skips it. Playwright loads lazily — an
// eager import in a bun --isolate child can segfault the runner even when
// every test in the file is skipped.
const browserTest = process.env.BAKIN_UI_BROWSER_TEST === '1' ? test : test.skip

browserTest('focus checks traverse open and closed native disclosure headers and their visible controls', async () => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.setContent(`
      <details open>
        <summary>Installed features</summary>
        <button>Check for updates</button>
        <details><summary>Technical identity</summary><button>Hidden action</button></details>
      </details>
      <details><summary>All health checks</summary><button>Hidden repair</button></details>
      <button>After disclosures</button>
    `)
    for (const viewport of ['desktop', 'mobile'] as const) {
      await page.setViewportSize({ width: viewport === 'desktop' ? 1440 : 320, height: 900 })
      expect(await keyboardFocusFindings(page, viewport)).toEqual([])
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('After disclosures')
    }
  } finally { await browser.close() }
}, 15000)

browserTest('focus checks report a native disclosure header with no visible focus indicator', async () => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.setContent('<style>summary { outline: none; }</style><details><summary>Missing disclosure ring</summary></details>')
    const findings = await keyboardFocusFindings(page, 'desktop')
    expect(findings).toHaveLength(1)
    expect(findings[0]?.rule).toBe('keyboard-focus')
    expect(findings[0]?.message).toContain('Missing disclosure ring')
    expect(findings[0]?.message).toContain('focus indicator')
  } finally { await browser.close() }
}, 15000)

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

browserTest('focus checks recognize only a changing visible ring on the canonical input group', async () => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    for (const scenario of [
      { name: 'group ring', css: '[data-slot=input-group]:has(input:focus-visible) { outline: 2px solid green; }', control: '<input data-slot="input-group-control" aria-label="Search">', passes: true },
      { name: 'missing style', css: '[data-slot=input-group]:has(input:focus-visible) { outline-width: 2px; outline-color: green; }', control: '<input data-slot="input-group-control" aria-label="Search">', passes: false },
      { name: 'static outline', css: '[data-slot=input-group] { outline: 2px solid green; }', control: '<input data-slot="input-group-control" aria-label="Search">', passes: false },
      { name: 'transparent ring', css: '[data-slot=input-group]:has(input:focus-visible) { outline: 2px solid transparent; }', control: '<input data-slot="input-group-control" aria-label="Search">', passes: false },
      { name: 'transparent modern color', css: '[data-slot=input-group]:has(input:focus-visible) { outline: 2px solid color(srgb 0 1 0 / 0); }', control: '<input data-slot="input-group-control" aria-label="Search">', passes: false },
      { name: 'unrelated ancestor', css: 'section:focus-within { outline: 2px solid green; }', control: '<input data-slot="input-group-control" aria-label="Search">', passes: false },
      { name: 'addon must own its ring', css: '[data-slot=input-group]:focus-within { outline: 2px solid green; }', control: '<button>Addon action</button>', passes: false },
      { name: 'control ring still counts', css: 'input:focus-visible { outline: 2px solid green; }', control: '<input data-slot="input-group-control" aria-label="Search">', passes: true },
    ]) {
      await page.setContent(`<style>input, button, [data-slot=input-group] { outline: none; } ${scenario.css}</style><section><div data-slot="input-group">${scenario.control}</div></section>`)
      const findings = await keyboardFocusFindings(page, 'desktop')
      expect(findings.length, scenario.name).toBe(scenario.passes ? 0 : 1)
    }
  } finally { await browser.close() }
}, 15000)

browserTest('focus checks walk native <summary> and chart-point SVG focusables, and skip the content of a CLOSED <details>', async () => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    // A kit chart point announces focus by pointing at its tooltip
    // (aria-describedby), not by restyling itself; a closed disclosure's
    // content keeps layout boxes in Chromium (content-visibility) yet is
    // not tabbable — only its summary is.
    await page.setContent(`
      <style>button, summary, circle { outline: none } button:focus-visible, summary:focus-visible { outline: 2px solid green }</style>
      <button>Before</button>
      <svg width="40" height="40"><circle cx="20" cy="20" r="4" role="img" tabindex="0" aria-label="6 AM — $0.50" id="pt"></circle></svg>
      <details><summary>View data</summary><div tabindex="0" aria-label="Data table">hidden region</div></details>
      <button>After</button>
      <script>document.getElementById('pt').addEventListener('focus', () => document.getElementById('pt').setAttribute('aria-describedby', 'tip'))</script>
    `)
    expect(await keyboardFocusFindings(page, 'desktop')).toEqual([])
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('After')
  } finally { await browser.close() }
}, 15000)
