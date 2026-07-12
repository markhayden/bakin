/**
 * Shared pre-send image downscale (packages/core/src/media/downscale.ts) —
 * extracted from the assets enrichment engine so chat attachments and
 * enrichment share ONE implementation. Under-limit originals pass through
 * untouched; downscaled temp JPEGs are the CALLER's to clean up and
 * cleanupPreparedAttachment removes exactly the temp dir (never originals).
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { rmSync, mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'fs'
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

import {
  prepareImageAttachment,
  cleanupPreparedAttachment,
  INLINE_ATTACHMENT_LIMIT_BYTES,
} from '../../packages/core/src/media/downscale'

mkdirSync(testDir, { recursive: true })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('prepareImageAttachment', () => {
  it('under-limit originals pass through as-is (downscaled: false)', async () => {
    const original = join(testDir, 'small.png')
    writeFileSync(original, Buffer.alloc(1024))
    const prepared = await prepareImageAttachment(original, 'image/png')
    expect(prepared).toEqual({ path: original, mimeType: 'image/png', downscaled: false })
  })

  it('exports the 2 MB inline cap the adapters enforce', () => {
    expect(INLINE_ATTACHMENT_LIMIT_BYTES).toBe(2_000_000)
  })
})

describe('cleanupPreparedAttachment', () => {
  it('removes the temp dir of a downscaled attachment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-downscale-'))
    const path = join(dir, 'attachment.jpg')
    writeFileSync(path, Buffer.alloc(64))
    cleanupPreparedAttachment({ path, mimeType: 'image/jpeg', downscaled: true })
    expect(existsSync(dir)).toBe(false)
  })

  it('NEVER touches a passthrough original (downscaled: false)', () => {
    const original = join(testDir, 'keep-me.png')
    writeFileSync(original, Buffer.alloc(64))
    cleanupPreparedAttachment({ path: original, mimeType: 'image/png', downscaled: false })
    expect(existsSync(original)).toBe(true)
    expect(existsSync(dirname(original))).toBe(true)
  })
})
