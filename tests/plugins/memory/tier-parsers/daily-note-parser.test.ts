/**
 * Tests for plugins/memory/lib/tier-parsers/daily-note-parser.ts.
 *
 * Daily notes are `workspace/memory/YYYY-MM-DD*.md` files written by
 * OpenClaw during each day's activity. Unlike durable files, we do NOT
 * chunk — one file = one MemoryRow. The parser extracts the date prefix
 * from the filename into meta.date so the UI can sort chronologically.
 */
import { describe, it, expect, vi } from 'vitest'

// Defensive isolation — pure parser, but the hook requires mocks.
vi.mock('../../../../src/core/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-daily-note-parser-mock')
  return { getContentDir: () => base, getBakinPaths: () => ({ root: base }) }
})
vi.mock('../../../../packages/core/src/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-daily-note-parser-mock')
  return { getContentDir: () => base, getBakinPaths: () => ({ root: base }) }
})
vi.mock('../../../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { parseDailyNote } from '../../../../plugins/memory/lib/tier-parsers/daily-note-parser'
import { MemoryRowSchema, DailyNoteMetaSchema } from '../../../../plugins/memory/lib/types'

const sourcePath = '/fake/.openclaw/workspace/memory/2026-04-18.md'
const mtime = Date.parse('2026-04-18T18:00:00.000Z')

describe('parseDailyNote — well-formed filename', () => {
  it('returns a MemoryRow with tier=daily_note', () => {
    const row = parseDailyNote('main', '2026-04-18.md', 'body', sourcePath, mtime, 5)
    expect(row).not.toBeNull()
    expect(row!.tier).toBe('daily_note')
    expect(MemoryRowSchema.safeParse(row).success).toBe(true)
  })

  it('extracts the date prefix into meta.date', () => {
    const row = parseDailyNote('main', '2026-04-18.md', 'x', sourcePath, mtime, 1)!
    const meta = DailyNoteMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.date).toBe('2026-04-18')
    expect(meta.file).toBe('2026-04-18.md')
    expect(meta.openclawIndexed).toBe(true)
  })

  it('extracts date prefix from dash-suffixed filenames (e.g. 2026-04-18-session.md)', () => {
    const row = parseDailyNote('main', '2026-04-18-session.md', 'x', sourcePath, mtime, 1)!
    const meta = DailyNoteMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.date).toBe('2026-04-18')
    expect(meta.file).toBe('2026-04-18-session.md')
  })

  it('titles the row with the filename', () => {
    const row = parseDailyNote('main', '2026-04-18.md', 'x', sourcePath, mtime, 1)!
    expect(row.title).toBe('2026-04-18.md')
  })

  it('records sizeBytes from the passed-in stat', () => {
    const row = parseDailyNote('main', '2026-04-18.md', 'body', sourcePath, mtime, 1234)!
    const meta = DailyNoteMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.sizeBytes).toBe(1234)
  })

  it('updatedAt and createdAt come from the file mtime arg', () => {
    const row = parseDailyNote('main', '2026-04-18.md', 'x', sourcePath, mtime, 1)!
    expect(row.updatedAt).toBe(mtime)
    expect(row.createdAt).toBe(mtime)
  })

  it('sourceRef points at the original file', () => {
    const row = parseDailyNote('main', '2026-04-18.md', 'x', sourcePath, mtime, 1)!
    expect(row.sourceRef.backend).toBe('openclaw')
    expect(row.sourceRef.path).toBe(sourcePath)
    expect(row.sourceRef.file).toBe('2026-04-18.md')
  })

  it('stable id for same (agent, filename)', () => {
    const a = parseDailyNote('main', '2026-04-18.md', 'x', sourcePath, mtime, 1)!
    const b = parseDailyNote('main', '2026-04-18.md', 'x', sourcePath, mtime, 1)!
    expect(a.id).toBe(b.id)
    expect(a.id).toMatch(/^daily_note:/)
  })

  it('different agents produce different ids for the same file', () => {
    const a = parseDailyNote('main', '2026-04-18.md', 'x', sourcePath, mtime, 1)!
    const b = parseDailyNote('scout', '2026-04-18.md', 'x', sourcePath, mtime, 1)!
    expect(a.id).not.toBe(b.id)
  })

  it('snippet caps at ~2KB; content keeps the full file body', () => {
    const big = 'x'.repeat(5000)
    const row = parseDailyNote('main', '2026-04-18.md', big, sourcePath, mtime, big.length)!
    expect(row.snippet.length).toBeLessThanOrEqual(2048)
    expect(row.content.length).toBe(5000)
  })
})

describe('parseDailyNote — invalid filenames', () => {
  it('returns null when filename is not date-prefixed', () => {
    expect(parseDailyNote('main', 'random.md', 'x', sourcePath, mtime, 1)).toBeNull()
  })

  it('returns null when filename has wrong date format (YYYY-MM)', () => {
    expect(parseDailyNote('main', '2026-04.md', 'x', sourcePath, mtime, 1)).toBeNull()
  })

  it('returns null when filename has no .md suffix', () => {
    expect(parseDailyNote('main', '2026-04-18', 'x', sourcePath, mtime, 1)).toBeNull()
  })

  it('returns null for empty filename', () => {
    expect(parseDailyNote('main', '', 'x', sourcePath, mtime, 1)).toBeNull()
  })
})
