/**
 * Tests for the shared adapter file utils — the single implementation behind
 * trajectory-forensics' incremental reads and runtime.ts's session-file tail.
 * The two former local copies disagreed on edge semantics; these tests lock
 * the reconciled contract both call sites adapt from:
 *
 *   error              → null
 *   size <  offset     → null, or rewind-to-0 read when rewindOnTruncate
 *   size === offset    → { text: '', nextOffset: offset } (no new bytes)
 *   size >  offset     → { text, nextOffset: offset + bytesRead }
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-file-utils-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = join(testDir, 'bakin')
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ tasks: join(testDir, 'bakin', 'tasks') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ tasks: join(testDir, 'bakin', 'tasks') }),
}))

import { safeFileSize, readFileFrom } from '../../packages/adapter-openclaw/src/file-utils'

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('safeFileSize', () => {
  it('returns the byte size of an existing file', () => {
    const p = join(testDir, 'f.txt')
    writeFileSync(p, 'hello')
    expect(safeFileSize(p)).toBe(5)
  })

  it('returns 0 for a missing file', () => {
    expect(safeFileSize(join(testDir, 'missing.txt'))).toBe(0)
  })
})

describe('readFileFrom', () => {
  it('reads from an offset and advances nextOffset', () => {
    const p = join(testDir, 'log.jsonl')
    writeFileSync(p, 'first\n')
    appendFileSync(p, 'second\n')
    const r = readFileFrom(p, 6)
    expect(r).toEqual({ text: 'second\n', nextOffset: 13, rewound: false })
  })

  it('returns empty text with unchanged offset when no new bytes', () => {
    const p = join(testDir, 'log.jsonl')
    writeFileSync(p, 'abc')
    expect(readFileFrom(p, 3)).toEqual({ text: '', nextOffset: 3, rewound: false })
  })

  it('returns null when the file shrank below the offset (default)', () => {
    const p = join(testDir, 'log.jsonl')
    writeFileSync(p, 'ab')
    expect(readFileFrom(p, 10)).toBeNull()
  })

  it('rewinds to 0 on truncation when rewindOnTruncate is set', () => {
    const p = join(testDir, 'log.jsonl')
    writeFileSync(p, 'fresh')
    const r = readFileFrom(p, 10, { rewindOnTruncate: true })
    expect(r).toEqual({ text: 'fresh', nextOffset: 5, rewound: true })
  })

  it('returns null for a missing file', () => {
    expect(readFileFrom(join(testDir, 'missing.jsonl'), 0)).toBeNull()
  })

  it('handles multi-byte UTF-8 content', () => {
    const p = join(testDir, 'utf8.jsonl')
    writeFileSync(p, '📦🚀\n')
    const r = readFileFrom(p, 0)
    expect(r?.text).toBe('📦🚀\n')
    expect(r?.nextOffset).toBe(Buffer.byteLength('📦🚀\n'))
  })
})
