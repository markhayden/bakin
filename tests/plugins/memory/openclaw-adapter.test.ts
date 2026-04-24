/**
 * Tests for plugins/memory/lib/openclaw-adapter.ts — filesystem reads of
 * ~/.openclaw/ memory paths. The adapter is the sole module allowed to
 * hardcode OpenClaw paths (via getOpenClawPath).
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-adapter-${Date.now()}`)
const openclawDir = join(testDir, 'openclaw')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => openclawDir,
  getOpenClawPath: (...parts: string[]) => join(openclawDir, ...parts),
}))
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
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
  listPhaseDocs,
  listDreamSignalFiles,
  readPhaseDoc,
  readDreamSignal,
  matchPhaseDocPath,
  matchDreamSignalPath,
  readDurableFile,
  CANONICAL_DURABLE_FILES,
  DURABLE_KIND_BY_BASENAME,
  durableKindForBasename,
  listAgentSkills,
  readAgentSkill,
  skillFilePath,
  matchSkillPath,
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
  // Seed openclaw.json so the real `tryGetMainAgentId()` returns 'main'
  // even when mock.module('@bakin/core/main-agent') isn't honored by the
  // runtime (bun 1.2.0 on CI vs 1.3.x locally). Belt-and-suspenders.
  writeFileSync(
    join(openclawDir, 'openclaw.json'),
    JSON.stringify({ agents: { list: [{ id: 'main', identity: { name: 'Main' } }] } }),
    'utf-8',
  )
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

// ─── Dream v2 helpers (listPhaseDocs / listDreamSignalFiles / readers / match) ──

describe('listPhaseDocs', () => {
  it('returns [] when dreaming dir is missing', () => {
    seedAgent('main')
    expect(listPhaseDocs('main')).toEqual([])
  })

  it('enumerates <phase>/<date>.md files across phases', () => {
    seedAgent('main')
    writeFile('workspace/memory/dreaming/light/2026-04-17.md', '# a')
    writeFile('workspace/memory/dreaming/rem/2026-04-16.md', '# b')
    writeFile('workspace/memory/dreaming/rem/notes.txt', 'not markdown')
    const entries = listPhaseDocs('main').map((e) => `${e.phase}/${e.filename}`).sort()
    expect(entries).toEqual(['light/2026-04-17.md', 'rem/2026-04-16.md'])
  })
})

describe('listDreamSignalFiles', () => {
  it('returns [] when .dreams dir is missing', () => {
    seedAgent('main')
    expect(listDreamSignalFiles('main')).toEqual([])
  })

  it('lists flat files and session-corpus/* entries', () => {
    seedAgent('main')
    writeFile('workspace/memory/.dreams/short-term-recall.json', '{}')
    writeFile('workspace/memory/.dreams/phase-signals.json', '{}')
    writeFile('workspace/memory/.dreams/events.jsonl', '')
    writeFile('workspace/memory/.dreams/session-corpus/2026-04-17.md', '# x')
    const paths = listDreamSignalFiles('main').map((e) => e.relPath).sort()
    expect(paths).toEqual([
      'events.jsonl',
      'phase-signals.json',
      'session-corpus/2026-04-17.md',
      'short-term-recall.json',
    ])
  })
})

describe('readPhaseDoc / readDreamSignal', () => {
  it('reads phase doc body', () => {
    writeFile('workspace/memory/dreaming/light/2026-04-17.md', '# dream')
    expect(readPhaseDoc('main', 'light', '2026-04-17.md')).toBe('# dream')
  })

  it('rejects unsafe phase / filename', () => {
    expect(readPhaseDoc('main', '..', 'x.md')).toBeNull()
    expect(readPhaseDoc('main', 'light', '../x.md')).toBeNull()
    expect(readPhaseDoc('main', 'light', 'notmd.json')).toBeNull()
  })

  it('reads flat signal body and session-corpus body', () => {
    writeFile('workspace/memory/.dreams/short-term-recall.json', '{"r":[]}')
    writeFile('workspace/memory/.dreams/session-corpus/2026-04-17.md', '# body')
    expect(readDreamSignal('main', 'short-term-recall.json')).toBe('{"r":[]}')
    expect(readDreamSignal('main', 'session-corpus/2026-04-17.md')).toBe('# body')
  })

  it('blocks traversal on dream signal reads', () => {
    expect(readDreamSignal('main', '../../etc/passwd')).toBeNull()
  })
})

describe('matchPhaseDocPath', () => {
  it('matches <agent>/memory/dreaming/<phase>/<date>.md for the main agent (collapsed workspace)', () => {
    const p = join(openclawDir, 'workspace', 'memory', 'dreaming', 'light', '2026-04-17.md')
    expect(matchPhaseDocPath(p)).toEqual({ agent: 'main', phase: 'light', filename: '2026-04-17.md' })
  })

  it('rejects unrelated paths', () => {
    expect(matchPhaseDocPath('/nope/x.md')).toBeNull()
  })
})

describe('matchDreamSignalPath', () => {
  it('matches .dreams/<file> under the main-agent workspace', () => {
    const p = join(openclawDir, 'workspace', 'memory', '.dreams', 'short-term-recall.json')
    expect(matchDreamSignalPath(p)).toEqual({ agent: 'main', relPath: 'short-term-recall.json' })
  })

  it('matches .dreams/session-corpus/<file>', () => {
    const p = join(openclawDir, 'workspace', 'memory', '.dreams', 'session-corpus', '2026-04-17.md')
    expect(matchDreamSignalPath(p)).toEqual({ agent: 'main', relPath: 'session-corpus/2026-04-17.md' })
  })

  it('rejects unrelated paths', () => {
    expect(matchDreamSignalPath('/nope/x.json')).toBeNull()
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

describe('listAgentSkills', () => {
  it('returns [] when skills/ dir is missing', () => {
    seedAgent('main')
    expect(listAgentSkills('main')).toEqual([])
  })

  it('returns [] when skills/<name>/ exists but SKILL.md is missing', () => {
    seedAgent('main')
    mkdirSync(join(openclawDir, 'workspace', 'skills', 'research'), { recursive: true })
    expect(listAgentSkills('main')).toEqual([])
  })

  it('lists each skill with name, absolute path, and mtime', () => {
    seedAgent('main')
    writeFile('workspace/skills/research/SKILL.md', '# Research')
    writeFile('workspace/skills/summarize/SKILL.md', '# Summarize')
    const skills = listAgentSkills('main').map((s) => s.skillName).sort()
    expect(skills).toEqual(['research', 'summarize'])
    const one = listAgentSkills('main').find((s) => s.skillName === 'research')!
    expect(one.path).toBe(join(openclawDir, 'workspace', 'skills', 'research', 'SKILL.md'))
    expect(typeof one.mtimeMs).toBe('number')
  })

  it('ignores non-directory entries under skills/', () => {
    seedAgent('main')
    mkdirSync(join(openclawDir, 'workspace', 'skills'), { recursive: true })
    writeFileSync(join(openclawDir, 'workspace', 'skills', 'stray.txt'), 'x', 'utf-8')
    expect(listAgentSkills('main')).toEqual([])
  })

  it('walks the per-agent workspace for non-main agents', () => {
    seedAgent('pixel')
    writeFile('workspaces/pixel/skills/editor/SKILL.md', '# Editor')
    const skills = listAgentSkills('pixel')
    expect(skills.map((s) => s.skillName)).toEqual(['editor'])
  })
})

describe('readAgentSkill', () => {
  it('returns content for an existing skill', () => {
    writeFile('workspace/skills/research/SKILL.md', '# research body')
    expect(readAgentSkill('main', 'research')).toBe('# research body')
  })

  it('returns null for a missing skill', () => {
    expect(readAgentSkill('main', 'nope')).toBeNull()
  })

  it('blocks path traversal via `..` in the skill name', () => {
    writeFile('workspace/SOUL.md', '# soul')
    expect(readAgentSkill('main', '../')).toBeNull()
    expect(readAgentSkill('main', '../../etc/passwd')).toBeNull()
  })

  it('blocks absolute-path skill names', () => {
    expect(readAgentSkill('main', '/etc/passwd')).toBeNull()
  })

  it('blocks backslash-separated skill names', () => {
    expect(readAgentSkill('main', 'foo\\bar')).toBeNull()
  })
})

describe('matchSkillPath', () => {
  it('returns null for paths outside any workspace', () => {
    expect(matchSkillPath('/not/under/openclaw/SKILL.md')).toBeNull()
  })

  it('returns null for a workspace file that is not a skill', () => {
    seedAgent('main')
    const p = join(openclawDir, 'workspace', 'SOUL.md')
    expect(matchSkillPath(p)).toBeNull()
  })

  it('returns null for nested files under a skill directory', () => {
    seedAgent('main')
    const p = join(openclawDir, 'workspace', 'skills', 'research', 'notes', 'README.md')
    expect(matchSkillPath(p)).toBeNull()
  })

  it('returns null for non-SKILL.md files inside a skill dir', () => {
    seedAgent('main')
    const p = join(openclawDir, 'workspace', 'skills', 'research', 'other.md')
    expect(matchSkillPath(p)).toBeNull()
  })

  it('matches main-agent layout (workspace/skills/<name>/SKILL.md)', () => {
    seedAgent('main')
    const p = skillFilePath('main', 'research')
    expect(matchSkillPath(p)).toEqual({ agent: 'main', skillName: 'research' })
  })

  it('matches per-agent layout (workspaces/<id>/skills/<name>/SKILL.md)', () => {
    seedAgent('pixel')
    const p = skillFilePath('pixel', 'editor')
    expect(matchSkillPath(p)).toEqual({ agent: 'pixel', skillName: 'editor' })
  })

  it('rejects unsafe skill names embedded in the path', () => {
    seedAgent('main')
    // Craft a path that structurally looks like a skill file but whose
    // skill-name segment is unsafe. The matcher must refuse it.
    const p = join(openclawDir, 'workspace', 'skills', '..', 'SKILL.md')
    expect(matchSkillPath(p)).toBeNull()
  })
})

describe('durableKindForBasename', () => {
  it('maps canonical basenames to their kind', () => {
    expect(durableKindForBasename('SOUL.md')).toBe('soul')
    expect(durableKindForBasename('AGENTS.md')).toBe('rules')
    expect(durableKindForBasename('TOOLS.md')).toBe('tools')
    expect(durableKindForBasename('IDENTITY.md')).toBe('identity')
    expect(durableKindForBasename('HEARTBEAT.md')).toBe('heartbeat')
    expect(durableKindForBasename('MEMORY.md')).toBe('memory')
    expect(durableKindForBasename('MEMORY-LOG.md')).toBe('memory-log')
    expect(durableKindForBasename('DREAMS.md')).toBe('dreams')
    expect(durableKindForBasename('USER.md')).toBe('user')
    expect(durableKindForBasename('BOOTSTRAP.md')).toBe('bootstrap')
  })

  it('returns undefined for unknown basenames', () => {
    expect(durableKindForBasename('RANDOM.md')).toBeUndefined()
    expect(durableKindForBasename('soul.md')).toBeUndefined() // case-sensitive
  })

  it('covers every canonical durable file', () => {
    for (const basename of CANONICAL_DURABLE_FILES) {
      expect(DURABLE_KIND_BY_BASENAME[basename]).toBeDefined()
    }
  })
})
