/**
 * Agent context/token usage reader.
 * Reads runtime session JSONL entries to extract per-agent token usage and cost.
 */
import { createLogger } from './logger'
import type { AgentRuntimeAdapter, RuntimeMemoryEntry } from '@bakin/core/adapters/runtime'
// AgentUsage is single-homed in the SDK (the usage-panel wire shape);
// re-exported here so server callers keep importing it from one place.
import type { AgentUsage } from '@makinbakin/sdk/types'
export type { AgentUsage }

const log = createLogger('agent-usage')

const SESSION_JSONL_SOURCE_KIND = 'session_jsonl'

export interface SessionUsageCost {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  total?: number
}

interface SessionUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
  cost?: SessionUsageCost
}

interface SessionMessage {
  type: string
  id?: string
  timestamp?: string
  message?: {
    role?: string
    model?: string
    usage?: SessionUsage
  }
}

/** One assistant message's usage, as read from a session JSONL line. */
export interface ParsedSessionMessage {
  /** Epoch ms of the message's own timestamp; null when absent/unparseable. */
  tsMs: number | null
  /** Model that produced the message; '' when the line had no model field. */
  model: string
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  /** Runtime-reported cost fields; null when the line carried none. */
  cost: SessionUsageCost | null
}

export interface ParsedSessionUsage {
  sessionId: string
  sessionStarted: string
  messages: ParsedSessionMessage[]
}

/**
 * Walk a session JSONL string and surface every assistant message's usage
 * with its own timestamp and model. The ONE parser behind both the
 * latest-session card (`parseSessionUsageContent`) and the usage-history
 * scanner — they must never drift. Malformed lines are skipped, never fatal.
 */
