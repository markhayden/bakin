import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes, randomUUID } from 'crypto'
import realSharp from 'sharp'

// ── Mandatory isolation: temp content dir + OpenClaw home (CLAUDE.md rules) ──
const testDir = join(tmpdir(), `bakin-test-avatar-display-${Date.now()}-${randomUUID()}`)
const agentsDir = join(testDir, 'agents')
const cacheDir = join(testDir, '.cache')

const contentDirMock = {
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, agents: agentsDir, cache: cacheDir, media: join(testDir, 'media') }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}
mock.module('@/core/content-dir', () => contentDirMock)
mock.module('../../../src/core/content-dir', () => contentDirMock)
mock.module('@bakin/core/content-dir', () => contentDirMock)
mock.module('../../../packages/core/src/content-dir', () => contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...p: string[]) => join(testDir, 'openclaw', ...p),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

// The loader is the seam: tests choose real sharp, absent sharp, or a throwing one.
type SharpLike = typeof realSharp
let sharpImpl: SharpLike | null = realSharp
const loadSharp = mock(async () => sharpImpl)
const sharpLoaderMock = () => ({ loadSharp, resetSharpModuleCache: () => {} })
mock.module('../../../packages/core/src/media/sharp-loader', sharpLoaderMock)
mock.module('@bakin/core/media/sharp-loader', sharpLoaderMock)

const { serveAvatar } = await import('../../../packages/core/src/agents/avatar')

/** A photo-like JPEG well over the 64 KiB threshold (random noise compresses badly). */
async function bigJpeg(width = 1200, height = 900): Promise<Buffer> {
  const noise = randomBytes(width * height * 3)
  return realSharp(noise, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer()
}

async function smallPng(): Promise<Buffer> {
  return realSharp({ create: { width: 32, height: 32, channels: 3, background: '#ff4d94' } }).png().toBuffer()
}

function writeAvatar(id: string, ext: string, bytes: Buffer): string {
  const dir = join(agentsDir, id)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `avatar.${ext}`)
  writeFileSync(path, bytes)
  return path
}

const get = (id: string, headers: Record<string, string> = {}) =>
  serveAvatar(new Request('http://x/api/agents/avatar', { headers }), id)

