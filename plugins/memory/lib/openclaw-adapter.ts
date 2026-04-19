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

export function sessionStorePath(agentId: string): string {
  return join(agentSessionsDir(agentId), 'sessions.json')
}

/**
 * Map a filesystem path back to `{ agent }` if it is the sessions.json
 * store for a recognized agent. Returns null otherwise.
 */
export function matchSessionStorePath(path: string): { agent: string } | null {
  for (const agentId of listAgentIds()) {
    if (path === sessionStorePath(agentId)) return { agent: agentId }
  }
  return null
}

// ─── Session JSONL transcripts ───────────────────────────────────────────────

const SESSION_JSONL_RE = /^([^/.]+)\.jsonl$/
const SESSION_RESET_RE = /\.reset(?:\.|-)/

export interface SessionJsonlFile {
  agent: string
  sessionId: string
  sessionKey: string
  path: string
  size: number
  mtimeMs: number
  isReset: boolean
}

export function listSessionJsonlFiles(agentId: string): SessionJsonlFile[] {
  const dir = agentSessionsDir(agentId)
  if (!existsSync(dir)) return []
  const out: SessionJsonlFile[] = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.jsonl')) continue
      if (CHECKPOINT_RE.test(entry.name)) continue
      const isReset = SESSION_RESET_RE.test(entry.name)
      const m = SESSION_JSONL_RE.exec(entry.name)
      if (!m) continue
      const sessionId = m[1]
      const p = join(dir, entry.name)
      let size = 0
      let mtimeMs = Date.now()
      try {
        const st = statSync(p)
        size = st.size
        mtimeMs = st.mtimeMs
      } catch { /* fallback values */ }
      out.push({
        agent: agentId,
        sessionId,
        sessionKey: `agent:${agentId}:${sessionId}`,
        path: p,
        size,
        mtimeMs,
        isReset,
      })
    }
  } catch (err) {
    log.warn('listSessionJsonlFiles failed', { agentId, err: err instanceof Error ? err.message : String(err) })
  }
  return out
}

export function sessionJsonlPath(agentId: string, sessionId: string): string {
  return join(agentSessionsDir(agentId), `${sessionId}.jsonl`)
}

export function sessionJsonlStat(path: string): { size: number; mtimeMs: number } | null {
  if (!existsSync(path)) return null
  try {
    const st = statSync(path)
    return { size: st.size, mtimeMs: st.mtimeMs }
  } catch {
    return null
  }
}

/**
 * Map a filesystem path back to `{ agent, sessionId, isReset }` if it is a
 * session JSONL under a recognized agent. Excludes `.checkpoint.*.jsonl`
 * (those belong to the checkpoint tier, indexed in C7).
 */
export function matchSessionJsonlPath(
  path: string,
): { agent: string; sessionId: string; isReset: boolean } | null {
  for (const agentId of listAgentIds()) {
    const dir = agentSessionsDir(agentId)
    if (!path.startsWith(dir + '/')) continue
    const rest = path.slice(dir.length + 1)
    if (rest.includes('/')) continue
    if (!rest.endsWith('.jsonl')) continue
    if (CHECKPOINT_RE.test(rest)) return null
    const m = SESSION_JSONL_RE.exec(rest)
    if (!m) continue
    return { agent: agentId, sessionId: m[1], isReset: SESSION_RESET_RE.test(rest) }
  }
  return null
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

export interface CheckpointJsonlFile {
  agent: string
  sessionId: string
  checkpointId: string
  filename: string
  path: string
  size: number
  mtimeMs: number
}

const CHECKPOINT_PARTS_RE = /^([^/.]+)\.checkpoint\.([^/.]+)\.jsonl$/

export function listCheckpointJsonlFiles(agentId: string): CheckpointJsonlFile[] {
  const dir = agentSessionsDir(agentId)
  if (!existsSync(dir)) return []
  const out: CheckpointJsonlFile[] = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const m = CHECKPOINT_PARTS_RE.exec(entry.name)
      if (!m) continue
      const p = join(dir, entry.name)
      let size = 0
      let mtimeMs = Date.now()
      try {
        const st = statSync(p)
        size = st.size
        mtimeMs = st.mtimeMs
      } catch { /* fallback values */ }
      out.push({
        agent: agentId,
        sessionId: m[1],
        checkpointId: m[2],
        filename: entry.name,
        path: p,
        size,
        mtimeMs,
      })
    }
  } catch (err) {
    log.warn('listCheckpointJsonlFiles failed', { agentId, err: err instanceof Error ? err.message : String(err) })
  }
  return out
}

