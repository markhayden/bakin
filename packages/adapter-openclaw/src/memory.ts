import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type {
  RuntimeMemoryEntry,
  RuntimeMemoryEntryStat,
  RuntimeMemoryPathMatch,
  RuntimeMemoryReadRange,
  RuntimeMemoryTier,
} from '@bakin/core/adapters/runtime'
import { readOpenClawConfig } from './config'
import { getOpenClawHome, getOpenClawPath } from './home'
import { tryGetMainAgentId } from './main-agent'
import { readSessionStoreCached } from './session-store'

const SESSION_JSONL_RE = /^([^/.]+)\.jsonl$/
const SESSION_RESET_RE = /\.reset(?:\.|-)/
const CHECKPOINT_RE = /^([^/]+)\.checkpoint\.[^/]+\.jsonl$/
const CHECKPOINT_PARTS_RE = /^([^/.]+)\.checkpoint\.([^/.]+)\.jsonl$/
const GATEWAY_LOG_DIR = '/tmp/openclaw'
const GATEWAY_LOG_RE = /^openclaw-(\d{4}-\d{2}-\d{2})\.log$/
const DATE_ID_RE = /^\d{4}-\d{2}-\d{2}$/

export const OPENCLAW_MEMORY_SOURCE_KINDS = {
  durable: 'durable',
  skill: 'skill',
  dailyNote: 'daily_note',
  sessionStore: 'session_store',
  sessionJsonl: 'session_jsonl',
  checkpoint: 'checkpoint',
  dreamPhase: 'dream_phase',
  dreamSignal: 'dream_signal',
  gatewayLog: 'gateway_log',
} as const

export const OPENCLAW_MEMORY_TIERS = {
  durable: 'openclaw-durable',
  skill: 'openclaw-skill',
  dailyNote: 'workspace-memory',
  sessionStore: 'openclaw-session-store',
  sessionJsonl: 'openclaw-session-jsonl',
  checkpoint: 'openclaw-checkpoint',
  dreamPhase: 'openclaw-dream-phase',
  dreamSignal: 'openclaw-dream-signal',
  gatewayLog: 'runtime-gateway-log',
} as const

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

const DURABLE_SET: ReadonlySet<string> = new Set(CANONICAL_DURABLE_FILES)

interface SourceRef {
  tierId: string
  sourceKind: string
  id: string
  agentId: string
  path: string
  metadata?: Record<string, unknown>
}

export function listOpenClawMemoryTiers(): RuntimeMemoryTier[] {
  return [
    tier(OPENCLAW_MEMORY_TIERS.durable, 'Durable files', 'Canonical workspace bootstrap files.', OPENCLAW_MEMORY_SOURCE_KINDS.durable),
    tier(OPENCLAW_MEMORY_TIERS.skill, 'Workspace skills', 'Per-agent SKILL.md files.', OPENCLAW_MEMORY_SOURCE_KINDS.skill),
    tier(OPENCLAW_MEMORY_TIERS.dailyNote, 'Workspace memory', 'Markdown memory files stored in the runtime workspace.', OPENCLAW_MEMORY_SOURCE_KINDS.dailyNote),
    tier(OPENCLAW_MEMORY_TIERS.sessionStore, 'Session store', 'Per-agent session metadata stores.', OPENCLAW_MEMORY_SOURCE_KINDS.sessionStore),
    tier(OPENCLAW_MEMORY_TIERS.sessionJsonl, 'Session transcripts', 'Per-agent JSONL session transcripts.', OPENCLAW_MEMORY_SOURCE_KINDS.sessionJsonl),
    tier(OPENCLAW_MEMORY_TIERS.checkpoint, 'Checkpoints', 'Session checkpoint JSONL files.', OPENCLAW_MEMORY_SOURCE_KINDS.checkpoint),
    tier(OPENCLAW_MEMORY_TIERS.dreamPhase, 'Dream phase docs', 'Markdown dream phase documents.', OPENCLAW_MEMORY_SOURCE_KINDS.dreamPhase),
    tier(OPENCLAW_MEMORY_TIERS.dreamSignal, 'Dream signals', 'Dream signal artifacts.', OPENCLAW_MEMORY_SOURCE_KINDS.dreamSignal),
    tier(OPENCLAW_MEMORY_TIERS.gatewayLog, 'Gateway logs', 'Runtime gateway log files.', OPENCLAW_MEMORY_SOURCE_KINDS.gatewayLog),
  ]
}

