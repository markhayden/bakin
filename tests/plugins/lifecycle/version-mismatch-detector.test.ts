/**
 * Coverage for packages/host/src/plugin-host/version-mismatch-detector.ts
 * (Phase 2 P2.C6).
 *
 * The detector runs in the browser; tests exercise the pure parsing +
 * comparison helpers (parseVersionHeader / detectMismatch), then the
 * fetch-wrapping installer in a synthetic environment that stubs
 * window.dispatchEvent + globalThis.fetch.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-version-detector-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import {
  parseVersionHeader,
  detectMismatch,
  installVersionMismatchDetector,
  __resetDetectorForTest,
  VERSION_MISMATCH_EVENT,
  type VersionMismatchDetail,
} from '../../../packages/host/src/plugin-host/version-mismatch-detector'

describe('parseVersionHeader', () => {
  it.each([
    ['foo:0', { pluginId: 'foo', version: 0 }],
    ['foo:1', { pluginId: 'foo', version: 1 }],
    ['my-plugin:42', { pluginId: 'my-plugin', version: 42 }],
  ])('parses %p', (input, expected) => {
    expect(parseVersionHeader(input)).toEqual(expected)
  })

  it.each([
    null,
    '',
    'foo',
    'foo:',
    ':1',
    'foo:bar',
    'foo:1.5',
    'foo:0x10',
  ])('rejects %p', (input) => {
    expect(parseVersionHeader(input)).toBeNull()
  })
})

describe('detectMismatch', () => {
  it('seeds the version on first sighting without firing', () => {
    const versions = new Map<string, number>()
    expect(detectMismatch('foo', 'foo:5', versions)).toBeNull()
    expect(versions.get('foo')).toBe(5)
  })

  it('returns null when version matches the known value', () => {
    const versions = new Map<string, number>([['foo', 3]])
    expect(detectMismatch('foo', 'foo:3', versions)).toBeNull()
  })

  it('fires a mismatch when version increments', () => {
    const versions = new Map<string, number>([['foo', 3]])
    expect(detectMismatch('foo', 'foo:4', versions)).toEqual({
      pluginId: 'foo',
      oldVersion: 3,
      newVersion: 4,
    })
    expect(versions.get('foo')).toBe(4)
  })

  it('fires on regression (server restart resets to 0)', () => {
    const versions = new Map<string, number>([['foo', 7]])
    expect(detectMismatch('foo', 'foo:0', versions)).toEqual({
      pluginId: 'foo',
      oldVersion: 7,
      newVersion: 0,
    })
  })

  it('refuses headers whose pluginId does not match the URL plugin', () => {
    // Defense against weird intermediate caches serving the wrong response.
    const versions = new Map<string, number>([['foo', 1]])
    expect(detectMismatch('foo', 'bar:2', versions)).toBeNull()
    expect(versions.get('foo')).toBe(1)
  })

  it('returns null on missing/malformed headers (treated as "no info")', () => {
    const versions = new Map<string, number>([['foo', 3]])
    expect(detectMismatch('foo', null, versions)).toBeNull()
    expect(detectMismatch('foo', 'malformed', versions)).toBeNull()
    expect(versions.get('foo')).toBe(3)
  })
})

describe('installVersionMismatchDetector', () => {
  let originalFetch: typeof fetch
  let originalWindow: typeof window | undefined
  const dispatchedEvents: VersionMismatchDetail[] = []

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalWindow = (globalThis as unknown as { window?: typeof window }).window
    dispatchedEvents.length = 0
    __resetDetectorForTest()

    // Synthesize just enough of `window` to capture dispatched events.
    ;(globalThis as unknown as { window: { dispatchEvent: (e: Event) => boolean; location: { origin: string } } }).window = {
      dispatchEvent: (event: Event) => {
        const detail = (event as CustomEvent<VersionMismatchDetail>).detail
        if (event.type === VERSION_MISMATCH_EVENT && detail) {
          dispatchedEvents.push(detail)
        }
        return true
      },
      location: { origin: 'http://localhost:3737' },
    }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalWindow === undefined) {
      delete (globalThis as unknown as { window?: typeof window }).window
    } else {
      ;(globalThis as unknown as { window: typeof window }).window = originalWindow
    }
    __resetDetectorForTest()
  })

  // Mutable closure value the stub reads from, so tests can change the
  // header response between fetches without overwriting the (now-wrapped)
  // globalThis.fetch and bypassing the detector.
  let stampNext: string | null = null

  function installStub(): void {
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const headers = new Headers()
      if (stampNext !== null) headers.set('X-Bakin-Plugin-Version', stampNext)
      return new Response(null, { status: 200, headers })
    }) as unknown as typeof fetch
  }

  it('fires an event on version drift', async () => {
    stampNext = 'foo:1'
    installStub()
    installVersionMismatchDetector()

    // First fetch seeds the version (no event).
    await globalThis.fetch('/api/plugins/foo/data')
    expect(dispatchedEvents).toEqual([])

    // Second fetch with a higher version triggers the event.
    stampNext = 'foo:2'
    await globalThis.fetch('/api/plugins/foo/data')
    expect(dispatchedEvents).toEqual([{ pluginId: 'foo', oldVersion: 1, newVersion: 2 }])
  })

  it('ignores lifecycle endpoints (install/remove/upgrade/manifest/link/unlink)', async () => {
    stampNext = 'whatever:99'
    installStub()
    installVersionMismatchDetector()
    await globalThis.fetch('/api/plugins/install', { method: 'POST' })
    await globalThis.fetch('/api/plugins/manifest')
    await globalThis.fetch('/api/plugins/link', { method: 'POST' })
    expect(dispatchedEvents).toEqual([])
  })

  it('ignores non-plugin URLs', async () => {
    stampNext = 'foo:1'
    installStub()
    installVersionMismatchDetector()
    await globalThis.fetch('/api/agents')
    await globalThis.fetch('https://example.com/foo')
    expect(dispatchedEvents).toEqual([])
  })

  it('is idempotent — second install does not double-wrap fetch', async () => {
    stampNext = 'foo:1'
    installStub()
    installVersionMismatchDetector()
    const wrappedOnce = globalThis.fetch
    installVersionMismatchDetector()
    expect(globalThis.fetch).toBe(wrappedOnce)
  })

  it('does not break the user fetch when header inspection throws', async () => {
    // Hand back a Response whose headers.get throws — verify the wrapper
    // still resolves to the original Response.
    const broken = new Response('ok')
    Object.defineProperty(broken.headers, 'get', {
      value: () => { throw new Error('synthetic header error') },
    })
    globalThis.fetch = (async () => broken) as unknown as typeof fetch
    installVersionMismatchDetector()
    const result = await globalThis.fetch('/api/plugins/foo/data')
    expect(result).toBe(broken)
    expect(dispatchedEvents).toEqual([])
  })
})
