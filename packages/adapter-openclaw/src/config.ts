/**
 * OpenClaw runtime config reader.
 *
 * Provider config parsing belongs to the OpenClaw adapter package — nothing
 * outside this adapter reads openclaw.json (adapter-boundary arch test).
 *
 * Agent registry shapes (#873): OpenClaw 2026.9.5 moved agents from the
 * legacy `agents.list` ARRAY to the keyed `agents.entries` MAP (the key IS
 * the id) with `agents.ownership` policy. Bakin is entries-canonical:
 * `agentListFrom` is the SOLE shape decoder (entries → legacy list →
 * synthesis rules), and every write lands on entries — a mutation against a
 * list-shaped config upgrades it one-way via `ensureAgentEntries`. Bakin
 * never authors `agents.list` or `ownership`.
 */
import { readFileSync, statSync } from 'fs'

import { getOpenClawPath } from './home'

/** An agent as stored under `agents.entries[<id>]` — the id lives in the key. */
export interface OpenClawAgentEntry {
  id?: string
  name?: string
  workspace?: string
  agentDir?: string
  model?: string | { primary?: string }
  identity?: { name?: string; emoji?: string }
  subagents?: { allowAgents?: string[]; model?: string }
}

/** A DECODED agent: entry fields + the authoritative id (map key or list field). */
export interface OpenClawAgent extends OpenClawAgentEntry {
  id: string
}

export interface OpenClawConfig {
  agents?: {
    /** OpenClaw's registry policy (2026.9.5+, e.g. 'explicit'). Bakin preserves, never authors. */
    ownership?: string
    defaults?: {
      model?: { primary?: string }
      workspace?: string
    }
    /** 2026.9.5+ keyed registry — the canonical shape Bakin reads and writes. */
    entries?: Record<string, OpenClawAgentEntry>
    /** Legacy pre-2026.9.5 array — read-tolerated, upgraded on first mutation, never written. */
    list?: OpenClawAgent[]
  }
  gateway?: {
    auth?: { token?: string }
  }
  channels?: Record<string, unknown>
  skills?: Record<string, unknown>
}

let cachedConfig: { path: string; mtimeMs: number; config: OpenClawConfig | null; corrupt: boolean } | null = null

type ConfigReadState =
  | { kind: 'ok'; config: OpenClawConfig }
  | { kind: 'absent' }
  | { kind: 'corrupt' }

function readConfigState(): ConfigReadState {
  let path: string
  try {
    path = getOpenClawPath('openclaw.json')
  } catch {
    cachedConfig = null
    return { kind: 'absent' }
  }

  let mtimeMs: number
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    cachedConfig = null
    return { kind: 'absent' }
  }

  if (cachedConfig && cachedConfig.path === path && cachedConfig.mtimeMs === mtimeMs) {
    if (cachedConfig.corrupt) return { kind: 'corrupt' }
    return cachedConfig.config ? { kind: 'ok', config: cachedConfig.config } : { kind: 'absent' }
  }

  try {
    const config = JSON.parse(readFileSync(path, 'utf-8')) as OpenClawConfig
    cachedConfig = { path, mtimeMs, config, corrupt: false }
    return { kind: 'ok', config }
  } catch {
    cachedConfig = { path, mtimeMs, config: null, corrupt: true }
    return { kind: 'corrupt' }
  }
}

/**
 * Lenient read for presence checks and other read-only consumers: a missing
 * OR unparseable file reads as `null` and callers degrade gracefully.
 * Mutators must NOT use this — see readOpenClawConfigForMutation.
 */
export function readOpenClawConfig(): OpenClawConfig | null {
  const state = readConfigState()
  return state.kind === 'ok' ? state.config : null
}

/**
 * Strict read for read-modify-write paths. An ABSENT file starts from `{}`;
 * an UNPARSEABLE file THROWS — writers previously coalesced both to `{}` and
 * a single torn read let automatic provisioning replace the user's entire
 * runtime config (credentials included) with just Bakin's entries.
 *
 * Returns a DEEP CLONE, never the cached object (#873 review): mutators
 * apply shape upgrades (ensureAgentEntries) before writing, and a throw
 * between mutation and write must not leave the process-wide cache
 * diverged from disk. The eventual writeOpenClawConfig resets the cache.
 */
export function readOpenClawConfigForMutation(): OpenClawConfig {
  const state = readConfigState()
  if (state.kind === 'corrupt') {
    throw new Error(
      'openclaw.json exists but is not valid JSON — refusing to modify it. Fix or restore the file, then retry.',
    )
  }
  return state.kind === 'ok' ? structuredClone(state.config) : {}
}

/**
 * THE shape decoder — the only code allowed to know where agents live.
 * Order: keyed `entries` (2026.9.5+, key wins over any embedded id) →
 * legacy nonempty `list` → synthesis ONLY for a genuinely virgin config.
 * An existing `entries` map (even empty) or `ownership: 'explicit'` is
 * authoritative: an empty roster renders honestly empty — a real install
 * always has main, so fabricating one would make a broken OpenClaw look
 * healthy (#873). Entries-decoded objects are DEEP copies (detached from
 * the process-wide config cache — mutating one is a no-op, not cache
 * corruption); write paths go through the accessors below, never through
 * this list. The legacy-list path returns the parsed rows as-is
 * (pre-#873 behavior, read-only by convention).
 */
