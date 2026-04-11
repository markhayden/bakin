import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import http from 'http'
import { EventEmitter } from 'events'
import {
  resolveAssetPath,
  buildAssetUrl,
  handleRequest,
  start,
  stop,
} from '../../src/core/antfly-internal-server'
import { resetSettingsCache } from '../../src/core/settings'
import { resetContentDir } from '../../src/core/content-dir'

const TEST_CONTENT_DIR = path.join(process.cwd(), 'test-content-internal-server')
const ASSETS_ROOT = path.join(TEST_CONTENT_DIR, 'assets')

function setupDir() {
  if (fs.existsSync(TEST_CONTENT_DIR)) {
    fs.rmSync(TEST_CONTENT_DIR, { recursive: true })
  }
  fs.mkdirSync(path.join(ASSETS_ROOT, 'images', 'test'), { recursive: true })
  fs.mkdirSync(path.join(ASSETS_ROOT, 'other', 'test'), { recursive: true })
}

/** Build a fake IncomingMessage with a URL, method, and optional remoteAddress. */
function fakeReq(url: string, method = 'GET', remoteAddress = '127.0.0.1'): http.IncomingMessage {
  const req = new EventEmitter() as http.IncomingMessage
  // @ts-expect-error — test fake
  req.url = url
  // @ts-expect-error — test fake
  req.method = method
  // @ts-expect-error — test fake
  req.socket = { remoteAddress }
  return req
}

/** Build a fake ServerResponse that captures status, headers, and body. */
interface CapturedResponse {
  status: number
  headers: Record<string, string | number>
  body: string
  headersSent: boolean
  done: Promise<void>
}

function fakeRes(): { res: http.ServerResponse; captured: CapturedResponse } {
  const chunks: Buffer[] = []
  let resolveDone: () => void = () => {}
  const done = new Promise<void>((r) => { resolveDone = r })

  const captured: CapturedResponse = {
    status: 0,
    headers: {},
    body: '',
    headersSent: false,
    done,
  }

  const res = new EventEmitter() as unknown as http.ServerResponse
  // @ts-expect-error — test fake
  res.writeHead = (status: number, headers?: Record<string, string | number>) => {
    captured.status = status
    if (headers) Object.assign(captured.headers, headers)
    captured.headersSent = true
    return res
  }
  // @ts-expect-error — test fake
  res.write = (chunk: Buffer | string) => {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    return true
  }
  // @ts-expect-error — test fake
  res.end = (chunk?: Buffer | string) => {
    if (chunk) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    captured.body = Buffer.concat(chunks).toString('utf-8')
    resolveDone()
    return res
  }
  // @ts-expect-error — test fake
  res.headersSent = false
  Object.defineProperty(res, 'headersSent', {
    get: () => captured.headersSent,
  })

  return { res, captured }
}

