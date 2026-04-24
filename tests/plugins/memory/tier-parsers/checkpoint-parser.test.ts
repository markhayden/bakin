/**
 * Tests for plugins/memory/lib/tier-parsers/checkpoint-parser.ts.
 *
 * A checkpoint file is a `.checkpoint.<checkpointId>.jsonl` sibling of a
 * session transcript. The file replays session history (session header +
 * messages) plus at least one `type=compaction` event — the compaction's
 * `summary` is the human-readable payload, `tokensBefore` the header
 * stat, and `fromHook` tells us whether the compaction was auto-triggered
 * or manual. Real OpenClaw files never carry `tokensAfter`, so the
 * parser leaves it null.
 *
 * One row per checkpoint file — multiple compaction events in a single
 * file are rare; the first one wins and its fields populate meta.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-checkpoint-parser-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import {
  parseCheckpoint,
  rowId,
  matchCheckpointFilename,
} from '../../../../plugins/memory/lib/tier-parsers/checkpoint-parser'

const SESSION_ID = '13299881-cb29-4026-a163-fd21910b7f36'
const CHECKPOINT_ID = '77442ee3-5362-4e9b-ade1-2e4067a22955'
const FILENAME = `${SESSION_ID}.checkpoint.${CHECKPOINT_ID}.jsonl`
const PATH = `/agents/main/sessions/${FILENAME}`

function line(obj: unknown): string {
  return JSON.stringify(obj)
}

function sessionHeader(): string {
  return line({
    type: 'session',
    version: 3,
    id: SESSION_ID,
    timestamp: '2026-04-15T23:19:17.284Z',
  })
}

function compaction(overrides: Record<string, unknown> = {}): string {
  return line({
    type: 'compaction',
    id: 'cmp-1',
    parentId: 'parent-1',
    timestamp: '2026-04-15T23:23:17.558Z',
    summary: '## Decisions\nNone.\n\n## Progress\n- Did a thing.',
    tokensBefore: 74871,
    fromHook: true,
    ...overrides,
  })
}

function body(lines: string[]): string {
  return lines.join('\n') + '\n'
}

describe('matchCheckpointFilename', () => {
  it('extracts sessionId + checkpointId from a canonical filename', () => {
    expect(matchCheckpointFilename(FILENAME)).toEqual({
      sessionId: SESSION_ID,
      checkpointId: CHECKPOINT_ID,
    })
  })

  it('rejects non-checkpoint filenames', () => {
    expect(matchCheckpointFilename(`${SESSION_ID}.jsonl`)).toBeNull()
    expect(matchCheckpointFilename('random.md')).toBeNull()
    expect(matchCheckpointFilename('checkpoint.only.jsonl')).toBeNull()
  })

  it('rejects checkpoint-like names with extra segments', () => {
    expect(matchCheckpointFilename(`${SESSION_ID}.checkpoint.a.b.jsonl`)).toBeNull()
  })
})

describe('parseCheckpoint — happy path', () => {
  it('returns one row per checkpoint file with summary as content', () => {
    const row = parseCheckpoint(
      'main',
      SESSION_ID,
      CHECKPOINT_ID,
      FILENAME,
      body([sessionHeader(), compaction()]),
      PATH,
      1_710_000_000_000,
    )
    expect(row).not.toBeNull()
    expect(row!.tier).toBe('checkpoint')
    expect(row!.agent).toBe('main')
    expect(row!.content).toContain('## Decisions')
    expect(row!.content).toContain('## Progress')
  })

  it('surfaces tokensBefore + trigger=auto when fromHook=true', () => {
    const row = parseCheckpoint(
      'main',
      SESSION_ID,
      CHECKPOINT_ID,
      FILENAME,
      body([sessionHeader(), compaction({ fromHook: true, tokensBefore: 12345 })]),
      PATH,
      0,
    )!
    const meta = JSON.parse(row.meta) as Record<string, unknown>
    expect(meta.tokensBefore).toBe(12345)
    expect(meta.tokensAfter).toBeNull()
    expect(meta.trigger).toBe('auto')
  })

  it('sets trigger=manual when fromHook=false', () => {
    const row = parseCheckpoint(
      'main',
      SESSION_ID,
      CHECKPOINT_ID,
      FILENAME,
      body([sessionHeader(), compaction({ fromHook: false })]),
      PATH,
      0,
    )!
    expect((JSON.parse(row.meta) as Record<string, unknown>).trigger).toBe('manual')
  })

  it('sets trigger=unknown when fromHook is absent', () => {
    const compactionNoHook = line({
      type: 'compaction',
      id: 'cmp-1',
      timestamp: '2026-04-15T23:23:17.558Z',
      summary: 's',
      tokensBefore: 1,
    })
    const row = parseCheckpoint(
      'main', SESSION_ID, CHECKPOINT_ID, FILENAME,
      body([sessionHeader(), compactionNoHook]),
      PATH, 0,
    )!
    expect((JSON.parse(row.meta) as Record<string, unknown>).trigger).toBe('unknown')
  })

  it('parses timestamp into createdAt (ISO → ms)', () => {
    const row = parseCheckpoint(
      'main', SESSION_ID, CHECKPOINT_ID, FILENAME,
      body([sessionHeader(), compaction({ timestamp: '2026-04-15T23:23:17.558Z' })]),
      PATH, 999,
    )!
    const expected = Date.parse('2026-04-15T23:23:17.558Z')
    const meta = JSON.parse(row.meta) as Record<string, unknown>
    expect(meta.createdAt).toBe(expected)
    expect(row.createdAt).toBe(expected)
  })

  it('title contains both session id short form and checkpoint id short form', () => {
    const row = parseCheckpoint(
      'main', SESSION_ID, CHECKPOINT_ID, FILENAME,
      body([sessionHeader(), compaction()]),
      PATH, 0,
    )!
    expect(row.title).toContain(SESSION_ID.slice(0, 8))
    expect(row.title).toContain(CHECKPOINT_ID.slice(0, 8))
  })

  it('sourceRef includes checkpointId + sessionId for UI back-links', () => {
    const row = parseCheckpoint(
      'main', SESSION_ID, CHECKPOINT_ID, FILENAME,
      body([sessionHeader(), compaction()]),
      PATH, 0,
    )!
    expect(row.sourceRef.sessionId).toBe(SESSION_ID)
    expect(row.sourceRef.checkpointId).toBe(CHECKPOINT_ID)
    expect(row.sourceRef.path).toBe(PATH)
    expect(row.sourceRef.file).toBe(FILENAME)
  })
})

describe('parseCheckpoint — edge cases', () => {
  it('returns null when no compaction event is present', () => {
    const row = parseCheckpoint(
      'main', SESSION_ID, CHECKPOINT_ID, FILENAME,
      body([sessionHeader(), line({ type: 'message', id: 'm1', message: { role: 'user', content: [] } })]),
      PATH, 0,
    )
    expect(row).toBeNull()
  })

  it('ignores malformed JSON lines and finds a later compaction', () => {
    const row = parseCheckpoint(
      'main', SESSION_ID, CHECKPOINT_ID, FILENAME,
      body(['{not json', sessionHeader(), compaction()]),
      PATH, 0,
    )
    expect(row).not.toBeNull()
  })

  it('first compaction wins when multiple are present', () => {
    const row = parseCheckpoint(
      'main', SESSION_ID, CHECKPOINT_ID, FILENAME,
      body([
        sessionHeader(),
        compaction({ summary: 'first' }),
        compaction({ summary: 'second', tokensBefore: 99999 }),
      ]),
      PATH, 0,
    )!
    expect(row.content).toBe('first')
    expect((JSON.parse(row.meta) as Record<string, unknown>).tokensBefore).not.toBe(99999)
  })

  it('returns null for an empty body', () => {
    expect(parseCheckpoint('main', SESSION_ID, CHECKPOINT_ID, FILENAME, '', PATH, 0)).toBeNull()
  })
})

describe('rowId', () => {
  it('is stable for the same (agent, sessionId, checkpointId)', () => {
    expect(rowId('main', SESSION_ID, CHECKPOINT_ID)).toBe(rowId('main', SESSION_ID, CHECKPOINT_ID))
  })
  it('differs across agent / session / checkpoint', () => {
    const base = rowId('main', SESSION_ID, CHECKPOINT_ID)
    expect(rowId('other', SESSION_ID, CHECKPOINT_ID)).not.toBe(base)
    expect(rowId('main', 'sid-2', CHECKPOINT_ID)).not.toBe(base)
    expect(rowId('main', SESSION_ID, 'cp-2')).not.toBe(base)
  })
  it('is prefixed with "checkpoint:"', () => {
    expect(rowId('main', SESSION_ID, CHECKPOINT_ID)).toMatch(/^checkpoint:[a-f0-9]{16}$/)
  })
})