export function agentListFrom(config: OpenClawConfig | null): OpenClawAgent[] {
  if (!config) return []
  const agents = config.agents
  if (agents?.entries) {
    return Object.entries(agents.entries).map(([id, entry]) => ({ ...structuredClone(entry), id }))
  }
  if (Array.isArray(agents?.list) && agents.list.length > 0) return agents.list
  if (agents?.ownership === 'explicit') return []
  return [implicitMainAgent(config)]
}

export function getAgentList(): OpenClawAgent[] {
  return agentListFrom(readOpenClawConfig())
}

export function getAgentIds(): string[] {
  return getAgentList().map((agent) => agent.id)
}

export function findAgentById(id: string): OpenClawAgent | null {
  return getAgentList().find((agent) => agent.id === id) ?? null
}

export function resetOpenClawConfigCache(): void {
  cachedConfig = null
}

function implicitMainAgent(config: OpenClawConfig): OpenClawAgent {
  const defaults = config.agents?.defaults
  return {
    id: 'main',
    name: 'Main',
    workspace: defaults?.workspace,
    agentDir: getOpenClawPath('agents', 'main', 'agent'),
    model: defaults?.model,
  }
}

/** A config whose roster the decoder would SYNTHESIZE (fresh install) vs an authoritative registry. */
function isVirginRoster(config: OpenClawConfig): boolean {
  const agents = config.agents
  if (agents?.entries) return false
  if (agents?.ownership === 'explicit') return false
  return !(Array.isArray(agents?.list) && agents.list.length > 0)
}

/**
 * Canonicalize the registry for a WRITE: guarantees `agents.entries` exists
 * and deletes `list` — the one-way upgrade (#873 D1). Legacy `list` rows are
 * merged in ONLY when there was no entries map (a pure pre-9.5 config): on a
 * hybrid file entries is already read-truth and the roster never showed the
 * stale list rows, so merging them back would resurrect agents no read ever
 * reported (review finding — write-truth must equal read-truth). Returns the
 * LIVE entries map; mutate its values in place so unknown fields round-trip.
 */
export function ensureAgentEntries(config: OpenClawConfig): Record<string, OpenClawAgentEntry> {
  config.agents ??= {}
  const agents = config.agents
  const hadEntries = agents.entries !== undefined
  agents.entries ??= {}
  if (Array.isArray(agents.list)) {
    if (!hadEntries) {
      for (const legacy of agents.list) {
        if (!legacy?.id || agents.entries[legacy.id]) continue
        const { id: _id, ...entry } = legacy
        agents.entries[legacy.id] = entry
      }
    }
    delete agents.list
  }
  return agents.entries
}

/** The live entry for `id`, or null. Write-path twin of the decoder's lookup. */
export function findAgentIn(config: OpenClawConfig, id: string): OpenClawAgentEntry | null {
  const entries = config.agents?.entries
  if (entries) return entries[id] ?? null
  return config.agents?.list?.find((agent) => agent.id === id) ?? null
}

/** The live entry for a write, created if absent (upgrades legacy configs first). */
export function upsertAgentIn(config: OpenClawConfig, id: string): OpenClawAgentEntry {
  const entries = ensureAgentEntries(config)
  entries[id] ??= {}
  return entries[id]
}

/**
 * The live entry for a write, ONLY when the agent already exists — the
 * edit-not-create idiom every field mutator needs (identity, allowlist,
 * models). Null = caller throws not_found; a missing agent is never
 * silently created (#873 D2).
 */
export function existingAgentForWrite(config: OpenClawConfig, id: string): OpenClawAgentEntry | null {
  return findAgentIn(config, id) ? upsertAgentIn(config, id) : null
}

/**
 * The configured workspace for an agent — per-entry `workspace`, else
 * `agents.defaults.workspace` for main only. Shared shape-lookup for
 * agent-config's getWorkspacePath and memory's workspacePath; each caller
 * keeps its own trust predicate over the returned path.
 */
export function configuredWorkspaceFor(
  config: OpenClawConfig | null,
  agentId: string,
  isMain: boolean,
): string | undefined {
  if (!config) return undefined
  const agent = findAgentIn(config, agentId)
  return agent?.workspace ?? (isMain ? config.agents?.defaults?.workspace : undefined)
}

/**
 * Materialize `main` for a write path — ONLY when the roster would have
 * synthesized it (virgin config, or main already present). An authoritative
 * registry without main returns null (caller throws not_found): Bakin never
 * invents agents inside an explicit registry (#873 D2).
 */
export function materializeImplicitMainAgent(config: OpenClawConfig): OpenClawAgentEntry | null {
  const hasMain = agentListFrom(config).some((agent) => agent.id === 'main')
  const virgin = isVirginRoster(config)
  if (!hasMain && !virgin) return null
  const entries = ensureAgentEntries(config)
  if (!entries.main) {
    const { id: _id, ...entry } = implicitMainAgent(config)
    entries.main = entry
  }
  return entries.main
}