export function listOpenClawMemoryEntries(
  tierId: string,
  opts: { agentId?: string } = {},
): RuntimeMemoryEntry[] {
  if (tierId === OPENCLAW_MEMORY_TIERS.gatewayLog) {
    return listGatewayLogRefs().map((ref) => entryFromRef(ref, '', statFile(ref.path)))
  }
  const agents = opts.agentId ? [opts.agentId] : listAgentIds()
  const out: RuntimeMemoryEntry[] = []
  for (const agentId of agents) {
    for (const ref of listSourceRefs(tierId, agentId)) {
      const stat = statFile(ref.path)
      out.push(entryFromRef(ref, '', stat))
    }
  }
  return out
}

export function getOpenClawMemoryEntry(
  tierId: string,
  id: string,
  opts: { agentId?: string } = {},
): RuntimeMemoryEntry | null {
  const ref = sourceRefFor(tierId, id, opts.agentId)
  if (!ref || !existsSync(ref.path)) return null
  const stat = statFile(ref.path)
  try {
    return entryFromRef(ref, readFileSync(ref.path, 'utf-8'), stat)
  } catch {
    return null
  }
}

export function statOpenClawMemoryEntry(
  tierId: string,
  id: string,
  opts: { agentId?: string } = {},
): RuntimeMemoryEntryStat | null {
  const ref = sourceRefFor(tierId, id, opts.agentId)
  if (!ref) return null
  const stat = statFile(ref.path)
  if (!stat) return null
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    metadata: ref.metadata,
  }
}

export function readOpenClawMemoryEntryRange(
  tierId: string,
  id: string,
  opts: { agentId?: string; offset?: number; length?: number } = {},
): RuntimeMemoryReadRange | null {
  const ref = sourceRefFor(tierId, id, opts.agentId)
  if (!ref || !existsSync(ref.path)) return null
  const stat = statFile(ref.path)
  if (!stat) return null

  const offset = Math.max(0, Math.floor(opts.offset ?? 0))
  if (offset >= stat.size) {
    return {
      content: '',
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      updatedAt: new Date(stat.mtimeMs).toISOString(),
      metadata: ref.metadata,
    }
  }

  const raw = readFileSync(ref.path)
  const end = typeof opts.length === 'number'
    ? Math.min(raw.length, offset + Math.max(0, Math.floor(opts.length)))
    : raw.length
  return {
    content: raw.subarray(offset, end).toString('utf-8'),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    metadata: ref.metadata,
  }
}

export function resolveOpenClawMemoryPath(path: string): RuntimeMemoryPathMatch | null {
  const ref = matchSourcePath(path)
  if (!ref) return null
  return {
    tierId: ref.tierId,
    id: ref.id,
    agentId: ref.agentId,
    path: ref.path,
    metadata: ref.metadata,
  }
}

export function getOpenClawMemoryWatchPaths(): string[] {
  return [
    getOpenClawPath('agents', '*', 'sessions', 'sessions.json'),
    getOpenClawPath('agents', '*', 'sessions', '*.jsonl'),
    getOpenClawPath('workspace', '*.md'),
    getOpenClawPath('workspaces', '*', '*.md'),
    getOpenClawPath('workspace', 'skills', '*', 'SKILL.md'),
    getOpenClawPath('workspaces', '*', 'skills', '*', 'SKILL.md'),
    getOpenClawPath('workspace', 'memory', '**', '*'),
    getOpenClawPath('workspaces', '*', 'memory', '**', '*'),
    join(GATEWAY_LOG_DIR, 'openclaw-*.log'),
  ]
}