export function parseSessionUsageMessages(content: string): ParsedSessionUsage {
  const lines = content.split('\n').filter(l => l.trim())

  let sessionId = ''
  let sessionStarted = ''
  const messages: ParsedSessionMessage[] = []

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as SessionMessage

      if (entry.type === 'session') {
        sessionId = entry.id || ''
        sessionStarted = entry.timestamp || ''
      }

      if (entry.type === 'message' && entry.message?.role === 'assistant' && entry.message.usage) {
        const u = entry.message.usage
        messages.push({
          tsMs: timestampMs(entry.timestamp),
          model: entry.message.model || '',
          tokens: {
            input: u.input ?? 0,
            output: u.output ?? 0,
            cacheRead: u.cacheRead ?? 0,
            cacheWrite: u.cacheWrite ?? 0,
            total: u.totalTokens ?? (
              (u.input ?? 0)
              + (u.output ?? 0)
              + (u.cacheRead ?? 0)
              + (u.cacheWrite ?? 0)
            ),
          },
          cost: u.cost ?? null,
        })
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { sessionId, sessionStarted, messages }
}

/**
 * Parse a session JSONL string and sum up usage across all assistant messages.
 */
export function parseSessionUsageContent(content: string, agentName: string): AgentUsage | null {
  try {
    const { sessionId, sessionStarted, messages } = parseSessionUsageMessages(content)

    let model = ''
    let messageCount = 0
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    const costValues = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    const costSeen = { input: false, output: false, cacheRead: false, cacheWrite: false, total: false }

    for (const msg of messages) {
      messageCount++
      if (msg.model) model = msg.model

      tokens.input += msg.tokens.input
      tokens.output += msg.tokens.output
      tokens.cacheRead += msg.tokens.cacheRead
      tokens.cacheWrite += msg.tokens.cacheWrite
      tokens.total += msg.tokens.total

      if (msg.cost) {
        addUsageCost(costValues, costSeen, msg.cost)
      }
    }

    if (messageCount === 0) return null

    const hasAnyComponentCost = costSeen.input || costSeen.output || costSeen.cacheRead || costSeen.cacheWrite
    const hasAnyCost = hasAnyComponentCost || costSeen.total

    return {
      agent: agentName,
      sessionId,
      sessionStarted,
      model,
      messages: messageCount,
      tokens,
      cost: {
        input: costSeen.input ? costValues.input : null,
        output: costSeen.output ? costValues.output : null,
        cacheRead: costSeen.cacheRead ? costValues.cacheRead : null,
        cacheWrite: costSeen.cacheWrite ? costValues.cacheWrite : null,
        total: costSeen.total ? costValues.total : null,
        source: hasAnyCost ? 'runtime' : 'unavailable',
      },
    }
  } catch (err) {
    log.debug('Failed to parse session usage', { agentName, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

type CostField = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'total'

function addUsageCost(
  values: Record<CostField, number>,
  seen: Record<CostField, boolean>,
  cost: SessionUsageCost,
) {
  const componentValues = [
    addCostField(values, seen, 'input', cost.input),
    addCostField(values, seen, 'output', cost.output),
    addCostField(values, seen, 'cacheRead', cost.cacheRead),
    addCostField(values, seen, 'cacheWrite', cost.cacheWrite),
  ]
  const hasExplicitTotal = addCostField(values, seen, 'total', cost.total)
  if (hasExplicitTotal !== null) return

  const knownComponents = componentValues.filter((value): value is number => value !== null)
  if (knownComponents.length === 0) return
  values.total += knownComponents.reduce((sum, value) => sum + value, 0)
  seen.total = true
}

function addCostField(
  values: Record<CostField, number>,
  seen: Record<CostField, boolean>,
  field: CostField,
  value: number | undefined,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  values[field] += value
  seen[field] = true
  return value
}

/**
 * Get usage stats for all agents' most recent sessions.
 */
export async function getAllAgentUsage(runtime: AgentRuntimeAdapter): Promise<AgentUsage[]> {
  const results: AgentUsage[] = []

  const tierId = await getSessionJsonlTierId(runtime)
  if (!tierId) return results

  let agents
  try {
    agents = await runtime.agents.list()
  } catch (err) {
    log.debug('Failed to list runtime agents for usage', { error: err instanceof Error ? err.message : String(err) })
    return results
  }

  for (const agent of agents) {
    const latest = await getLatestSessionEntry(runtime, tierId, agent.id)
    if (!latest) continue

    const usage = parseSessionUsageContent(latest.content, agent.id)
    if (usage) results.push(usage)
  }

  return results.sort((a, b) => b.tokens.total - a.tokens.total)
}

/** Discover the runtime's session-transcript memory tier (shared with the usage-history scanner). */
export async function getSessionJsonlTierId(runtime: AgentRuntimeAdapter): Promise<string | null> {
  try {
    const tiers = await runtime.memory.listTiers()
    return tiers.find((tier) => tier.metadata?.sourceKind === SESSION_JSONL_SOURCE_KIND)?.id ?? null
  } catch (err) {
    log.debug('Failed to discover runtime session transcript tier for usage', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

async function getLatestSessionEntry(
  runtime: AgentRuntimeAdapter,
  tierId: string,
  agentId: string,
): Promise<RuntimeMemoryEntry | null> {
  let entries: RuntimeMemoryEntry[]
  try {
    entries = await runtime.memory.listEntries(tierId, { agentId })
  } catch (err) {
    log.debug('Failed to list runtime sessions for usage', { agentId, error: err instanceof Error ? err.message : String(err) })
    return null
  }

  let latest: { entry: RuntimeMemoryEntry; ts: number } | null = null
  for (const entry of entries) {
    if (entry.id.includes('.deleted') || entry.path?.includes('.deleted')) continue
    let full: RuntimeMemoryEntry | null
    try {
      full = await runtime.memory.getEntry(tierId, entry.id, { agentId })
    } catch (err) {
      log.debug('Failed to read runtime session for usage', { agentId, sessionId: entry.id, error: err instanceof Error ? err.message : String(err) })
      continue
    }
    if (!full) continue
    const ts = sessionTimestamp(full.content) ?? timestampMs(full.updatedAt) ?? timestampMs(entry.updatedAt) ?? 0
    if (!latest || ts > latest.ts) latest = { entry: full, ts }
  }

  return latest?.entry ?? null
}

function sessionTimestamp(content: string): number | null {
  const firstLine = content.split('\n').find((line) => line.trim())
  if (!firstLine) return null
  try {
    const entry = JSON.parse(firstLine) as { timestamp?: string }
    return timestampMs(entry.timestamp)
  } catch {
    return null
  }
}

function timestampMs(value: string | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}