beforeEach(() => {
  sharpImpl = realSharp
  loadSharp.mockClear()
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('serveAvatar — display variant', () => {
  it('serves a small source as-is', async () => {
    const png = await smallPng()
    writeAvatar('small', 'png', png)
    const res = await get('small')
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true)
    expect(loadSharp).not.toHaveBeenCalled()
  })

  it('derives a WebP no larger than 256 px and 64 KiB from a large source, leaving the original byte-identical', async () => {
    const jpeg = await bigJpeg()
    expect(jpeg.length).toBeGreaterThan(64 * 1024)
    const sourcePath = writeAvatar('large', 'jpg', jpeg)

    const started = performance.now()
    const res = await get('large')
    const coldMs = performance.now() - started
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.length).toBeLessThanOrEqual(65_536)
    const meta = await realSharp(body).metadata()
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(256)
    expect(meta.width! / meta.height!).toBeCloseTo(1200 / 900, 1)
    expect(readFileSync(sourcePath).equals(jpeg)).toBe(true)

    // Second GET is a cache hit: no conversion.
    loadSharp.mockClear()
    const warmStarted = performance.now()
    const again = await get('large')
    const warmMs = performance.now() - warmStarted
    expect(again.headers.get('Content-Type')).toBe('image/webp')
    expect(loadSharp).not.toHaveBeenCalled()
    console.info(`avatar display variant: cold ${coldMs.toFixed(1)} ms, warm ${warmMs.toFixed(1)} ms`)
  })

  it('never upscales a source smaller than 256 px', async () => {
    const noise = randomBytes(200 * 150 * 3)
    const png = await realSharp(noise, { raw: { width: 200, height: 150, channels: 3 } }).png().toBuffer()
    expect(png.length).toBeGreaterThan(64 * 1024)
    writeAvatar('narrow', 'png', png)
    const meta = await realSharp(Buffer.from(await (await get('narrow')).arrayBuffer())).metadata()
    expect([meta.width, meta.height]).toEqual([200, 150])
  })

  it('regenerates when the source changes', async () => {
    const path = writeAvatar('changing', 'jpg', await bigJpeg())
    const first = (await get('changing')).headers.get('ETag')
    writeFileSync(path, await bigJpeg(1000, 1000))
    utimesSync(path, new Date(), new Date(Date.now() + 5000))
    loadSharp.mockClear()
    const second = await get('changing')
    expect(loadSharp).toHaveBeenCalled()
    expect(second.headers.get('ETag')).not.toBe(first)
    const meta = await realSharp(Buffer.from(await second.arrayBuffer())).metadata()
    expect([meta.width, meta.height]).toEqual([256, 256])
  })

  it('keeps derived and original validators distinct, and honors If-None-Match on the derived one', async () => {
    writeAvatar('validators', 'jpg', await bigJpeg())
    const etag = (await get('validators')).headers.get('ETag')!
    // The derived representation has its own validator family; the original
    // (sharp-absent test below) never starts with it.
    expect(etag.startsWith('"display-')).toBe(true)
    const conditional = await get('validators', { 'If-None-Match': etag })
    expect(conditional.status).toBe(304)
    expect(conditional.headers.get('ETag')).toBe(etag)
  })

  it('serves the original when sharp is unavailable, then derives once sharp is installed (no restart)', async () => {
    const jpeg = await bigJpeg()
    writeAvatar('no-sharp', 'jpg', jpeg)
    sharpImpl = null
    const before = await get('no-sharp')
    expect(before.headers.get('Content-Type')).toBe('image/jpeg')
    expect(Buffer.from(await before.arrayBuffer()).equals(jpeg)).toBe(true)
    expect(before.headers.get('ETag')!.startsWith('"display-')).toBe(false)

    sharpImpl = realSharp
    const after = await get('no-sharp')
    expect(after.headers.get('Content-Type')).toBe('image/webp')
  })

  it('serves the original after a conversion failure and does not retry for that source', async () => {
    writeAvatar('broken', 'jpg', await bigJpeg())
    const throwing = mock(() => { throw new Error('decode failed') })
    sharpImpl = throwing as unknown as SharpLike
    const first = await get('broken')
    expect(first.headers.get('Content-Type')).toBe('image/jpeg')
    const callsAfterFirst = throwing.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)
    const second = await get('broken')
    expect(second.headers.get('Content-Type')).toBe('image/jpeg')
    expect(throwing.mock.calls.length).toBe(callsAfterFirst)
  })

  it('runs one conversion for concurrent requests', async () => {
    writeAvatar('concurrent', 'jpg', await bigJpeg())
    let conversions = 0
    sharpImpl = ((input: unknown, opts?: unknown) => { conversions++; return realSharp(input as Buffer, opts as never) }) as unknown as SharpLike
    const responses = await Promise.all(Array.from({ length: 5 }, () => get('concurrent')))
    expect(responses.every((r) => r.headers.get('Content-Type') === 'image/webp')).toBe(true)
    expect(conversions).toBe(1)
  })

  it('serves the original when the cache directory is unwritable', async () => {
    if (process.getuid?.() === 0) return // root ignores permission bits
    writeAvatar('readonly-cache', 'jpg', await bigJpeg())
    const avatarCache = join(cacheDir, 'avatars')
    mkdirSync(avatarCache, { recursive: true })
    chmodSync(avatarCache, 0o500)
    try {
      const res = await get('readonly-cache')
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/jpeg')
      expect(existsSync(join(avatarCache, 'readonly-cache.webp'))).toBe(false)
    } finally {
      chmodSync(avatarCache, 0o700)
    }
  })
})