describe('antfly-internal-server', () => {
  beforeEach(() => {
    process.env.CONTENT_DIR = TEST_CONTENT_DIR
    resetContentDir()
    resetSettingsCache()
    setupDir()
  })

  afterEach(async () => {
    await stop()
    delete process.env.CONTENT_DIR
    resetContentDir()
    resetSettingsCache()
    if (fs.existsSync(TEST_CONTENT_DIR)) {
      fs.rmSync(TEST_CONTENT_DIR, { recursive: true })
    }
  })

  describe('resolveAssetPath', () => {
    it('resolves a real file under the assets root', () => {
      const filePath = path.join(ASSETS_ROOT, 'images', 'test', 'foo.png')
      fs.writeFileSync(filePath, 'fake-png-bytes')

      const resolved = resolveAssetPath('images/test/foo.png')
      expect(resolved).toBe(fs.realpathSync(filePath))
    })

    it('returns null for paths that do not exist', () => {
      expect(resolveAssetPath('images/test/ghost.png')).toBeNull()
    })

    it('rejects traversal with .. segments', () => {
      const outside = path.join(TEST_CONTENT_DIR, 'secret.txt')
      fs.writeFileSync(outside, 'sensitive')

      expect(resolveAssetPath('../secret.txt')).toBeNull()
      expect(resolveAssetPath('images/../../secret.txt')).toBeNull()
    })

    it('rejects absolute paths disguised as relative', () => {
      // A leading slash should not let the caller escape the assets root.
      expect(resolveAssetPath('/etc/passwd')).toBeNull()
    })

    it('rejects null byte injection', () => {
      expect(resolveAssetPath('images/test/foo.png\0.txt')).toBeNull()
    })

    it('rejects directories', () => {
      expect(resolveAssetPath('images/test')).toBeNull()
    })

    it('rejects symlinks that escape the assets root', () => {
      const outside = path.join(TEST_CONTENT_DIR, 'leak.txt')
      fs.writeFileSync(outside, 'leaked')
      const linkInside = path.join(ASSETS_ROOT, 'images', 'test', 'leak-link.txt')
      fs.symlinkSync(outside, linkInside)

      expect(resolveAssetPath('images/test/leak-link.txt')).toBeNull()
    })
  })

  describe('buildAssetUrl', () => {
    it('produces a loopback URL with path and token', () => {
      const url = buildAssetUrl('images/test/foo.png', 3738, 'abc123')
      expect(url).toBe('http://127.0.0.1:3738/api/internal/assets/raw/images/test/foo.png?t=abc123')
    })

    it('percent-encodes path segments', () => {
      const url = buildAssetUrl('images/has space/foo bar.png', 3738, 'tok')
      expect(url).toContain('has%20space/foo%20bar.png')
    })

    it('strips a leading slash from the relative path', () => {
      const url = buildAssetUrl('/images/test/foo.png', 3738, 'tok')
      expect(url).toBe('http://127.0.0.1:3738/api/internal/assets/raw/images/test/foo.png?t=tok')
    })
  })

  describe('handleRequest', () => {
    const TOKEN = 'test-token-abcdef'

    it('serves a valid file with the right content-type', async () => {
      const filePath = path.join(ASSETS_ROOT, 'images', 'test', 'foo.png')
      fs.writeFileSync(filePath, 'fake-png-bytes')

      const req = fakeReq(`/api/internal/assets/raw/images/test/foo.png?t=${TOKEN}`)
      const { res, captured } = fakeRes()

      await handleRequest(req, res, TOKEN)
      await captured.done

      expect(captured.status).toBe(200)
      expect(captured.headers['Content-Type']).toBe('image/png')
      expect(captured.body).toBe('fake-png-bytes')
    })

    it('returns 401 when token is missing', async () => {
      const req = fakeReq('/api/internal/assets/raw/images/test/foo.png')
      const { res, captured } = fakeRes()

      await handleRequest(req, res, TOKEN)
      await captured.done

      expect(captured.status).toBe(401)
    })

    it('returns 401 when token is wrong', async () => {
      const req = fakeReq('/api/internal/assets/raw/images/test/foo.png?t=wrong')
      const { res, captured } = fakeRes()

      await handleRequest(req, res, TOKEN)
      await captured.done

      expect(captured.status).toBe(401)
    })

    it('returns 404 for traversal attempts even with valid token', async () => {
      fs.writeFileSync(path.join(TEST_CONTENT_DIR, 'secret.txt'), 'sensitive')

      const req = fakeReq(`/api/internal/assets/raw/..%2Fsecret.txt?t=${TOKEN}`)
      const { res, captured } = fakeRes()

      await handleRequest(req, res, TOKEN)
      await captured.done

      expect(captured.status).toBe(404)
      expect(captured.body).not.toContain('sensitive')
    })

    it('returns 404 for missing files', async () => {
      const req = fakeReq(`/api/internal/assets/raw/images/test/ghost.png?t=${TOKEN}`)
      const { res, captured } = fakeRes()

      await handleRequest(req, res, TOKEN)
      await captured.done

      expect(captured.status).toBe(404)
    })

    it('returns 405 for non-GET methods', async () => {
      const req = fakeReq('/api/internal/assets/raw/anything', 'POST')
      const { res, captured } = fakeRes()

      await handleRequest(req, res, TOKEN)
      await captured.done

      expect(captured.status).toBe(405)
    })

    it('returns 404 for requests outside the assets raw route', async () => {
      const req = fakeReq(`/api/internal/other?t=${TOKEN}`)
      const { res, captured } = fakeRes()

      await handleRequest(req, res, TOKEN)
      await captured.done

      expect(captured.status).toBe(404)
    })
  })

  describe('start / stop — real listener bound to loopback', () => {
    // Override the port to 0 so the OS picks an ephemeral port — avoids
    // cross-test port reuse and keep-alive socket pollution.
    function usePortZero() {
      fs.writeFileSync(
        path.join(TEST_CONTENT_DIR, 'settings.json'),
        JSON.stringify({ antfly: { internal: { port: 0, token: '' } } }),
      )
      resetSettingsCache()
    }

    it('binds to 127.0.0.1 and serves a file', async () => {
      usePortZero()
      const filePath = path.join(ASSETS_ROOT, 'images', 'test', 'foo.png')
      fs.writeFileSync(filePath, 'real-bytes')

      const started = await start()
      expect(started).not.toBeNull()
      const { port, token } = started!
      expect(port).toBeGreaterThan(0)

      const body = await httpGet(`http://127.0.0.1:${port}/api/internal/assets/raw/images/test/foo.png?t=${token}`)
      expect(body).toBe('real-bytes')
    })

    it('rejects requests without a valid token', async () => {
      usePortZero()
      const filePath = path.join(ASSETS_ROOT, 'images', 'test', 'foo.png')
      fs.writeFileSync(filePath, 'real-bytes')

      const started = await start()
      const { port } = started!

      const status = await httpGetStatus(`http://127.0.0.1:${port}/api/internal/assets/raw/images/test/foo.png`)
      expect(status).toBe(401)
    })
  })
})

// ---------------------------------------------------------------------------
// HTTP test helpers
// ---------------------------------------------------------------------------

function httpGet(url: string): Promise<string> {
  const parsed = new URL(url)
  return new Promise((resolvePromise, rejectPromise) => {
    http.get({
      host: parsed.hostname,
      port: Number(parsed.port),
      path: parsed.pathname + parsed.search,
      agent: false, // no keep-alive pool — avoids cross-test socket pollution
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf-8')))
      res.on('error', rejectPromise)
    }).on('error', rejectPromise)
  })
}

function httpGetStatus(url: string): Promise<number> {
  const parsed = new URL(url)
  return new Promise((resolvePromise, rejectPromise) => {
    http.get({
      host: parsed.hostname,
      port: Number(parsed.port),
      path: parsed.pathname + parsed.search,
      agent: false,
    }, (res) => {
      res.resume()
      resolvePromise(res.statusCode ?? 0)
    }).on('error', rejectPromise)
  })
}