export function checkpointJsonlPath(agentId: string, filename: string): string {
  return join(agentSessionsDir(agentId), filename)
}

export function checkpointJsonlStat(path: string): { size: number; mtimeMs: number } | null {
  if (!existsSync(path)) return null
  try {
    const st = statSync(path)
    return { size: st.size, mtimeMs: st.mtimeMs }
  } catch {
    return null
  }
}

/**
 * Map a filesystem path back to `{ agent, sessionId, checkpointId, filename }`
 * if it is a checkpoint file under a recognized agent's sessions dir.
 */
export function matchCheckpointJsonlPath(
  path: string,
): { agent: string; sessionId: string; checkpointId: string; filename: string } | null {
  for (const agentId of listAgentIds()) {
    const dir = agentSessionsDir(agentId)
    if (!path.startsWith(dir + '/')) continue
    const rest = path.slice(dir.length + 1)
    if (rest.includes('/')) continue
    const m = CHECKPOINT_PARTS_RE.exec(rest)
    if (!m) continue
    return { agent: agentId, sessionId: m[1], checkpointId: m[2], filename: rest }
  }
  return null
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

export function dailyNotePath(agentId: string, filename: string): string {
  return join(dailyNotesDir(agentId), filename)
}

export function dailyNoteMtime(agentId: string, filename: string): number | null {
  const file = dailyNotePath(agentId, filename)
  if (!existsSync(file)) return null
  try {
    return statSync(file).mtimeMs
  } catch {
    return null
  }
}

export function dailyNoteSize(agentId: string, filename: string): number {
  const file = dailyNotePath(agentId, filename)
  if (!existsSync(file)) return 0
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/**
 * Map a filesystem path back to `{ agent, filename }` if it is inside a
 * workspace's `memory/` folder (and is a direct `*.md`, not a subdirectory
 * like `memory/.dreams/` or `memory/dreaming/`). Returns null otherwise.
 */
export function matchDailyNotePath(path: string): { agent: string; filename: string } | null {
  for (const agentId of listAgentIds()) {
    const dir = dailyNotesDir(agentId)
    if (path.startsWith(dir + '/')) {
      const rest = path.slice(dir.length + 1)
      if (!rest.includes('/') && rest.endsWith('.md')) {
        return { agent: agentId, filename: rest }
      }
    }
  }
  // Also consider the main-agent case where workspacePath collapses.
  const mainDir = getOpenClawPath('workspace', 'memory')
  if (path.startsWith(mainDir + '/')) {
    const rest = path.slice(mainDir.length + 1)
    if (!rest.includes('/') && rest.endsWith('.md')) {
      return { agent: tryGetMainAgentId() ?? 'main', filename: rest }
    }
  }
  return null
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

export interface PhaseDocFile {
  agent: string
  phase: string
  filename: string
  path: string
  mtimeMs: number
}

export interface DreamSignalFile {
  agent: string
  relPath: string
  path: string
  mtimeMs: number
}

export function listPhaseDocs(agentId: string): PhaseDocFile[] {
  const root = dreamingDir(agentId)
  if (!existsSync(root)) return []
  const out: PhaseDocFile[] = []
  try {
    for (const phaseEntry of readdirSync(root, { withFileTypes: true })) {
      if (!phaseEntry.isDirectory()) continue
      const phaseDir = join(root, phaseEntry.name)
      try {
        for (const f of readdirSync(phaseDir, { withFileTypes: true })) {
          if (!f.isFile() || !f.name.endsWith('.md')) continue
          const p = join(phaseDir, f.name)
          let mtimeMs = Date.now()
          try { mtimeMs = statSync(p).mtimeMs } catch { /* fallback */ }
          out.push({ agent: agentId, phase: phaseEntry.name, filename: f.name, path: p, mtimeMs })
        }
      } catch { /* skip */ }
    }
  } catch (err) {
    log.warn('listPhaseDocs failed', { agentId, err: err instanceof Error ? err.message : String(err) })
  }
  return out
}

export function listDreamSignalFiles(agentId: string): DreamSignalFile[] {
  const root = dreamDir(agentId)
  if (!existsSync(root)) return []
  const out: DreamSignalFile[] = []
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile()) {
        const p = join(root, entry.name)
        let mtimeMs = Date.now()
        try { mtimeMs = statSync(p).mtimeMs } catch { /* fallback */ }
        out.push({ agent: agentId, relPath: entry.name, path: p, mtimeMs })
      } else if (entry.isDirectory() && entry.name === 'session-corpus') {
        const corpus = join(root, entry.name)
        try {
          for (const f of readdirSync(corpus, { withFileTypes: true })) {
            if (!f.isFile()) continue
            const p = join(corpus, f.name)
            let mtimeMs = Date.now()
            try { mtimeMs = statSync(p).mtimeMs } catch { /* fallback */ }
            out.push({ agent: agentId, relPath: `session-corpus/${f.name}`, path: p, mtimeMs })
          }
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    log.warn('listDreamSignalFiles failed', { agentId, err: err instanceof Error ? err.message : String(err) })
  }
  return out
}

export function readPhaseDoc(agentId: string, phase: string, filename: string): string | null {
  if (!isSafeFilename(phase) || !isSafeFilename(filename) || !filename.endsWith('.md')) return null
  const file = join(dreamingDir(agentId), phase, filename)
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

export function readDreamSignal(agentId: string, relPath: string): string | null {
  if (!isSafeRelPath(relPath)) return null
  const file = join(dreamDir(agentId), relPath)
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Map a filesystem path back to `{ agent, phase, filename }` if it is a
 * `memory/dreaming/<phase>/<file>.md` under a recognized agent workspace.
 */
export function matchPhaseDocPath(
  path: string,
): { agent: string; phase: string; filename: string } | null {
  for (const agentId of listAgentIds()) {
    const root = dreamingDir(agentId)
    if (path.startsWith(root + '/')) {
      const rest = path.slice(root.length + 1)
      const slash = rest.indexOf('/')
      if (slash < 0) continue
      const phase = rest.slice(0, slash)
      const filename = rest.slice(slash + 1)
      if (filename.includes('/') || !filename.endsWith('.md')) continue
      return { agent: agentId, phase, filename }
    }
  }
  const mainRoot = getOpenClawPath('workspace', 'memory', 'dreaming')
  if (path.startsWith(mainRoot + '/')) {
    const rest = path.slice(mainRoot.length + 1)
    const slash = rest.indexOf('/')
    if (slash < 0) return null
    const phase = rest.slice(0, slash)
    const filename = rest.slice(slash + 1)
    if (filename.includes('/') || !filename.endsWith('.md')) return null
    return { agent: tryGetMainAgentId() ?? 'main', phase, filename }
  }
  return null
}

/**
 * Map a filesystem path back to `{ agent, relPath }` if it is under
 * `memory/.dreams/` for a recognized agent workspace (flat file or
 * `session-corpus/<file>`).
 */
export function matchDreamSignalPath(
  path: string,
): { agent: string; relPath: string } | null {
  for (const agentId of listAgentIds()) {
    const root = dreamDir(agentId)
    if (path.startsWith(root + '/')) {
      const rest = path.slice(root.length + 1)
      if (!rest.includes('/') || rest.startsWith('session-corpus/')) {
        if (rest.startsWith('session-corpus/')) {
          const tail = rest.slice('session-corpus/'.length)
          if (tail.includes('/')) continue
        }
        return { agent: agentId, relPath: rest }
      }
    }
  }
  const mainRoot = getOpenClawPath('workspace', 'memory', '.dreams')
  if (path.startsWith(mainRoot + '/')) {
    const rest = path.slice(mainRoot.length + 1)
    if (!rest.includes('/') || rest.startsWith('session-corpus/')) {
      if (rest.startsWith('session-corpus/')) {
        const tail = rest.slice('session-corpus/'.length)
        if (tail.includes('/')) return null
      }
      return { agent: tryGetMainAgentId() ?? 'main', relPath: rest }
    }
  }
  return null
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

/**
 * Normalized kind bucket for each canonical durable file. Mirrors the tab
 * names on `/team/<id>` so filtering memory by `kind=soul` lines up with
 * "look at this agent's soul" in the team view. Extended with `skill` for
 * per-skill SKILL.md rows (indexed alongside durable files).
 */
export const DURABLE_KIND_BY_BASENAME: Record<string, string> = {
  'SOUL.md': 'soul',
  'AGENTS.md': 'rules',
  'TOOLS.md': 'tools',
  'IDENTITY.md': 'identity',
  'HEARTBEAT.md': 'heartbeat',
  'MEMORY.md': 'memory',
  'MEMORY-LOG.md': 'memory-log',
  'DREAMS.md': 'dreams',
  'USER.md': 'user',
  'BOOTSTRAP.md': 'bootstrap',
}

/** Resolve a durable basename to its normalized kind, or undefined. */
export function durableKindForBasename(basename: string): string | undefined {
  return DURABLE_KIND_BY_BASENAME[basename]
}

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

export function durableFilePath(agentId: string, basename: string): string {
  return join(workspacePath(agentId), basename)
}

export function durableFileMtime(agentId: string, basename: string): number | null {
  const file = durableFilePath(agentId, basename)
  if (!existsSync(file)) return null
  try {
    return statSync(file).mtimeMs
  } catch {
    return null
  }
}

// ─── Skills (indexed alongside durable, kind=skill) ──────────────────────────

export interface AgentSkillFile {
  skillName: string
  path: string
  mtimeMs: number
}

/**
 * List every `{workspace}/skills/*\/SKILL.md` for an agent.
 * Non-existent skills dirs and missing SKILL.md files are silently skipped.
 */
export function listAgentSkills(agentId: string): AgentSkillFile[] {
  const skillsDir = join(workspacePath(agentId), 'skills')
  if (!existsSync(skillsDir)) return []
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true })
    const out: AgentSkillFile[] = []
    for (const d of entries) {
      if (!d.isDirectory()) continue
      if (!isSafeFilename(d.name)) continue
      const skillMd = join(skillsDir, d.name, 'SKILL.md')
      if (!existsSync(skillMd)) continue
      try {
        out.push({ skillName: d.name, path: skillMd, mtimeMs: statSync(skillMd).mtimeMs })
      } catch { /* skip unreadable */ }
    }
    return out
  } catch (err) {
    log.warn('listAgentSkills failed', {
      agent: agentId,
      err: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

export function readAgentSkill(agentId: string, skillName: string): string | null {
  if (!isSafeFilename(skillName)) return null
  const file = join(workspacePath(agentId), 'skills', skillName, 'SKILL.md')
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

export function skillFilePath(agentId: string, skillName: string): string {
  return join(workspacePath(agentId), 'skills', skillName, 'SKILL.md')
}

export function skillFileMtime(agentId: string, skillName: string): number | null {
  const file = skillFilePath(agentId, skillName)
  if (!existsSync(file)) return null
  try {
    return statSync(file).mtimeMs
  } catch {
    return null
  }
}

/**
 * Map a filesystem path back to `{ agent, skillName }` if it's a SKILL.md
 * under a recognized workspace's skills directory. Returns null otherwise.
 */
export function matchSkillPath(path: string): { agent: string; skillName: string } | null {
  const agents = listAgentIds()
  for (const agentId of agents) {
    const root = join(workspacePath(agentId), 'skills')
    if (!path.startsWith(root + '/')) continue
    const rest = path.slice(root.length + 1)
    const parts = rest.split('/')
    if (parts.length !== 2 || parts[1] !== 'SKILL.md') continue
    const skillName = parts[0]
    if (!isSafeFilename(skillName)) continue
    return { agent: agentId, skillName }
  }
  // Main-agent workspace (collapsed to `workspace/skills/...`).
  const mainRoot = getOpenClawPath('workspace', 'skills')
  if (path.startsWith(mainRoot + '/')) {
    const rest = path.slice(mainRoot.length + 1)
    const parts = rest.split('/')
    if (parts.length === 2 && parts[1] === 'SKILL.md' && isSafeFilename(parts[0])) {
      return { agent: tryGetMainAgentId() ?? 'main', skillName: parts[0] }
    }
  }
  return null
}

/**
 * Parse a filesystem path and return `{ agent, basename }` if it matches
 * a canonical durable file under a recognized workspace root. Returns null
 * otherwise — caller uses null as "not a durable file, ignore".
 */
export function matchDurablePath(path: string): { agent: string; basename: string } | null {
  const agents = listAgentIds()
  for (const agentId of agents) {
    for (const basename of CANONICAL_DURABLE_FILES) {
      if (path === durableFilePath(agentId, basename)) {
        return { agent: agentId, basename }
      }
    }
  }
  // Handle the main-agent case where workspacePath() collapses to `workspace/`
  // and tryGetMainAgentId() may have pointed somewhere different at list time.
  const mainCandidates = CANONICAL_DURABLE_FILES
  for (const basename of mainCandidates) {
    const main = getOpenClawPath('workspace', basename)
    if (path === main) return { agent: tryGetMainAgentId() ?? 'main', basename }
  }
  return null
}
