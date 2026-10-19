/**
 * file:// media vs the engine allowlist (antfly 0.2.5 repin review): every
 * file:// value Bakin sends lands in its canonical spelling when it lies in the
 * asset store — including rows persisted under another spelling of the home.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { chmodSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-media-url-${Date.now()}-${randomUUID()}`)
const home = join(testDir, 'home')
const paths = () => ({ getContentDir: () => home, getBakinPaths: () => ({ home, 'assets.store': join(home, 'assets', 'store'), db: join(home, 'bakin.db') }) })
mock.module('../../src/core/content-dir', paths)
mock.module('../../packages/core/src/content-dir', paths)
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { canonicalFilePath, mediaRootsFor, normalizeFileUrls } from '../../packages/adapter-antfly/src/media-url'
import { AntflySearchClient } from '../../packages/adapter-antfly/src/client'
import { DEFAULT_SETTINGS } from '../../packages/adapter-antfly/src/defaults'

mkdirSync(join(home, 'assets', 'store', '2026-10'), { recursive: true })
for (const name of ['my thumb.jpg', 'a.jpg', 'b.jpg']) writeFileSync(join(home, 'assets', 'store', '2026-10', name), 'img')
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

  it('a dot segment is never collapsed into a different file — the engine judges the URL as sent', () => {
    // store/link → elsewhere/sub: `store/link/../a.txt` is elsewhere/a.txt on disk,
    // but a lexical collapse would name store/a.txt.
    mkdirSync(join(testDir, 'elsewhere', 'sub'), { recursive: true })
    writeFileSync(join(testDir, 'elsewhere', 'a.txt'), 'outside')
    writeFileSync(join(home, 'assets', 'store', 'a.txt'), 'inside')
    symlinkSync(join(testDir, 'elsewhere', 'sub'), join(home, 'assets', 'store', 'link'))
    const doc = { media_url: `file://${store}/link/../a.txt` }
    expect(normalizeFileUrls(doc, roots)).toBe(doc)
    const encoded = { media_url: `file://${store}/link/%2E%2E/a.txt` }
    expect(normalizeFileUrls(encoded, roots)).toBe(encoded)
  })

  it('a path that cannot be resolved (a symlink loop) is sent as it is — it never throws or holds up other values', () => {
    symlinkSync(join(testDir, 'loop'), join(testDir, 'loop'))
    const doc = { title: `file://${join(testDir, 'loop', 'x.png')}`, media_url: `file://${join(testDir, 'old-alias', 'assets', 'store', '2026-10', 'b.jpg')}` }
    expect(normalizeFileUrls(doc, roots)).toEqual({ title: doc.title, media_url: `file://${store}/2026-10/b.jpg` })
  })

  it('only the builder\'s exact shape is ever rewritten — any spelling a parser or resolver would change is sent as is', () => {
    const alias = join(testDir, 'old-alias', 'assets', 'store', '2026-10')
    writeFileSync(join(home, 'assets', 'store', '2026-10', 'a.jpg '), 'trailing-space twin')
    const asIs = [
      `file://${alias}/a.jpg/`, // trailing slash (ENOTDIR on disk)
      `file://${alias}//a.jpg`, // doubled slash
      `file://${alias}/sub\\..\\a.jpg`, // raw backslashes
      `file://${alias}/dir%5Ca.jpg`, // encoded backslash
      `file://${alias}/a.jpg `, // raw trailing space (WHATWG strips it)
      `file://${alias}/a.jpg%00`, // NUL
      `file://${alias}/a.jpg\t`, // control character
      `file://${alias}/missing.jpg`, // no such file
      `file://${alias}/a%2Ejpg`, // non-canonical encoding of a.jpg
    ]
    for (const media_url of asIs) {
      const doc = { media_url }
      expect({ media_url, out: normalizeFileUrls(doc, roots) }).toEqual({ media_url, out: doc })
    }
    // The real twin with a trailing space, spelled the builder's way, still normalizes to ITSELF.
    expect(normalizeFileUrls({ media_url: `file://${alias}/a.jpg%20` }, roots)).toEqual({ media_url: `file://${store}/2026-10/a.jpg%20` })
  })

  it('an encoded slash never smuggles a traversal past the shape check', () => {
    // store/link → elsewhere/sub (from the dot-segment test): link%2F..%2Fa.txt
    // opens elsewhere/a.txt, but realpath would collapse it to store/a.txt.
    const doc = { media_url: `file://${store}/link%2F..%2Fa.txt` }
    expect(normalizeFileUrls(doc, roots)).toBe(doc)
  })

  it('a store under a backslash-named directory is allowlisted only as spelled — never "canonicalized" into an unrelated directory', () => {
    const literal = join(testDir, 'home\\name', 'assets', 'store')
    mkdirSync(literal, { recursive: true })
    mkdirSync(join(testDir, 'home', 'name', 'assets', 'store'), { recursive: true }) // the decoy Bun would resolve to
    expect(mediaRootsFor(literal)).toEqual([literal])
    writeFileSync(join(literal, 'x.png'), 'x')
    const doc = { media_url: `file://${literal.split('/').map((seg, i) => (i === 0 ? '' : encodeURIComponent(seg))).join('/')}/x.png` }
    expect(normalizeFileUrls(doc, mediaRootsFor(literal))).toBe(doc)
  })

  it('a malformed value (a lone surrogate) is left as sent and never stops its siblings', () => {
    const doc = { title: 'file:///' + String.fromCharCode(0xd800), media_url: `file://${join(testDir, 'old-alias', 'assets', 'store', '2026-10', 'a.jpg')}` }
    expect(normalizeFileUrls(doc, roots)).toEqual({ title: doc.title, media_url: `file://${store}/2026-10/a.jpg` })
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
      return Response.json({ status: 'committed', inserted: 1, failed: [] })
    }) as unknown as typeof fetch
    return { c: new AntflySearchClient({ ...DEFAULT_SETTINGS, url }, { fetchImpl }), sent }
  }

  it('a local engine gets the canonical spelling', async () => {
    const { c, sent } = client(DEFAULT_SETTINGS.url)
    await c.documents.index('t', 'k', { media_url: aliasUrl })
    expect((sent[0]!.inserts as Record<string, { media_url: string }>).k!.media_url).toBe(`file://${store}/2026-10/a.jpg`)
  })

  it('a store whose roots cannot be resolved sends the batch as is — never holds it up', async () => {
    const { c, sent } = client(DEFAULT_SETTINGS.url)
    const assets = join(home, 'assets')
    chmodSync(assets, 0o000)
    try {
      await c.documents.batchIndex('t', [{ key: 'k1', doc: { title: 'plain' } }, { key: 'k2', doc: { title: 'file:///unrelated/missing' } }])
    } finally {
      chmodSync(assets, 0o755)
    }
    expect(Object.keys(sent[0]!.inserts as object)).toEqual(['k1', 'k2'])
  })

  it('a guest engine gets the document untouched — its files are not on this machine', async () => {
    const { c, sent } = client('http://10.0.0.9:3738')
    await c.documents.index('t', 'k', { media_url: aliasUrl })
    expect((sent[0]!.inserts as Record<string, { media_url: string }>).k!.media_url).toBe(aliasUrl)
  })
})
