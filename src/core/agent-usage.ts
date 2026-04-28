/**
 * Agent context/token usage reader.
 * Reads runtime session JSONL entries to extract per-agent token usage and cost.
 */
import { createLogger } from './logger'
import type { AgentRuntimeAdapter, RuntimeMemoryEntry } from '@bakin/core/adapters/runtime'

const log = createLogger('agent-usage')

const SESSION_JSONL_SOURCE_KIND = 'session_jsonl'

export interface AgentUsage {
  agent: string
  sessionId: string
  sessionStarted: string
  model: string
  messages: number
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}

interface SessionMessage {
  type: string
  id?: string
  timestamp?: string
  message?: {
    role?: string
    model?: string
    usage?: {
      input?: number
      output?: number
      cacheRead?: number
      cacheWrite?: number
      totalTokens?: number
      cost?: {
        input?: number
        output?: number
        cacheRead?: number
        cacheWrite?: number
        total?: number
      }
    }
  }
}

/**
 * Parse a session JSONL string and sum up usage across all assistant messages.
 */
export function parseSessionUsageContent(content: string, agentName: string): AgentUsage | null {
  try {
    const lines = content.split('\n').filter(l => l.trim())

    let sessionId = ''
    let sessionStarted = ''
    let model = ''
    let messageCount = 0
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as SessionMessage

        if (entry.type === 'session') {
          sessionId = entry.id || ''
          sessionStarted = entry.timestamp || ''
        }

        if (entry.type === 'message' && entry.message?.role === 'assistant' && entry.message.usage) {
          messageCount++
          const u = entry.message.usage
          if (entry.message.model) model = entry.message.model

          tokens.input += u.input || 0
          tokens.output += u.output || 0
          tokens.cacheRead += u.cacheRead || 0
          tokens.cacheWrite += u.cacheWrite || 0
          tokens.total += u.totalTokens || 0

          if (u.cost) {
            cost.input += u.cost.input || 0
            cost.output += u.cost.output || 0
            cost.cacheRead += u.cost.cacheRead || 0
            cost.cacheWrite += u.cost.cacheWrite || 0
            cost.total += u.cost.total || 0
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (messageCount === 0) return null

    return {
      agent: agentName,
      sessionId,
      sessionStarted,
      model,
      messages: messageCount,
      tokens,
      cost,
    }
  } catch (err) {
    log.debug('Failed to parse session usage', { agentName, error: err instanceof Error ? err.message : String(err) })
    return null
  }
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

async function getSessionJsonlTierId(runtime: AgentRuntimeAdapter): Promise<string | null> {
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
