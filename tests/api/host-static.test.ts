/**
 * Tests for the dev-client HTML injection in packages/host/src/api/_static.ts.
 *
 * Two cases:
 *   1. BAKIN_DEV=1 injects the dev-client <script> before </body>.
 *   2. BAKIN_DEV unset returns the input buffer reference unchanged so
 *      the compiled binary serves production index.html byte-identical.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = vi.hoisted(() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-host-static-${Date.now()}`)
})

// Per CLAUDE.md testing rules — mock content-dir even when the test
// doesn't appear to need storage. Transitive imports can surprise you.
vi.mock('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import { transformIndexHtmlForDev } from '../../packages/host/src/api/_static'

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
  <head><title>Bakin</title></head>
  <body class="bg-background">
    <div id="root"></div>
    <script type="module" src="/assets/main.js"></script>
  </body>
</html>
`

describe('transformIndexHtmlForDev', () => {
  const prev = process.env.BAKIN_DEV

  beforeEach(() => {
    delete process.env.BAKIN_DEV
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.BAKIN_DEV
    else process.env.BAKIN_DEV = prev
  })

  it('returns the input buffer unchanged when BAKIN_DEV is unset (reference equality)', () => {
    const input = Buffer.from(SAMPLE_HTML, 'utf-8')
    const output = transformIndexHtmlForDev(input)
    expect(output).toBe(input) // reference equality — no copy, no allocation
  })

  it('injects dev-client script before </body> when BAKIN_DEV=1', () => {
    process.env.BAKIN_DEV = '1'
    const input = Buffer.from(SAMPLE_HTML, 'utf-8')
    const output = transformIndexHtmlForDev(input)
    const out = output.toString('utf-8')
    expect(out).toContain('<script type="module" src="/__bakin-dev/client.js"></script>')
    // Script lands before </body>, not after.
    expect(out.indexOf('__bakin-dev')).toBeLessThan(out.indexOf('</body>'))
    // The original <script src="/assets/main.js"> is still present.
    expect(out).toContain('/assets/main.js')
  })

  it('no-ops (logs a warning) when </body> is missing', () => {
    process.env.BAKIN_DEV = '1'
    const input = Buffer.from('<html><body></html>', 'utf-8') // malformed, no </body>
    const output = transformIndexHtmlForDev(input)
    expect(output.toString('utf-8')).not.toContain('__bakin-dev')
  })
})
