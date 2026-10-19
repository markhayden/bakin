/**
 * file:// media vs the engine allowlist (antfly 0.2.5 repin review): every
 * file:// value Bakin sends lands in its canonical spelling when it lies in the
 * asset store — including rows persisted under another spelling of the home.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, realpathSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-media-url-${Date.now()}-${randomUUID()}`)
const home = join(testDir, 'home')
const paths = () => ({ getContentDir: () => home, getBakinPaths: () => ({ home, 'assets.store': join(home, 'assets', 'store'), db: join(home, 'bakin.db') }) })
mock.module('../../src/core/content-dir', paths)
mock.module('../../packages/core/src/content-dir', paths)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { canonicalFilePath, mediaRootsFor, normalizeFileUrls } from '../../packages/adapter-antfly/src/media-url'
import { AntflySearchClient } from '../../packages/adapter-antfly/src/client'
import { DEFAULT_SETTINGS } from '../../packages/adapter-antfly/src/defaults'

mkdirSync(join(home, 'assets', 'store', '2026-10'), { recursive: true })
mkdirSync(join(testDir, 'elsewhere'), { recursive: true })
symlinkSync(home, join(testDir, 'old-alias'))
const store = realpathSync(join(home, 'assets', 'store'))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('normalizeFileUrls', () => {
  const roots = mediaRootsFor(join(home, 'assets', 'store'))

  it('a URL persisted under an old alias of the home is sent canonically', () => {
    const doc = { title: 'x', media_url: `file://${join(testDir, 'old-alias', 'assets', 'store', '2026-10', 'my thumb.jpg').split('/').map((s, i) => (i === 0 ? '' : encodeURIComponent(s))).join('/')}` }
    expect(normalizeFileUrls(doc, roots)).toEqual({ title: 'x', media_url: `file://${store}/2026-10/my%20thumb.jpg` })
  })

  it('a canonical URL is left as it is (same object)', () => {
    const doc = { media_url: `file://${store}/2026-10/a.jpg` }
    expect(normalizeFileUrls(doc, roots)).toBe(doc)
  })

  it('anything outside the store, a host-form URL, or a non-file value is never rewritten', () => {
    const outside = { media_url: `file://${join(testDir, 'old-alias', '..', 'elsewhere', 'secrets.json')}` }
    expect(normalizeFileUrls(outside, roots)).toBe(outside)
    const hostForm = { media_url: 'file://relative-home/assets/store/a.png' }
    expect(normalizeFileUrls(hostForm, roots)).toBe(hostForm)
    const web = { media_url: 'https://example.com/a.png', n: 3 }
    expect(normalizeFileUrls(web, roots)).toBe(web)
  })

  it('canonicalFilePath re-attaches a missing tail to the deepest existing ancestor', () => {
    expect(canonicalFilePath(join(testDir, 'old-alias', 'assets', 'store', 'not', 'yet.png'))).toBe(join(store, 'not', 'yet.png'))
  })
})

describe('the client sends canonical media URLs to a local engine only', () => {
  const aliasUrl = `file://${join(testDir, 'old-alias', 'assets', 'store', '2026-10', 'a.jpg')}`
  function client(url: string) {
    const sent: Array<Record<string, unknown>> = []
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)))
      return Response.json({ status: 'committed', inserted: 1 })
    }) as unknown as typeof fetch
    return { c: new AntflySearchClient({ ...DEFAULT_SETTINGS, url }, { fetchImpl }), sent }
  }

  it('a local engine gets the canonical spelling', async () => {
    const { c, sent } = client(DEFAULT_SETTINGS.url)
    await c.documents.index('t', 'k', { media_url: aliasUrl })
    expect((sent[0]!.inserts as Record<string, { media_url: string }>).k!.media_url).toBe(`file://${store}/2026-10/a.jpg`)
  })

  it('a guest engine gets the document untouched — its files are not on this machine', async () => {
    const { c, sent } = client('http://10.0.0.9:3738')
    await c.documents.index('t', 'k', { media_url: aliasUrl })
    expect((sent[0]!.inserts as Record<string, { media_url: string }>).k!.media_url).toBe(aliasUrl)
  })
})
