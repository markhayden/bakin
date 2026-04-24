/**
 * Tests for plugins/memory/lib/offsets.ts — persisted byte-offset tracking
 * for incremental JSONL indexing.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-offsets-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { getOffset, setOffset, clearAllOffsets, getOffsetsFilePath } from '../../../plugins/memory/lib/offsets'

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  clearAllOffsets()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('getOffset', () => {
  it('returns 0 when the offsets file does not exist', () => {
    expect(getOffset('anything')).toBe(0)
  })

  it('returns 0 for a key not in an existing offsets file', () => {
    setOffset('other', 42)
    expect(getOffset('missing')).toBe(0)
  })
})

describe('setOffset + getOffset', () => {
  it('round-trips a single value', () => {
    setOffset('file-a', 1234)
    expect(getOffset('file-a')).toBe(1234)
  })

  it('round-trips multiple keys independently', () => {
    setOffset('file-a', 100)
    setOffset('file-b', 200)
    expect(getOffset('file-a')).toBe(100)
    expect(getOffset('file-b')).toBe(200)
  })

  it('overwrites the same key with the latest value', () => {
    setOffset('file-a', 100)
    setOffset('file-a', 999)
    expect(getOffset('file-a')).toBe(999)
  })
})

describe('persistence', () => {
  it('persists to ~/.bakin/plugin-settings/memory/offsets.json', () => {
    setOffset('file-a', 500)
    const expected = join(testDir, 'plugin-settings', 'memory', 'offsets.json')
    expect(existsSync(expected)).toBe(true)
    const parsed = JSON.parse(readFileSync(expected, 'utf-8'))
    expect(parsed['file-a']).toBe(500)
  })

  it('creates parent directory if missing', () => {
    setOffset('new', 1)
    const dir = join(testDir, 'plugin-settings', 'memory')
    expect(existsSync(dir)).toBe(true)
  })

  it('reads existing offsets from disk on first call', () => {
    const dir = join(testDir, 'plugin-settings', 'memory')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'offsets.json'), JSON.stringify({ seeded: 77 }), 'utf-8')
    clearAllOffsets()
    expect(getOffset('seeded')).toBe(77)
  })
})

describe('atomicity', () => {
  it('writes via a .tmp file and rename (no torn writes)', () => {
    setOffset('file-a', 1)
    const dir = join(testDir, 'plugin-settings', 'memory')
    const tmp = join(dir, 'offsets.json.tmp')
    // After a successful write the tmp file should not linger.
    expect(existsSync(tmp)).toBe(false)
  })

  it('ignores a malformed existing file and rebuilds', () => {
    const dir = join(testDir, 'plugin-settings', 'memory')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'offsets.json'), 'not json {{{', 'utf-8')
    clearAllOffsets()
    // Malformed file → getOffset returns 0, and setOffset should rebuild cleanly.
    expect(getOffset('anything')).toBe(0)
    setOffset('fresh', 5)
    expect(getOffset('fresh')).toBe(5)
  })
})

describe('validation', () => {
  it('rejects negative offsets', () => {
    expect(() => setOffset('bad', -1)).toThrow()
  })

  it('rejects non-finite offsets', () => {
    expect(() => setOffset('bad', Number.NaN)).toThrow()
    expect(() => setOffset('bad', Number.POSITIVE_INFINITY)).toThrow()
  })
})

describe('getOffsetsFilePath', () => {
  it('resolves under the content dir (never ~/.bakin during tests)', () => {
    expect(getOffsetsFilePath()).toBe(join(testDir, 'plugin-settings', 'memory', 'offsets.json'))
  })
})