function tier(id: string, label: string, description: string, sourceKind: string): RuntimeMemoryTier {
  return {
    id,
    label,
    description,
    metadata: { sourceKind },
  }
}

function listSourceRefs(tierId: string, agentId: string): SourceRef[] {
  switch (tierId) {
    case OPENCLAW_MEMORY_TIERS.durable:
      return listDurableRefs(agentId)
    case OPENCLAW_MEMORY_TIERS.skill:
      return listSkillRefs(agentId)
    case OPENCLAW_MEMORY_TIERS.dailyNote:
      return listDailyNoteRefs(agentId)
    case OPENCLAW_MEMORY_TIERS.sessionStore:
      return listSessionStoreRefs(agentId)
    case OPENCLAW_MEMORY_TIERS.sessionJsonl:
      return listSessionJsonlRefs(agentId)
    case OPENCLAW_MEMORY_TIERS.checkpoint:
      return listCheckpointRefs(agentId)
    case OPENCLAW_MEMORY_TIERS.dreamPhase:
      return listDreamPhaseRefs(agentId)
    case OPENCLAW_MEMORY_TIERS.dreamSignal:
      return listDreamSignalRefs(agentId)
    case OPENCLAW_MEMORY_TIERS.gatewayLog:
      return listGatewayLogRefs()
    default:
      return []
  }
}

function sourceRefFor(tierId: string, id: string, agentId?: string): SourceRef | null {
  if (tierId === OPENCLAW_MEMORY_TIERS.gatewayLog) {
    return gatewayLogRef(id)
  }
  if (!agentId) return null
  if (!isSafeRelPath(id)) return null
  switch (tierId) {
    case OPENCLAW_MEMORY_TIERS.durable:
      return DURABLE_SET.has(id) ? durableRef(agentId, id) : null
    case OPENCLAW_MEMORY_TIERS.skill:
      return isSafeFilename(id) ? skillRef(agentId, id) : null
    case OPENCLAW_MEMORY_TIERS.dailyNote:
      return isSafeFilename(id) && id.endsWith('.md') ? dailyNoteRef(agentId, id) : null
    case OPENCLAW_MEMORY_TIERS.sessionStore:
      return id === 'sessions.json' ? sessionStoreRef(agentId) : null
    case OPENCLAW_MEMORY_TIERS.sessionJsonl:
      return isSafeFilename(id) ? sessionJsonlRef(agentId, id) : null
    case OPENCLAW_MEMORY_TIERS.checkpoint:
      return isSafeFilename(id) && CHECKPOINT_PARTS_RE.test(id) ? checkpointRef(agentId, id) : null
    case OPENCLAW_MEMORY_TIERS.dreamPhase:
      return dreamPhaseRefFromId(agentId, id)
    case OPENCLAW_MEMORY_TIERS.dreamSignal:
      return isSafeRelPath(id) ? dreamSignalRef(agentId, id) : null
    default:
      return null
  }
}

function listGatewayLogRefs(): SourceRef[] {
  if (!existsSync(GATEWAY_LOG_DIR)) return []
  try {
    return readdirSync(GATEWAY_LOG_DIR)
      .map((name) => {
        const match = GATEWAY_LOG_RE.exec(name)
        return match ? gatewayLogRef(match[1]) : null
      })
      .filter((ref): ref is SourceRef => Boolean(ref))
  } catch {
    return []
  }
}

function gatewayLogRef(date: string): SourceRef | null {
  if (!DATE_ID_RE.test(date)) return null
  return {
    tierId: OPENCLAW_MEMORY_TIERS.gatewayLog,
    sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.gatewayLog,
    id: date,
    agentId: 'runtime',
    path: join(GATEWAY_LOG_DIR, `openclaw-${date}.log`),
    metadata: { sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.gatewayLog, date },
  }
}

