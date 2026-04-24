/**
 * Tests for plugins/memory/lib/tier-parsers/dream-parser.ts.
 *
 * Five artifact types (DreamArtifactTypeSchema):
 *   phase_doc          — workspace/memory/dreaming/<phase>/<YYYY-MM-DD>.md
 *   short_term_recall  — workspace/memory/.dreams/short-term-recall.json
 *   phase_signals      — workspace/memory/.dreams/phase-signals.json
 *   events_log         — workspace/memory/.dreams/events.jsonl
 *   session_corpus     — workspace/memory/.dreams/session-corpus/<YYYY-MM-DD>.{md,txt}
 *
 * Empty files are a common state ("dreaming is dormant") — the parser still
 * emits a row so the UI can surface the friendly empty-state copy instead of
 * a mysterious absence.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-dream-parser-${Date.now()}`)

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
  parsePhaseDoc,
  parseDreamSignal,
  classifyDreamSignal,
  rowId,
} from '../../../../plugins/memory/lib/tier-parsers/dream-parser'

const MTIME = 1_700_000_000_000

describe('classifyDreamSignal', () => {
  it('classifies short-term-recall.json', () => {
    expect(classifyDreamSignal('short-term-recall.json')).toEqual({
      artifactType: 'short_term_recall',
      date: null,
    })
  })
  it('classifies phase-signals.json', () => {
    expect(classifyDreamSignal('phase-signals.json')).toEqual({
      artifactType: 'phase_signals',
      date: null,
    })
  })
  it('classifies events.jsonl', () => {
    expect(classifyDreamSignal('events.jsonl')).toEqual({
      artifactType: 'events_log',
      date: null,
    })
  })
  it('classifies session-corpus/<date>.md with date', () => {
    expect(classifyDreamSignal('session-corpus/2026-04-17.md')).toEqual({
      artifactType: 'session_corpus',
      date: '2026-04-17',
    })
  })
  it('classifies session-corpus/<date>.txt with date', () => {
    expect(classifyDreamSignal('session-corpus/2026-01-01.txt')).toEqual({
      artifactType: 'session_corpus',
      date: '2026-01-01',
    })
  })
  it('rejects unrelated filenames', () => {
    expect(classifyDreamSignal('readme.md')).toBeNull()
    expect(classifyDreamSignal('random.json')).toBeNull()
    expect(classifyDreamSignal('session-corpus/not-a-date.md')).toBeNull()
  })
})

describe('parsePhaseDoc', () => {
  it('returns a row for a dated phase markdown file', () => {
    const row = parsePhaseDoc(
      'main',
      'light',
      '2026-04-17.md',
      '## Impressions\nSomething.',
      '/fake/path/2026-04-17.md',
      MTIME,
    )
    expect(row).not.toBeNull()
    expect(row!.tier).toBe('dream')
    expect(row!.agent).toBe('main')
    const meta = JSON.parse(row!.meta) as Record<string, unknown>
    expect(meta.artifactType).toBe('phase_doc')
    expect(meta.phase).toBe('light')
    expect(meta.date).toBe('2026-04-17')
    expect(meta.sourceDay).toBe('2026-04-17')
    expect(row!.content).toContain('Impressions')
    expect(row!.sourceRef.file).toBe('2026-04-17.md')
  })

  it('rejects a phase doc whose filename is not a YYYY-MM-DD', () => {
    const row = parsePhaseDoc('main', 'rem', 'notes.md', '# notes', '/fake/notes.md', MTIME)
    expect(row).toBeNull()
  })

  it('row id is dream:<sha> and stable for same inputs', () => {
    const a = rowId('main', 'phase_doc', 'light|2026-04-17')
    const b = rowId('main', 'phase_doc', 'light|2026-04-17')
    expect(a).toBe(b)
    expect(a).toMatch(/^dream:[a-f0-9]{16}$/)
  })
})

describe('parseDreamSignal — structured JSON files', () => {
  it('parses short-term-recall.json (non-empty) with content body', () => {
    const body = JSON.stringify({
      recalls: [
        { id: 'r1', query: 'how did we ship?', score: 0.9 },
      ],
    })
    const row = parseDreamSignal(
      'main',
      'short-term-recall.json',
      body,
      '/fake/.dreams/short-term-recall.json',
      MTIME,
    )
    expect(row).not.toBeNull()
    const meta = JSON.parse(row!.meta) as Record<string, unknown>
    expect(meta.artifactType).toBe('short_term_recall')
    expect(meta.phase).toBeNull()
    expect(meta.date).toBeNull()
    expect(row!.content).toContain('recalls')
  })

  it('parses an empty short-term-recall.json as the dormant state (row with empty content)', () => {
    const row = parseDreamSignal(
      'main',
      'short-term-recall.json',
      '',
      '/fake/.dreams/short-term-recall.json',
      MTIME,
    )
    expect(row).not.toBeNull()
    const meta = JSON.parse(row!.meta) as Record<string, unknown>
    expect(meta.artifactType).toBe('short_term_recall')
    expect(row!.content).toBe('')
    expect(row!.snippet).toBe('')
  })

  it('parses phase-signals.json', () => {
    const body = JSON.stringify({ light: { ratio: 0.4 }, rem: { ratio: 0.1 } })
    const row = parseDreamSignal(
      'main',
      'phase-signals.json',
      body,
      '/fake/.dreams/phase-signals.json',
      MTIME,
    )!
    expect((JSON.parse(row.meta) as Record<string, unknown>).artifactType).toBe('phase_signals')
  })

  it('parses events.jsonl (treats whole file as one row, content untouched)', () => {
    const body = JSON.stringify({ ts: 1, kind: 'phase_enter' }) + '\n' +
      JSON.stringify({ ts: 2, kind: 'phase_exit' }) + '\n'
    const row = parseDreamSignal(
      'main',
      'events.jsonl',
      body,
      '/fake/.dreams/events.jsonl',
      MTIME,
    )!
    expect((JSON.parse(row.meta) as Record<string, unknown>).artifactType).toBe('events_log')
    expect(row.content).toBe(body)
  })
})

describe('parseDreamSignal — session_corpus', () => {
  it('parses a session-corpus/<date>.md file', () => {
    const row = parseDreamSignal(
      'main',
      'session-corpus/2026-04-17.md',
      '# Session\nsome text',
      '/fake/.dreams/session-corpus/2026-04-17.md',
      MTIME,
    )!
    const meta = JSON.parse(row.meta) as Record<string, unknown>
    expect(meta.artifactType).toBe('session_corpus')
    expect(meta.date).toBe('2026-04-17')
    expect(meta.sourceDay).toBe('2026-04-17')
    expect(row.content).toContain('# Session')
  })

  it('rejects a session-corpus file with no date in its name', () => {
    const row = parseDreamSignal(
      'main',
      'session-corpus/notes.md',
      'body',
      '/fake/.dreams/session-corpus/notes.md',
      MTIME,
    )
    expect(row).toBeNull()
  })

  it('rejects an unknown top-level file', () => {
    const row = parseDreamSignal(
      'main',
      'other.txt',
      'body',
      '/fake/.dreams/other.txt',
      MTIME,
    )
    expect(row).toBeNull()
  })
})

describe('rowId', () => {
  it('differs across agent / artifactType / key', () => {
    const base = rowId('main', 'phase_doc', 'light|2026-04-17')
    expect(rowId('other', 'phase_doc', 'light|2026-04-17')).not.toBe(base)
    expect(rowId('main', 'short_term_recall', 'light|2026-04-17')).not.toBe(base)
    expect(rowId('main', 'phase_doc', 'rem|2026-04-17')).not.toBe(base)
  })
})
