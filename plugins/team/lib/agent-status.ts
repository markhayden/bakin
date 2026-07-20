/**
 * Agent online/working/offline status resolution + org structure for the team
 * plugin.
 *
 * Extracted from index.ts. Status is derived from two signals — the agent's
 * HEARTBEAT and recent audit-log activity — against a configurable staleness
 * threshold. The threshold reads the team plugin's settings via a context set
 * by activate() (`setStaleSettingsContext`), so this module stays free of any
 * direct plugin-registry dependency.
 */
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'fs'
import { join } from 'path'

import type { PluginContext } from '@bakin/core/plugin-types'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

import { getContentDir } from '../../../packages/core/src/content-dir'
import { getInFlightTurnCount } from '../../../src/core/dispatch-registry'
import { createLogger } from '../../../src/core/logger'
import type { HeartbeatData } from '../types'
import { mergeDisplayDefaults, readDisplaySettings, readTeams } from './team-settings'
import { listRuntimeAgentMetas } from './runtime-agents'

const log = createLogger('team')
const DEFAULT_STALE_THRESHOLD_MS = 15 * 60 * 1000

let staleSettingsCtx: PluginContext | null = null

/** Wire the plugin context so the staleness threshold reads live settings. */
export function setStaleSettingsContext(ctx: PluginContext): void {
  staleSettingsCtx = ctx
}

function getStaleThresholdMs(): number {
  if (staleSettingsCtx) {
    const settings = staleSettingsCtx.getSettings<{ staleThresholdMinutes?: number }>()
    if (settings.staleThresholdMinutes && settings.staleThresholdMinutes > 0) {
      return settings.staleThresholdMinutes * 60 * 1000
    }
  }
  return DEFAULT_STALE_THRESHOLD_MS
}

/**
 * Read the tail of audit.jsonl and return the most recent timestamp per agent.
 * Only scans the last ~64KB to stay fast on large files.
 */
export function getLastAuditActivity(): Record<string, number> {
  const auditPath = join(getContentDir(), 'audit.jsonl')
  const result: Record<string, number> = {}
  try {
    if (!existsSync(auditPath)) return result
    const fd = openSync(auditPath, 'r')
    const stat = fstatSync(fd)
    const TAIL_BYTES = 64 * 1024
    const start = Math.max(0, stat.size - TAIL_BYTES)
    const buf = Buffer.alloc(Math.min(TAIL_BYTES, stat.size))
    readSync(fd, buf, 0, buf.length, start)
    closeSync(fd)

    const text = buf.toString('utf-8')
    // If we started mid-line, skip the first partial line
    const lines = text.split('\n')
    if (start > 0) lines.shift()

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as { ts?: string; agent?: string }
        if (entry.ts && entry.agent) {
          const t = new Date(entry.ts).getTime()
          if (!isNaN(t) && (!result[entry.agent] || t > result[entry.agent])) {
            result[entry.agent] = t
          }
        }
      } catch { /* skip malformed lines */ }
    }
  } catch (err) {
    log.warn('Failed to read audit.jsonl for activity detection', { error: err instanceof Error ? err.message : String(err) })
  }
  return result
}

export function resolveAgentStatus(
  bakinId: string,
  heartbeats: Record<string, unknown>,
  lastAuditActivity: Record<string, number>,
): {
  status: 'online' | 'working' | 'available' | 'offline'
  heartbeat: HeartbeatData | null
  heartbeatAge: number | null
} {
  const now = Date.now()
  const threshold = getStaleThresholdMs()

  // ── Heartbeat signal ──
  const hb = heartbeats[bakinId] as Record<string, unknown> | undefined
  const hbTs = (hb?.timestamp ?? hb?.ts) as string | undefined
  const hbTime = hbTs ? new Date(hbTs).getTime() : 0
  const hbAge = hbTs ? now - hbTime : null

  const heartbeat: HeartbeatData | null = hbTs
    ? { timestamp: hbTs, status: (hb!.status as string) ?? 'unknown', currentTask: hb!.currentTask as string | undefined }
    : null

  // ── Audit activity signal (fallback) ──
  const auditTime = lastAuditActivity[bakinId] ?? 0

  // Use whichever is more recent
  const lastSeen = Math.max(hbTime, auditTime)
  if (lastSeen === 0) {
    return { status: 'offline', heartbeat: null, heartbeatAge: null }
  }

  const age = now - lastSeen
  const effectiveAge = hbAge !== null ? Math.min(hbAge, age) : age

  if (age > threshold) {
    return { status: 'offline', heartbeat, heartbeatAge: effectiveAge }
  }

  // Working-state is GROUND TRUTH from the in-flight dispatch registry, not
  // the single-slot heartbeat file: at per-agent cap 2, turn A's settle
  // writes `idle` while turn B still runs — the chip must not lie
  // (same-agent-concurrency D7). Heartbeat demotes to liveness + task label.
  if (getInFlightTurnCount(bakinId) > 0) {
    return { status: 'working', heartbeat, heartbeatAge: effectiveAge }
  }

  // Within threshold — heartbeat still marks non-dispatch work (chat-driven
  // tool use) the registry can't see.
  if (hb?.status === 'working' || hb?.currentTask) {
    return { status: 'working', heartbeat, heartbeatAge: effectiveAge }
  }

  // Has recent audit activity but no "working" heartbeat — mark as online
  return { status: 'online', heartbeat, heartbeatAge: effectiveAge }
}

/** Get agent IDs that belong to a given team */
export async function getTeamMembers(runtime: AgentRuntimeAdapter, teamId: string): Promise<string[]> {
  const ds = await mergeDisplayDefaults(runtime, readDisplaySettings())
  return Object.entries(ds)
    .filter(([, s]) => s.teamId === teamId)
    .map(([id]) => id)
}

/** Get the full org structure: teams with their members */
export async function getOrgStructure(runtime: AgentRuntimeAdapter) {
  const teams = readTeams()
  const ds = await mergeDisplayDefaults(runtime, readDisplaySettings())
  const agents = await listRuntimeAgentMetas(runtime)
  const agentMap = new Map(agents.map((a) => [a.id, a]))

  return teams.map((team) => {
    const memberIds = Object.entries(ds)
      .filter(([, s]) => s.teamId === team.id)
      .map(([id]) => id)
    return {
      ...team,
      members: memberIds.map((id) => ({
        id,
        name: agentMap.get(id)?.name ?? id,
      })),
    }
  })
}
