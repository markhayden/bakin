/**
 * Tests for plugins/memory/lib/openclaw-adapter.ts — filesystem reads of
 * ~/.openclaw/ memory paths. The adapter is the sole module allowed to
 * hardcode OpenClaw paths (via getOpenClawPath).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-adapter-${Date.now()}`)
const openclawDir = join(testDir, 'openclaw')

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
vi.mock('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
vi.mock('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => openclawDir,
  getOpenClawPath: (...parts: string[]) => join(openclawDir, ...parts),
}))
vi.mock('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
}))
vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import {
  listAgentIds,
  readSessionStore,
  readTranscript,
  listCheckpoints,
  readCheckpoint,
  listCheckpointJsonlFiles,
  checkpointJsonlPath,
  checkpointJsonlStat,
  matchCheckpointJsonlPath,
  listDailyNotes,
  readDailyNote,
  listDreamArtifacts,
  readDreamArtifact,
  readDurableFile,
  CANONICAL_DURABLE_FILES,
} from '../../../plugins/memory/lib/openclaw-adapter'

function seedAgent(agentId: string): void {
  mkdirSync(join(openclawDir, 'agents', agentId, 'sessions'), { recursive: true })
}

function writeFile(rel: string, content: string): void {
  const full = join(openclawDir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content, 'utf-8')
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(openclawDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── listAgentIds ────────────────────────────────────────────────────────────

describe('listAgentIds', () => {
  it('returns [] when agents dir is missing', () => {
    expect(listAgentIds()).toEqual([])
  })

  it('lists directory entries under agents/', () => {
    seedAgent('main')
    seedAgent('pixel')
    expect(listAgentIds().sort()).toEqual(['main', 'pixel'])
  })

  it('skips non-directory entries', () => {
    seedAgent('main')
    writeFileSync(join(openclawDir, 'agents', 'stray.txt'), 'x', 'utf-8')
    expect(listAgentIds()).toEqual(['main'])
  })
})

// ─── readSessionStore ────────────────────────────────────────────────────────

describe('readSessionStore', () => {
  it('returns null when sessions.json is missing', () => {
    seedAgent('main')
    expect(readSessionStore('main')).toBeNull()
  })

  it('returns parsed JSON when present', () => {
    seedAgent('main')
    writeFile('agents/main/sessions/sessions.json', JSON.stringify({ foo: 'bar' }))
    expect(readSessionStore('main')).toEqual({ foo: 'bar' })
  })

  it('returns null on malformed JSON', () => {
    seedAgent('main')
    writeFile('agents/main/sessions/sessions.json', '{ not json')
    expect(readSessionStore('main')).toBeNull()
  })
})

// ─── readTranscript ──────────────────────────────────────────────────────────

describe('readTranscript', () => {
  it('returns an empty iterator when the file is missing', async () => {
    seedAgent('main')
    const lines: string[] = []
    for await (const line of readTranscript('main', 'missing')) lines.push(line)
    expect(lines).toEqual([])
  })

  it('streams lines from an existing JSONL', async () => {
    seedAgent('main')
    writeFile(
      'agents/main/sessions/sess-1.jsonl',
      '{"type":"session"}\n{"type":"message","text":"hi"}\n'
    )
    const lines: string[] = []
    for await (const line of readTranscript('main', 'sess-1')) lines.push(line)
    expect(lines).toEqual(['{"type":"session"}', '{"type":"message","text":"hi"}'])
  })

  it('streams starting from a byte offset', async () => {
    seedAgent('main')
    const first = '{"type":"session"}\n'
    const second = '{"type":"message"}\n'
    writeFile('agents/main/sessions/sess-1.jsonl', first + second)
    const lines: string[] = []
    for await (const line of readTranscript('main', 'sess-1', { offset: first.length })) {
      lines.push(line)
    }
    expect(lines).toEqual(['{"type":"message"}'])
  })
})

// ─── listCheckpoints ─────────────────────────────────────────────────────────

describe('listCheckpoints', () => {
  it('returns [] when sessions dir is missing', () => {
    expect(listCheckpoints('main')).toEqual([])
  })

  it('lists only *.checkpoint.*.jsonl files', () => {
    seedAgent('main')
    writeFile('agents/main/sessions/sess-1.jsonl', '')
    writeFile('agents/main/sessions/sess-1.checkpoint.cp-a.jsonl', '')
    writeFile('agents/main/sessions/sess-1.checkpoint.cp-b.jsonl', '')
    writeFile('agents/main/sessions/sess-1.reset.2026-04-17.jsonl', '')
    const files = listCheckpoints('main').sort()
    expect(files).toEqual([
      'sess-1.checkpoint.cp-a.jsonl',
      'sess-1.checkpoint.cp-b.jsonl',
    ])
  })

  it('filters by sessionId when provided', () => {
    seedAgent('main')
    writeFile('agents/main/sessions/sess-1.checkpoint.cp-a.jsonl', '')
    writeFile('agents/main/sessions/sess-2.checkpoint.cp-b.jsonl', '')
    expect(listCheckpoints('main', 'sess-1')).toEqual([
      'sess-1.checkpoint.cp-a.jsonl',
    ])
  })
})

describe('readCheckpoint', () => {
  it('returns null when file missing', () => {
    expect(readCheckpoint('main', 'no.checkpoint.x.jsonl')).toBeNull()
  })

  it('returns file contents when present', () => {
    seedAgent('main')
    writeFile('agents/main/sessions/sess-1.checkpoint.cp-a.jsonl', 'line1\nline2')
    expect(readCheckpoint('main', 'sess-1.checkpoint.cp-a.jsonl')).toBe('line1\nline2')
  })
})

// ─── listCheckpointJsonlFiles / path / stat / match ──────────────────────────

describe('listCheckpointJsonlFiles', () => {
  it('returns [] when sessions dir is missing', () => {
    expect(listCheckpointJsonlFiles('main')).toEqual([])
  })

  it('enumerates checkpoint files with parsed ids + size + mtime', () => {
    seedAgent('main')
    writeFile('agents/main/sessions/sess-1.jsonl', 'x')
    writeFile('agents/main/sessions/sess-1.checkpoint.cp-a.jsonl', 'abc')
    writeFile('agents/main/sessions/sess-2.checkpoint.cp-b.jsonl', 'de')
    const files = listCheckpointJsonlFiles('main').sort((a, b) => a.filename.localeCompare(b.filename))
    expect(files).toHaveLength(2)
    expect(files[0].sessionId).toBe('sess-1')
    expect(files[0].checkpointId).toBe('cp-a')
    expect(files[0].size).toBe(3)
    expect(files[0].path.endsWith('sess-1.checkpoint.cp-a.jsonl')).toBe(true)
    expect(typeof files[0].mtimeMs).toBe('number')
    expect(files[1].sessionId).toBe('sess-2')
  })
})

describe('checkpointJsonlPath + checkpointJsonlStat', () => {
  it('joins the agent sessions dir with the filename', () => {
    const p = checkpointJsonlPath('main', 'sess-1.checkpoint.cp-a.jsonl')
    expect(p.endsWith('agents/main/sessions/sess-1.checkpoint.cp-a.jsonl')).toBe(true)
  })

  it('returns null for a missing file, stat for a present one', () => {
    expect(checkpointJsonlStat('/does/not/exist.jsonl')).toBeNull()
    seedAgent('main')
    writeFile('agents/main/sessions/sess-1.checkpoint.cp-a.jsonl', 'hi')
    const p = checkpointJsonlPath('main', 'sess-1.checkpoint.cp-a.jsonl')
    const st = checkpointJsonlStat(p)
    expect(st).not.toBeNull()
    expect(st!.size).toBe(2)
  })
})

describe('matchCheckpointJsonlPath', () => {
  it('returns null for unrelated paths', () => {
    seedAgent('main')
    expect(matchCheckpointJsonlPath('/not/under/openclaw.jsonl')).toBeNull()
  })

  it('returns {agent, sessionId, checkpointId, filename} for a valid checkpoint path', () => {
    seedAgent('main')
    const p = checkpointJsonlPath('main', 'sess-1.checkpoint.cp-a.jsonl')
    expect(matchCheckpointJsonlPath(p)).toEqual({
      agent: 'main',
      sessionId: 'sess-1',
      checkpointId: 'cp-a',
      filename: 'sess-1.checkpoint.cp-a.jsonl',
    })
  })

  it('rejects plain session jsonl (non-checkpoint) paths', () => {
    seedAgent('main')
    const p = join(openclawDir, 'agents', 'main', 'sessions', 'sess-1.jsonl')
    expect(matchCheckpointJsonlPath(p)).toBeNull()
  })
})

// ─── listDailyNotes ──────────────────────────────────────────────────────────

describe('listDailyNotes', () => {
  it('returns [] when memory dir is missing', () => {
    expect(listDailyNotes('main')).toEqual([])
  })

  it('lists *.md files sorted desc', () => {
    writeFile('workspace/memory/2026-04-15.md', '')
    writeFile('workspace/memory/2026-04-17.md', '')
    writeFile('workspace/memory/2026-04-16.md', '')
    writeFile('workspace/memory/not-a-note.txt', '')
    expect(listDailyNotes('main')).toEqual([
      '2026-04-17.md',
      '2026-04-16.md',
      '2026-04-15.md',
    ])
  })

  it('reads subagent memory from workspaces/<id>/memory', () => {
    writeFile('workspaces/pixel/memory/2026-04-17.md', '')
    expect(listDailyNotes('pixel')).toEqual(['2026-04-17.md'])
  })
})

describe('readDailyNote', () => {
  it('returns content when present', () => {
    writeFile('workspace/memory/2026-04-17.md', '# today\n')
    expect(readDailyNote('main', '2026-04-17.md')).toBe('# today\n')
  })

  it('returns null when missing', () => {
    expect(readDailyNote('main', 'missing.md')).toBeNull()
  })

  it('blocks path traversal', () => {
    expect(readDailyNote('main', '../SOUL.md')).toBeNull()
    expect(readDailyNote('main', 'sub/x.md')).toBeNull()
  })
})

// ─── Dream artifacts ─────────────────────────────────────────────────────────

describe('listDreamArtifacts', () => {
  it('returns empty shape when dream dirs are missing', () => {
    const out = listDreamArtifacts('main')
    expect(out).toEqual({ phaseDocs: [], signals: [] })
  })

  it('lists phase docs under dreaming/<phase>/*.md', () => {
    writeFile('workspace/memory/dreaming/light/2026-04-17.md', '')
    writeFile('workspace/memory/dreaming/rem/2026-04-16.md', '')
    const out = listDreamArtifacts('main')
    expect(out.phaseDocs.sort((a, b) => a.phase.localeCompare(b.phase))).toEqual([
      { phase: 'light', file: '2026-04-17.md' },
      { phase: 'rem', file: '2026-04-16.md' },
    ])
  })

  it('lists signal files under .dreams/', () => {
    writeFile('workspace/memory/.dreams/short-term-recall.json', '{}')
    writeFile('workspace/memory/.dreams/phase-signals.json', '{}')
    const out = listDreamArtifacts('main')
    expect(out.signals.sort()).toEqual(['phase-signals.json', 'short-term-recall.json'])
  })
})

describe('readDreamArtifact', () => {
  it('returns phase doc contents', () => {
    writeFile('workspace/memory/dreaming/light/2026-04-17.md', '# dream')
    expect(readDreamArtifact('main', 'phase_doc', 'light/2026-04-17.md')).toBe('# dream')
  })

  it('returns signal file contents', () => {
    writeFile('workspace/memory/.dreams/short-term-recall.json', '{"recalls":[]}')
    expect(readDreamArtifact('main', 'signal', 'short-term-recall.json')).toBe('{"recalls":[]}')
  })

  it('returns null on missing file', () => {
    expect(readDreamArtifact('main', 'phase_doc', 'light/nope.md')).toBeNull()
  })

  it('blocks path traversal', () => {
    expect(readDreamArtifact('main', 'signal', '../../../etc/passwd')).toBeNull()
  })
})

// ─── Durable files ───────────────────────────────────────────────────────────

describe('readDurableFile', () => {
  it('returns content for a canonical file', () => {
    writeFile('workspace/SOUL.md', '# soul')
    expect(readDurableFile('main', 'SOUL.md')).toBe('# soul')
  })

  it('returns null for a non-canonical basename', () => {
    writeFile('workspace/RANDOM.md', 'x')
    expect(readDurableFile('main', 'RANDOM.md')).toBeNull()
  })

  it('blocks path traversal even for canonical names', () => {
    expect(readDurableFile('main', '../SOUL.md')).toBeNull()
  })

  it('exposes the canonical file list', () => {
    expect(CANONICAL_DURABLE_FILES).toContain('SOUL.md')
    expect(CANONICAL_DURABLE_FILES).toContain('MEMORY.md')
    expect(CANONICAL_DURABLE_FILES).toContain('USER.md')
  })
})
