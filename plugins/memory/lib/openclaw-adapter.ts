/**
 * OpenClaw filesystem adapter for the memory plugin.
 *
 * This is the SOLE module permitted to reference ~/.openclaw/ paths for the
 * memory plugin. Every filesystem read for session transcripts, checkpoints,
 * daily notes, dream artifacts, and durable files goes through here.
 *
 * Bakin reads from OpenClaw. Bakin never writes to OpenClaw here.
 */
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { createInterface } from 'readline'
import { join } from 'path'
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import { tryGetMainAgentId } from '@bakin/core/main-agent'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('memory:adapter')

// ─── Path resolution ─────────────────────────────────────────────────────────

function agentsDir(): string {
  return getOpenClawPath('agents')
}

function agentSessionsDir(agentId: string): string {
  return getOpenClawPath('agents', agentId, 'sessions')
}

function workspacePath(agentId: string): string {
  if (agentId === tryGetMainAgentId()) {
    return getOpenClawPath('workspace')
  }
  return getOpenClawPath('workspaces', agentId)
}

function isSafeFilename(name: string): boolean {
  return !name.includes('..') && !name.startsWith('/') && !name.includes('\\')
}

function isSafeRelPath(rel: string): boolean {
  // Allows a single subdirectory (e.g. "light/2026-04-17.md") but blocks
  // parent traversal and absolute paths.
  return !rel.includes('..') && !rel.startsWith('/') && !rel.includes('\\')
}

// ─── Agent roster ────────────────────────────────────────────────────────────

export function listAgentIds(): string[] {
  const dir = agentsDir()
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch (err) {
    log.warn('listAgentIds failed', { err: err instanceof Error ? err.message : String(err) })
    return []
  }
}

// ─── Session store ───────────────────────────────────────────────────────────

export function readSessionStore(agentId: string): unknown {
  const file = join(agentSessionsDir(agentId), 'sessions.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch (err) {
    log.warn('readSessionStore failed', { agentId, err: err instanceof Error ? err.message : String(err) })
    return null
  }
}

// ─── Transcript streaming ────────────────────────────────────────────────────

export interface ReadTranscriptOptions {
  offset?: number
}

export async function* readTranscript(
  agentId: string,
  sessionId: string,
  opts: ReadTranscriptOptions = {}
): AsyncGenerator<string> {
  const file = join(agentSessionsDir(agentId), `${sessionId}.jsonl`)
  if (!existsSync(file)) return

  const start = opts.offset ?? 0
  const size = statSync(file).size
  if (start >= size) return

  const stream = createReadStream(file, { encoding: 'utf-8', start })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    if (line.length === 0) continue
    yield line
  }
}

// ─── Checkpoints ─────────────────────────────────────────────────────────────

const CHECKPOINT_RE = /^([^/]+)\.checkpoint\.[^/]+\.jsonl$/

export function listCheckpoints(agentId: string, sessionId?: string): string[] {
  const dir = agentSessionsDir(agentId)
  if (!existsSync(dir)) return []
  try {
    const files: string[] = []
    for (const name of readdirSync(dir)) {
      const match = name.match(CHECKPOINT_RE)
      if (!match) continue
      if (sessionId && match[1] !== sessionId) continue
      files.push(name)
    }
    return files
  } catch (err) {
    log.warn('listCheckpoints failed', { agentId, err: err instanceof Error ? err.message : String(err) })
    return []
  }
}

export function readCheckpoint(agentId: string, filename: string): string | null {
  if (!isSafeFilename(filename) || !CHECKPOINT_RE.test(filename)) return null
  const file = join(agentSessionsDir(agentId), filename)
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

// ─── Daily notes ─────────────────────────────────────────────────────────────

function dailyNotesDir(agentId: string): string {
  return join(workspacePath(agentId), 'memory')
}

export function listDailyNotes(agentId: string): string[] {
  const dir = dailyNotesDir(agentId)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.md'))
      .map((d) => d.name)
      .sort()
      .reverse()
  } catch {
    return []
  }
}

export function readDailyNote(agentId: string, filename: string): string | null {
  if (!isSafeFilename(filename) || !filename.endsWith('.md')) return null
  const file = join(dailyNotesDir(agentId), filename)
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

// ─── Dream artifacts ─────────────────────────────────────────────────────────

function dreamDir(agentId: string): string {
  return join(workspacePath(agentId), 'memory', '.dreams')
}

function dreamingDir(agentId: string): string {
  return join(workspacePath(agentId), 'memory', 'dreaming')
}

export interface DreamPhaseDoc {
  phase: string
  file: string
}

export interface DreamArtifacts {
  phaseDocs: DreamPhaseDoc[]
  signals: string[]
}

export function listDreamArtifacts(agentId: string): DreamArtifacts {
  const phaseDocs: DreamPhaseDoc[] = []
  const signals: string[] = []

  const droot = dreamingDir(agentId)
  if (existsSync(droot)) {
    try {
      for (const phaseEntry of readdirSync(droot, { withFileTypes: true })) {
        if (!phaseEntry.isDirectory()) continue
        const phaseDir = join(droot, phaseEntry.name)
        try {
          for (const f of readdirSync(phaseDir)) {
            if (f.endsWith('.md')) phaseDocs.push({ phase: phaseEntry.name, file: f })
          }
        } catch { /* skip */ }
      }
    } catch (err) {
      log.warn('listDreamArtifacts/phaseDocs failed', { agentId, err: err instanceof Error ? err.message : String(err) })
    }
  }

  const sroot = dreamDir(agentId)
  if (existsSync(sroot)) {
    try {
      for (const entry of readdirSync(sroot, { withFileTypes: true })) {
        if (entry.isFile()) signals.push(entry.name)
      }
    } catch (err) {
      log.warn('listDreamArtifacts/signals failed', { agentId, err: err instanceof Error ? err.message : String(err) })
    }
  }

  return { phaseDocs, signals }
}

export type DreamArtifactKind = 'phase_doc' | 'signal'

export function readDreamArtifact(agentId: string, kind: DreamArtifactKind, relPath: string): string | null {
  if (!isSafeRelPath(relPath)) return null
  const base = kind === 'phase_doc' ? dreamingDir(agentId) : dreamDir(agentId)
  const file = join(base, relPath)
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

// ─── Durable (canonical bootstrap) files ─────────────────────────────────────

export const CANONICAL_DURABLE_FILES = [
  'MEMORY.md',
  'DREAMS.md',
  'SOUL.md',
  'MEMORY-LOG.md',
  'USER.md',
  'IDENTITY.md',
  'AGENTS.md',
  'TOOLS.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
] as const

export type DurableBasename = typeof CANONICAL_DURABLE_FILES[number]

const DURABLE_SET: ReadonlySet<string> = new Set(CANONICAL_DURABLE_FILES)

export function readDurableFile(agentId: string, basename: string): string | null {
  if (!isSafeFilename(basename)) return null
  if (!DURABLE_SET.has(basename)) return null
  const file = join(workspacePath(agentId), basename)
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}
