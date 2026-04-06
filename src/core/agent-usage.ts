/**
 * Agent context/token usage reader.
 * Reads OpenClaw session JSONL files to extract per-agent token usage and cost.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'
import { getOpenClawPath } from '@bakin/core/openclaw-home'

const log = createLogger('agent-usage')

const OPENCLAW_AGENTS_DIR = getOpenClawPath('agents')

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
 * Get the most recent session file for an agent.
 */
function getLatestSession(agentDir: string): string | null {
  const sessionsDir = join(agentDir, 'sessions')
  try {
    const candidates = readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl') && !f.includes('.deleted'))

    // Read the session timestamp from the first line of each file to find
    // the most recent session. File mtime is unreliable — sessions can be
    // touched out of order.
    let latest: { path: string; ts: number } | null = null
    for (const f of candidates) {
      const filePath = join(sessionsDir, f)
      try {
        const firstLine = readFileSync(filePath, 'utf-8').split('\n')[0]
        const entry = JSON.parse(firstLine)
        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0
        if (!latest || ts > latest.ts) {
          latest = { path: filePath, ts }
        }
      } catch {
        // Fall back to mtime if first line is unparseable
        const mtime = statSync(filePath).mtimeMs
        if (!latest || mtime > latest.ts) {
          latest = { path: filePath, ts: mtime }
        }
      }
    }

    return latest?.path ?? null
  } catch {
    return null
  }
}

/**
 * Parse a session JSONL file and sum up usage across all assistant messages.
 */
function parseSessionUsage(filePath: string, agentName: string): AgentUsage | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
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
          sessionId = (entry as any).id || ''
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
    log.debug('Failed to parse session', { filePath, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/**
 * Get usage stats for all agents' most recent sessions.
 */
export function getAllAgentUsage(): AgentUsage[] {
  const results: AgentUsage[] = []

  try {
    const agents = readdirSync(OPENCLAW_AGENTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)

    for (const agent of agents) {
      const agentDir = join(OPENCLAW_AGENTS_DIR, agent)
      const sessionFile = getLatestSession(agentDir)
      if (!sessionFile) continue

      const usage = parseSessionUsage(sessionFile, agent)
      if (usage) results.push(usage)
    }
  } catch {
    // ~/.openclaw/agents/ doesn't exist or not readable
  }

  return results.sort((a, b) => b.tokens.total - a.tokens.total)
}
