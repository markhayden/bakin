/**
 * THE pre-send image seam (packages/core/src/media/downscale.ts) shared by
 * chat attachments and asset enrichment. Under-limit raster originals pass
 * through untouched; anything the seam writes (downscaled JPEG, rasterized
 * PNG/JPEG) is `owned` and cleanupPreparedAttachment removes exactly that
 * temp dir (never originals). Non-raster images are rasterized (#855);
 * undecodable ones fail typed (`unrasterizable`) and leave no temp dir.
 * Uses REAL sharp — the no-sharp paths live in downscale-remediation.test.ts.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { rmSync, mkdirSync, mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync, chmodSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-media-downscale-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    assets: join(testDir, 'assets'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import sharp from 'sharp'
import {
  prepareImageAttachment,
  cleanupPreparedAttachment,
  ImageNotSendableError,
  INLINE_ATTACHMENT_LIMIT_BYTES,
} from '../../packages/core/src/media/downscale'

/** Temp dirs the seam owns live under tmpdir() as bakin-downscale-*. */
function seamTempDirs(): Set<string> {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('bakin-downscale-')))
}

async function expectNoNewTempDirs(run: () => Promise<unknown>): Promise<unknown> {
  const before = seamTempDirs()
  let caught: unknown
  try { await run() } catch (err) { caught = err }
  const leaked = [...seamTempDirs()].filter((name) => !before.has(name))
  expect(leaked).toEqual([])
  return caught
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const startsWith = (path: string, magic: number[]) => magic.every((byte, i) => readFileSync(path)[i] === byte)

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

// 1×1 24-bit BMP: a real image the pinned sharp build has no decoder for.
const BMP_1PX = Buffer.from('424d3a0000000000000036000000280000000100000001000000010018000000000004000000130b0000130b00000000000000000000ff000000', 'hex')

mkdirSync(testDir, { recursive: true })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('prepareImageAttachment', () => {
  it('an under-limit raster passes through as-is, with the mime its BYTES prove', async () => {
    const original = join(testDir, 'small.png')
    writeFileSync(original, PNG_1PX)
    expect(await prepareImageAttachment(original, 'image/png')).toEqual({ path: original, mimeType: 'image/png', owned: false })
    // A mislabeled declaration is corrected, never trusted.
    expect(await prepareImageAttachment(original, 'image/jpeg')).toEqual({ path: original, mimeType: 'image/png', owned: false })
  })

  it('an SVG named .png and declared image/png is rasterized, never passed through (#855)', async () => {
    const original = join(testDir, 'liar.png')
    writeFileSync(original, '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>')
    const prepared = await prepareImageAttachment(original, 'image/png')
    expect(prepared.owned).toBe(true)
    expect(prepared.path).not.toBe(original)
    expect(startsWith(prepared.path, PNG_MAGIC)).toBe(true)
    cleanupPreparedAttachment(prepared)
  })

  it.skipIf(process.getuid?.() === 0)('an unreadable source is a plain fs error, never a typed bad-image verdict', async () => {
    const original = join(testDir, 'locked.svg')
    writeFileSync(original, '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>')
    chmodSync(original, 0o000)
    try {
      const err = await expectNoNewTempDirs(() => prepareImageAttachment(original, 'image/svg+xml'))
      expect(err).toBeInstanceOf(Error)
      expect(err).not.toBeInstanceOf(ImageNotSendableError)
      expect((err as NodeJS.ErrnoException).code).toBe('EACCES')
    } finally {
      chmodSync(original, 0o644)
    }
  })

  it('downscales an oversized raster to an owned temp JPEG', async () => {
    const width = 2400
    const raw = Buffer.alloc(width * width * 3)
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24
    const original = join(testDir, 'big.png')
    await sharp(raw, { raw: { width, height: width, channels: 3 } }).png({ compressionLevel: 0 }).toFile(original)
    const prepared = await prepareImageAttachment(original, 'image/png')
    expect(prepared.owned).toBe(true)
    expect(prepared.mimeType).toBe('image/jpeg')
    expect(startsWith(prepared.path, JPEG_MAGIC)).toBe(true)
    cleanupPreparedAttachment(prepared)
    expect(existsSync(dirname(prepared.path))).toBe(false)
  })

  it('rasterizes a small SVG to an owned PNG scaled up to a readable size (#855)', async () => {
    const original = join(testDir, 'logo.svg')
    writeFileSync(original, '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#c33"/></svg>')
    const prepared = await prepareImageAttachment(original, 'image/svg+xml')
    expect(prepared.owned).toBe(true)
    expect(prepared.mimeType).toBe('image/png')
    expect(startsWith(prepared.path, PNG_MAGIC)).toBe(true)
    const meta = await sharp(prepared.path).metadata()
    expect(meta.width).toBe(1024)
    expect(meta.height).toBe(512)
    cleanupPreparedAttachment(prepared)
    expect(existsSync(dirname(prepared.path))).toBe(false)
    expect(existsSync(original)).toBe(true)
  })

  it('falls back to JPEG when a rasterized image would not fit as PNG', async () => {
    const width = 2400
    const raw = Buffer.alloc(width * width * 3)
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24
    const original = join(testDir, 'noise.tiff')
    await sharp(raw, { raw: { width, height: width, channels: 3 } }).tiff().toFile(original)
    const prepared = await prepareImageAttachment(original, 'image/tiff')
    expect(prepared.mimeType).toBe('image/jpeg')
    expect(startsWith(prepared.path, JPEG_MAGIC)).toBe(true)
    cleanupPreparedAttachment(prepared)
  })

  it('a codec sharp cannot decode (BMP) fails typed as unrasterizable and leaks no temp dir', async () => {
    const original = join(testDir, 'pixel.bmp')
    writeFileSync(original, BMP_1PX)
    const err = await expectNoNewTempDirs(() => prepareImageAttachment(original, 'image/bmp'))
    expect(err).toBeInstanceOf(ImageNotSendableError)
    expect((err as ImageNotSendableError).reason).toBe('unrasterizable')
  })

  it('a malformed SVG fails typed as unrasterizable and leaks no temp dir', async () => {
    const original = join(testDir, 'broken.svg')
    writeFileSync(original, '<svg><nope')
    const err = await expectNoNewTempDirs(() => prepareImageAttachment(original, 'image/svg+xml'))
    expect(err).toBeInstanceOf(ImageNotSendableError)
    expect((err as ImageNotSendableError).reason).toBe('unrasterizable')
  })

  it('exports the 2 MB inline cap the adapters enforce', () => {
    expect(INLINE_ATTACHMENT_LIMIT_BYTES).toBe(2_000_000)
  })
})

describe('cleanupPreparedAttachment', () => {
  it('removes the temp dir of an owned attachment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-downscale-'))
    const path = join(dir, 'attachment.jpg')
    writeFileSync(path, Buffer.alloc(64))
    cleanupPreparedAttachment({ path, mimeType: 'image/jpeg', owned: true })
    expect(existsSync(dir)).toBe(false)
  })

  it('NEVER touches a passthrough original (owned: false)', () => {
    const original = join(testDir, 'keep-me.png')
    writeFileSync(original, Buffer.alloc(64))
    cleanupPreparedAttachment({ path: original, mimeType: 'image/png', owned: false })
    expect(existsSync(original)).toBe(true)
    expect(existsSync(dirname(original))).toBe(true)
  })
})