function listDurableRefs(agentId: string): SourceRef[] {
  return CANONICAL_DURABLE_FILES
    .map((basename) => durableRef(agentId, basename))
    .filter((ref) => existsSync(ref.path))
}

function durableRef(agentId: string, basename: string): SourceRef {
  return {
    tierId: OPENCLAW_MEMORY_TIERS.durable,
    sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.durable,
    id: basename,
    agentId,
    path: join(workspacePath(agentId), basename),
    metadata: { sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.durable, basename },
  }
}

function listSkillRefs(agentId: string): SourceRef[] {
  const skillsDir = join(workspacePath(agentId), 'skills')
  if (!existsSync(skillsDir)) return []
  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isSafeFilename(entry.name))
      .map((entry) => skillRef(agentId, entry.name))
      .filter((ref) => existsSync(ref.path))
  } catch {
    return []
  }
}

function skillRef(agentId: string, skillName: string): SourceRef {
  return {
    tierId: OPENCLAW_MEMORY_TIERS.skill,
    sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.skill,
    id: skillName,
    agentId,
    path: join(workspacePath(agentId), 'skills', skillName, 'SKILL.md'),
    metadata: { sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.skill, skillName },
  }
}

function listDailyNoteRefs(agentId: string): SourceRef[] {
  const dir = join(workspacePath(agentId), 'memory')
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => dailyNoteRef(agentId, entry.name))
      .sort((a, b) => b.id.localeCompare(a.id))
  } catch {
    return []
  }
}

function dailyNoteRef(agentId: string, filename: string): SourceRef {
  return {
    tierId: OPENCLAW_MEMORY_TIERS.dailyNote,
    sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.dailyNote,
    id: filename,
    agentId,
    path: join(workspacePath(agentId), 'memory', filename),
    metadata: { sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.dailyNote, filename },
  }
}

function listSessionStoreRefs(agentId: string): SourceRef[] {
  const ref = sessionStoreRef(agentId)
  return existsSync(ref.path) ? [ref] : []
}

function sessionStoreRef(agentId: string): SourceRef {
  return {
    tierId: OPENCLAW_MEMORY_TIERS.sessionStore,
    sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.sessionStore,
    id: 'sessions.json',
    agentId,
    path: join(agentSessionsDir(agentId), 'sessions.json'),
    metadata: { sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.sessionStore },
  }
}

function listSessionJsonlRefs(agentId: string): SourceRef[] {
  const dir = agentSessionsDir(agentId)
  if (!existsSync(dir)) return []
  try {
    const out: SourceRef[] = []
    const originFor = sessionOriginResolver(agentId)
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      if (CHECKPOINT_RE.test(entry.name)) continue
      const match = SESSION_JSONL_RE.exec(entry.name)
      if (!match) continue
      out.push(sessionJsonlRef(agentId, match[1], entry.name, originFor))
    }
    return out
  } catch {
    return []
  }
}

/**
 * Session origin labeling (#691): the gateway's sessions.json keys carry the
 * provenance. Bakin's threaded sends register under
 * `agent:<id>:explicit:<uuid>` with a deterministic v5-shaped uuid
 * (deterministicUuid stamps the version nibble); subagent sessions are
 * runtime-spawned child work, never operator chat. Every other key shape
 * (`:main`, channels, `:openai:*` external clients, v4-explicit) is an
 * interactive/external session.
 *
 * The store only maps each key to its CURRENT sessionId, so files predating
 * a reset/rotation miss the lookup. For those the uuid version nibble is
 * still real evidence: Bakin mints v5-shaped ids deterministically, the
 * gateway mints v4 (randomUUID) for main/channel sessions — so an orphaned
 * v4 file is a rotated interactive session, not "untracked runtime
 * activity" (a mislabel here fires a false unexplained-usage alarm about
 * the user's own chats after every /reset). Only an unreadable store — no
 * evidence at all — is `unknown`.
 *
 * Known residual: subagent sessions are also gateway-minted v4, so after a
 * FULL store prune (rare — normal rotation replaces sessionIds under kept
 * keys) old subagent transcripts classify external. That cannot mislead the
 * burn surfaces: zero-user-turn external sessions never count toward the
 * calm interactive bucket (they land in unexplained), and window-scoped
 * session sums keep finished sessions from paging runaway.
 */
