/**
 * OpenClaw agent-turn I/O — building the CLI prompt from a message list,
 * normalizing the tool allow-list, and extracting the assistant text + token
 * usage from the gateway/CLI turn response. Pure parsing/formatting over the
 * turn payload; the adapter's turn methods own the exec + session wiring.
 */
import type { MessageUsage, RuntimeMetadata } from '@bakin/core/adapters/runtime'
import { getJsonPath, isPlainObject, parseJsonObject } from './runtime-utils'

export function oversizedOutputBytesFrom(metadata: RuntimeMetadata | undefined): number | undefined {
  const value = metadata?.oversizedOutputBytes
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

export function messagesToOpenClawPrompt(messages: Array<{ role: string; content: string }>): string {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())
  if (lastUser) return lastUser.content
  return messages.map((message) => message.content).filter(Boolean).join('\n\n')
}

export function normalizeToolList(value: string[] | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const tools: string[] = []
  for (const entry of value) {
    const tool = typeof entry === 'string' ? entry.trim() : ''
    if (!tool || seen.has(tool)) continue
    seen.add(tool)
    tools.push(tool)
  }
  return tools.length > 0 ? tools : undefined
}

export function extractOpenClawAgentText(value: unknown): string {
  const parsed = typeof value === 'string' ? parseJsonObject(value.trim()) ?? value.trim() : value
  if (!parsed) return ''
  if (typeof parsed === 'string') return parsed

  const finalVisible = getJsonPath(parsed, ['result', 'meta', 'finalAssistantVisibleText'])
  if (typeof finalVisible === 'string') return finalVisible
  const finalRaw = getJsonPath(parsed, ['result', 'meta', 'finalAssistantRawText'])
  if (typeof finalRaw === 'string') return finalRaw
  const payloads = getJsonPath(parsed, ['result', 'payloads'])
  if (Array.isArray(payloads)) {
    return payloads
      .map((payload) => isPlainObject(payload) && typeof payload.text === 'string' ? payload.text : '')
      .filter(Boolean)
      .join('\n\n')
  }
  const summary = getJsonPath(parsed, ['summary'])
  return typeof summary === 'string' ? summary : ''
}

export function extractOpenClawAgentUsage(value: unknown): MessageUsage | undefined {
  const parsed = typeof value === 'string' ? parseJsonObject(value.trim()) : value
  if (!parsed) return undefined
  const usage = getJsonPath(parsed, ['result', 'meta', 'agentMeta', 'usage'])
  if (!isPlainObject(usage)) return undefined
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const out: MessageUsage = {}
  const input = num(usage.input); if (input !== undefined) out.input = input
  const output = num(usage.output); if (output !== undefined) out.output = output
  const total = num(usage.total); if (total !== undefined) out.total = total
  const cacheRead = num(usage.cacheRead); if (cacheRead !== undefined) out.cacheRead = cacheRead
  const cacheWrite = num(usage.cacheWrite); if (cacheWrite !== undefined) out.cacheWrite = cacheWrite
  // Require the input/output split for the result to be priceable. A
  // total-only block isn't — returning it would short-circuit the trajectory
  // fallback (which may carry the split), leaving the turn unmetered.
  return out.input !== undefined || out.output !== undefined ? out : undefined
}
