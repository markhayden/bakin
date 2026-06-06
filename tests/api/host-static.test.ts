/**
 * Tests for the dev-client HTML injection in packages/host/src/api/_static.ts.
 *
 * Two cases:
 *   1. BAKIN_DEV=1 injects the dev-client <script> before </body>.
 *   2. BAKIN_DEV unset returns the input buffer reference unchanged so
 *      the compiled binary serves production index.html byte-identical.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { PassThrough } from 'stream'
import type { IncomingMessage, ServerResponse } from 'http'
import { gunzipSync } from 'zlib'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Per CLAUDE.md testing rules — mock content-dir even when the test
// doesn't appear to need storage. Transitive imports can surprise you.
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const testDir = join(tmpdir(), `bakin-test-host-static-${Date.now()}`)
  return {
    getContentDir: () => testDir,
    getBakinPaths: () => ({ root: testDir }),
  }
})
mock.module('../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const testDir = join(tmpdir(), `bakin-test-host-static-${Date.now()}`)
  return {
    getContentDir: () => testDir,
    getBakinPaths: () => ({ root: testDir }),
  }
})

import { serveHostClient, transformIndexHtmlForDev } from '../../packages/host/src/api/_static'
import { setEmbeddedAssets } from '../../packages/host/src/api/_embedded-assets'

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
  <head><title>Bakin</title></head>
  <body class="bg-background">
    <div id="root"></div>
    <script type="module" src="/_app/main.js"></script>
  </body>
</html>
`

function mockReq(path: string, headers: Record<string, string> = {}): IncomingMessage {
  const stream = new PassThrough()
  stream.end()
  const req = stream as unknown as IncomingMessage
  req.method = 'GET'
  req.url = path
  req.headers = {
    host: 'localhost:3737',
    ...headers,
  }
  return req
}

function mockRes() {
  const rawChunks: Buffer[] = []
  const res = {
    headersSent: false,
    writeHead: mock(() => {
      res.headersSent = true
    }),
    end: mock((data?: string | Buffer | Uint8Array) => {
      if (data) rawChunks.push(Buffer.from(data))
    }),
    write: mock((data?: string | Buffer | Uint8Array) => {
      if (data) rawChunks.push(Buffer.from(data))
      return true
    }),
  } as unknown as ServerResponse & {
    headersSent: boolean
    writeHead: ReturnType<typeof mock>
    end: ReturnType<typeof mock>
    write: ReturnType<typeof mock>
    _rawBody: Buffer
  }
  Object.defineProperty(res, '_rawBody', { get: () => Buffer.concat(rawChunks) })
  return res
}

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
    // The original <script src="/_app/main.js"> is still present.
    expect(out).toContain('/_app/main.js')
  })

  it('no-ops (logs a warning) when </body> is missing', () => {
    process.env.BAKIN_DEV = '1'
    const input = Buffer.from('<html><body></html>', 'utf-8') // malformed, no </body>
    const output = transformIndexHtmlForDev(input)
    expect(output.toString('utf-8')).not.toContain('__bakin-dev')
  })
})

describe('host index boot fallback', () => {
  it('includes visible fallback content inside #root before the app bundle loads', () => {
    const html = readFileSync(join(process.cwd(), 'packages/host/public/index.html'), 'utf-8')
    expect(html).toContain('class="bakin-boot"')
    expect(html).toContain('Loading app')
    expect(html.indexOf('class="bakin-boot"')).toBeLessThan(html.indexOf('/_app/main.js'))
  })
})

describe('serveHostClient compression', () => {
  it('gzip-compresses large compressible static responses when requested', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-static-compression-'))
    const assetPath = join(dir, 'compression-test.css')
    writeFileSync(assetPath, `/* compression fixture */\n${'.fixture{color:#fff;}\n'.repeat(500)}`)
    setEmbeddedAssets(new Map([['/compression-test.css', assetPath]]))
    try {
      const req = mockReq('/compression-test.css', { 'accept-encoding': 'gzip' })
      const res = mockRes()
      const handled = await serveHostClient(req, res, new URL('http://localhost/compression-test.css'))

      expect(handled).toBe(true)
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
        'Content-Encoding': 'gzip',
        Vary: 'Accept-Encoding',
      }))
      const decoded = gunzipSync(res._rawBody).toString('utf-8')
      expect(decoded).toContain('compression fixture')
    } finally {
      setEmbeddedAssets(new Map())
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * cacheControlFor — picks the Cache-Control header for asset responses.
 * Dev forces no-store so location.reload() picks up rebuilt bundles;
 * prod keeps the 5-minute cache.
 */
import { cacheControlFor } from '../../packages/host/src/api/_static'

describe('cacheControlFor', () => {
  const prev = process.env.BAKIN_DEV
  afterEach(() => {
    if (prev === undefined) delete process.env.BAKIN_DEV
    else process.env.BAKIN_DEV = prev
  })

  it('returns no-store for any 200 response when BAKIN_DEV=1', () => {
    process.env.BAKIN_DEV = '1'
    expect(cacheControlFor('/_app/main.js', 200)).toBe('no-store')
    expect(cacheControlFor('/vendor/react.js', 200)).toBe('no-store')
    expect(cacheControlFor('/globals.css', 200)).toBe('no-store')
    expect(cacheControlFor('/index.html', 200)).toBe('no-store')
  })

  it('returns no-cache for HTML and public, max-age=300 for other 200s when BAKIN_DEV is unset', () => {
    delete process.env.BAKIN_DEV
    expect(cacheControlFor('/index.html', 200)).toBe('no-cache')
    expect(cacheControlFor('/_app/main.js', 200)).toBe('public, max-age=300')
    expect(cacheControlFor('/vendor/react.js', 200)).toBe('public, max-age=300')
  })

  it('falls back to the prod policy for non-200 responses regardless of env', () => {
    process.env.BAKIN_DEV = '1'
    expect(cacheControlFor('/missing.js', 404)).toBe('public, max-age=300')
    delete process.env.BAKIN_DEV
    expect(cacheControlFor('/missing.js', 404)).toBe('public, max-age=300')
  })
})