function sessionOriginResolver(agentId: string): (sessionId: string) => 'bakin' | 'external' | 'unknown' {
  const store = readSessionStoreCached(join(agentSessionsDir(agentId), 'sessions.json'))
  if (!store) return () => 'unknown'
  const keyBySessionId = new Map<string, string>()
  for (const [key, entry] of Object.entries(store)) {
    if (entry?.sessionId) keyBySessionId.set(entry.sessionId, key)
  }
  return (sessionId: string) => {
    const key = keyBySessionId.get(sessionId)
    if (!key) return sessionId[14] === '5' ? 'bakin' : 'external'
    if (key === `agent:${agentId}:explicit:${sessionId}` && sessionId[14] === '5') return 'bakin'
    if (key.startsWith(`agent:${agentId}:subagent:`)) return 'bakin'
    return 'external'
  }
}

function sessionJsonlRef(
  agentId: string,
  sessionId: string,
  filename = `${sessionId}.jsonl`,
  originFor?: (sessionId: string) => 'bakin' | 'external' | 'unknown',
): SourceRef {
  const resolve = originFor ?? sessionOriginResolver(agentId)
  return {
    tierId: OPENCLAW_MEMORY_TIERS.sessionJsonl,
    sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.sessionJsonl,
    id: sessionId,
    agentId,
    path: join(agentSessionsDir(agentId), filename),
    metadata: {
      sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.sessionJsonl,
      sessionId,
      isReset: SESSION_RESET_RE.test(filename),
      origin: resolve(sessionId),
    },
  }
}

function listCheckpointRefs(agentId: string): SourceRef[] {
  const dir = agentSessionsDir(agentId)
  if (!existsSync(dir)) return []
  try {
    const out: SourceRef[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const match = CHECKPOINT_PARTS_RE.exec(entry.name)
      if (!match) continue
      out.push(checkpointRef(agentId, entry.name))
    }
    return out
  } catch {
    return []
  }
}

function checkpointRef(agentId: string, filename: string): SourceRef {
  const match = CHECKPOINT_PARTS_RE.exec(filename)
  return {
    tierId: OPENCLAW_MEMORY_TIERS.checkpoint,
    sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.checkpoint,
    id: filename,
    agentId,
    path: join(agentSessionsDir(agentId), filename),
    metadata: {
      sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.checkpoint,
      filename,
      sessionId: match?.[1] ?? '',
      checkpointId: match?.[2] ?? '',
    },
  }
}

function listDreamPhaseRefs(agentId: string): SourceRef[] {
  const root = join(workspacePath(agentId), 'memory', 'dreaming')
  if (!existsSync(root)) return []
  const out: SourceRef[] = []
  try {
    for (const phaseEntry of readdirSync(root, { withFileTypes: true })) {
      if (!phaseEntry.isDirectory() || !isSafeFilename(phaseEntry.name)) continue
      const phaseDir = join(root, phaseEntry.name)
      try {
        for (const file of readdirSync(phaseDir, { withFileTypes: true })) {
          if (!file.isFile() || !file.name.endsWith('.md') || !isSafeFilename(file.name)) continue
          out.push(dreamPhaseRef(agentId, phaseEntry.name, file.name))
        }
      } catch {
        // skip unreadable phase directory
      }
    }
  } catch {
    return []
  }
  return out
}

function dreamPhaseRefFromId(agentId: string, id: string): SourceRef | null {
  const slash = id.indexOf('/')
  if (slash < 0) return null
  const phase = id.slice(0, slash)
  const filename = id.slice(slash + 1)
  if (!isSafeFilename(phase) || !isSafeFilename(filename) || !filename.endsWith('.md')) return null
  return dreamPhaseRef(agentId, phase, filename)
}

function dreamPhaseRef(agentId: string, phase: string, filename: string): SourceRef {
  return {
    tierId: OPENCLAW_MEMORY_TIERS.dreamPhase,
    sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.dreamPhase,
    id: `${phase}/${filename}`,
    agentId,
    path: join(workspacePath(agentId), 'memory', 'dreaming', phase, filename),
    metadata: {
      sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.dreamPhase,
      phase,
      filename,
    },
  }
}

function listDreamSignalRefs(agentId: string): SourceRef[] {
  const root = join(workspacePath(agentId), 'memory', '.dreams')
  if (!existsSync(root)) return []
  const out: SourceRef[] = []
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile()) {
        out.push(dreamSignalRef(agentId, entry.name))
      } else if (entry.isDirectory() && entry.name === 'session-corpus') {
        const corpus = join(root, entry.name)
        try {
          for (const file of readdirSync(corpus, { withFileTypes: true })) {
            if (!file.isFile()) continue
            out.push(dreamSignalRef(agentId, `session-corpus/${file.name}`))
          }
        } catch {
          // skip unreadable corpus
        }
      }
    }
  } catch {
    return []
  }
  return out
}

function dreamSignalRef(agentId: string, relPath: string): SourceRef {
  return {
    tierId: OPENCLAW_MEMORY_TIERS.dreamSignal,
    sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.dreamSignal,
    id: relPath,
    agentId,
    path: join(workspacePath(agentId), 'memory', '.dreams', relPath),
    metadata: { sourceKind: OPENCLAW_MEMORY_SOURCE_KINDS.dreamSignal, relPath },
  }
}

function matchSourcePath(path: string): SourceRef | null {
  if (path.startsWith(GATEWAY_LOG_DIR + '/')) {
    const match = GATEWAY_LOG_RE.exec(path.slice(GATEWAY_LOG_DIR.length + 1))
    if (match) return gatewayLogRef(match[1])
  }

  for (const agentId of listAgentIds()) {
    const match = matchAgentPath(agentId, path)
    if (match) return match
  }

  const mainAgent = tryGetMainAgentId() ?? 'main'
  return matchMainWorkspacePath(mainAgent, path)
}

function matchAgentPath(agentId: string, path: string): SourceRef | null {
  const sessionsDir = agentSessionsDir(agentId)
  if (path === join(sessionsDir, 'sessions.json')) return sessionStoreRef(agentId)
  if (path.startsWith(sessionsDir + '/')) {
    const rest = path.slice(sessionsDir.length + 1)
    if (rest.includes('/')) return null
    const checkpoint = CHECKPOINT_PARTS_RE.exec(rest)
    if (checkpoint) return checkpointRef(agentId, rest)
    if (rest.endsWith('.jsonl') && !CHECKPOINT_RE.test(rest)) {
      const session = SESSION_JSONL_RE.exec(rest)
      if (session) return sessionJsonlRef(agentId, session[1], rest)
    }
    return null
  }

  const root = workspacePath(agentId)
  if (path.startsWith(root + '/')) {
    return matchWorkspaceRelative(agentId, root, path)
  }
  return null
}

function matchMainWorkspacePath(agentId: string, path: string): SourceRef | null {
  const root = getOpenClawPath('workspace')
  if (!path.startsWith(root + '/')) return null
  return matchWorkspaceRelative(agentId, root, path)
}

function matchWorkspaceRelative(agentId: string, root: string, path: string): SourceRef | null {
  const rel = path.slice(root.length + 1)
  if (rel.includes('\\') || rel.includes('..')) return null

  if (!rel.includes('/') && DURABLE_SET.has(rel)) return durableRef(agentId, rel)

  const skillPrefix = 'skills/'
  if (rel.startsWith(skillPrefix)) {
    const parts = rel.slice(skillPrefix.length).split('/')
    if (parts.length === 2 && parts[1] === 'SKILL.md' && isSafeFilename(parts[0])) {
      return skillRef(agentId, parts[0])
    }
  }

  const memoryPrefix = 'memory/'
  if (!rel.startsWith(memoryPrefix)) return null
  const memoryRel = rel.slice(memoryPrefix.length)
  if (!memoryRel.includes('/') && memoryRel.endsWith('.md')) return dailyNoteRef(agentId, memoryRel)

  const phasePrefix = 'dreaming/'
  if (memoryRel.startsWith(phasePrefix)) {
    const rest = memoryRel.slice(phasePrefix.length)
    const slash = rest.indexOf('/')
    if (slash < 0) return null
    const phase = rest.slice(0, slash)
    const filename = rest.slice(slash + 1)
    if (filename.includes('/') || !filename.endsWith('.md')) return null
    return dreamPhaseRef(agentId, phase, filename)
  }

  const signalPrefix = '.dreams/'
  if (memoryRel.startsWith(signalPrefix)) {
    const rest = memoryRel.slice(signalPrefix.length)
    if (!rest.includes('/') || rest.startsWith('session-corpus/')) {
      if (rest.startsWith('session-corpus/')) {
        const tail = rest.slice('session-corpus/'.length)
        if (tail.includes('/')) return null
      }
      return dreamSignalRef(agentId, rest)
    }
  }

  return null
}

function entryFromRef(ref: SourceRef, content: string, stat: { size: number; mtimeMs: number } | null): RuntimeMemoryEntry {
  return {
    id: ref.id,
    tierId: ref.tierId,
    agentId: ref.agentId,
    path: ref.path,
    content,
    ...(stat ? { updatedAt: new Date(stat.mtimeMs).toISOString() } : {}),
    metadata: {
      ...(ref.metadata ?? {}),
      ...(stat ? { sizeBytes: stat.size, mtimeMs: stat.mtimeMs } : {}),
    },
  }
}

function statFile(path: string): { size: number; mtimeMs: number } | null {
  try {
    const stat = statSync(path)
    return { size: stat.size, mtimeMs: stat.mtimeMs }
  } catch {
    return null
  }
}

function listAgentIds(): string[] {
  const dir = getOpenClawPath('agents')
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function agentSessionsDir(agentId: string): string {
  return getOpenClawPath('agents', agentId, 'sessions')
}

function workspacePath(agentId: string): string {
  const config = readOpenClawConfig()
  const isMain = agentId === tryGetMainAgentId()
  const agent = config?.agents?.list?.find((entry) => entry.id === agentId)
  const configured = agent?.workspace ?? (isMain ? config?.agents?.defaults?.workspace : undefined)
  // The configured workspace may be an absolute path under a DIFFERENT OpenClaw
  // home than the one this process resolves — e.g. host-side Bakin reading a
  // container-onboarded config in the dockerized dev rig, where it points at
  // `/home/node/.openclaw/workspace`. Trust it only if it actually exists here;
  // otherwise resolve against THIS home, which is always correct for the
  // canonical layout. (On a normal install the two are identical.)
  if (configured && existsSync(configured)) return configured
  return isMain ? join(getOpenClawHome(), 'workspace') : join(getOpenClawHome(), 'workspaces', agentId)
}

function isSafeFilename(name: string): boolean {
  return !name.includes('..') && !name.startsWith('/') && !name.includes('\\')
}

function isSafeRelPath(rel: string): boolean {
  return !rel.includes('..') && !rel.startsWith('/') && !rel.includes('\\')
}
