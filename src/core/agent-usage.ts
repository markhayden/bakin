/**
 * Agent context/token usage reader.
 * Reads runtime session JSONL entries to extract per-agent token usage and cost.
 */
import { createLogger } from './logger'
import type { AgentRuntimeAdapter, RuntimeMemoryEntry } from '@bakin/core/adapters/runtime'
import { normalizeRunTokenEvidence } from '@bakin/core/execution/token-evidence'
// AgentUsage is single-homed in the SDK (the usage-panel wire shape);
// re-exported here so server callers keep importing it from one place.
import type { AgentUsage } from '@makinbakin/sdk/types'
export type { AgentUsage }

const log = createLogger('agent-usage')

const SESSION_JSONL_SOURCE_KIND = 'session_jsonl'
const AGENT_USAGE_READ_CONCURRENCY = 4
const WIRE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export type AgentUsageSource = {
  status: 'complete'
  reason: 'complete'
  failedAgents: []
} | {
  status: 'partial'
  reason: 'session_read_failures'
  failedAgents: string[]
} | {
  status: 'unavailable'
  reason: 'transcript_source_unavailable' | 'agent_roster_unavailable'
  failedAgents: []
}

export interface AgentUsageSnapshot {
  generatedAt: string
  source: AgentUsageSource
  sessions: AgentUsage[]
}

export interface SessionUsageCost {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  total?: number
}

interface SessionUsage {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens: number
  cost?: SessionUsageCost
  /** True only when the reported cost is a complete per-message total. */
  costComplete: boolean
}

/** One assistant message's usage, as read from a session JSONL line. */
export interface ParsedSessionMessage {
  /** Epoch ms of the message's own timestamp; null when absent/unparseable. */
  tsMs: number | null
  /**
   * Model that produced the message, provider-qualified (`provider/model`)
   * when the line carried the sibling `provider` field both runtimes write;
   * bare only when the transcript itself had no provider, '' when no model.
   */
  model: string
  /**
   * User messages attributed to this assistant message: the user turns since
   * the previous usage-bearing assistant message (#691 interaction evidence).
   */
  userMessages: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  /** Runtime-reported cost fields; null when the line carried none. */
  cost: SessionUsageCost | null
  /** False when cost contains only a known partial subtotal. */
  costComplete: boolean
}

export interface ParsedSessionUsage {
  sessionId: string
  sessionStarted: string
  messages: ParsedSessionMessage[]
  /** User turns after the last usage-bearing assistant message; bucket consumers attribute them to the session's latest bucket. */
  trailingUserMessages: number
  /** JSONL integrity for this read; partial results must not be published as totals. */
  integrity:
    | { status: 'complete'; malformedLines: 0 }
    | { status: 'partial'; malformedLines: number }
}

/**
 * Walk a session JSONL string and surface every assistant message's usage
 * with its own timestamp and model. The ONE parser behind both the
 * latest-session card (`parseSessionUsageContent`) and the usage-history
 * scanner — they must never drift. Valid messages survive a malformed line
 * for inspection, but integrity is explicitly partial so aggregate consumers
 * cannot mistake the surviving subset for the whole transcript.
 */
export function parseSessionUsageMessages(content: string): ParsedSessionUsage {
  const lines = content.split('\n').filter(l => l.trim())

  let sessionId = ''
  let sessionStarted = ''
  let malformedLines = 0
  let pendingUserMessages = 0
  const messages: ParsedSessionMessage[] = []

  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line)
      if (!isJsonObject(parsed)) {
        malformedLines++
        continue
      }
      if (typeof parsed.type !== 'string') {
        malformedLines++
        continue
      }
      if (parsed.type === 'session') {
        if (!isOptionalString(parsed.id) || !isOptionalString(parsed.timestamp)) {
          malformedLines++
          continue
        }
        const normalizedSessionStarted = normalizeWireTimestamp(parsed.timestamp)
        if (normalizedSessionStarted === null) {
          malformedLines++
          continue
        }
        sessionId = parsed.id ?? ''
        sessionStarted = normalizedSessionStarted
      }

      if (parsed.type === 'message') {
        if (
          !isJsonObject(parsed.message)
          || typeof parsed.message.role !== 'string'
          || !isOptionalString(parsed.timestamp)
        ) {
          malformedLines++
          continue
        }
        const normalizedMessageTimestamp = normalizeWireTimestamp(parsed.timestamp)
        if (normalizedMessageTimestamp === null) {
          malformedLines++
          continue
        }
        const messageTimestampMs = normalizedMessageTimestamp === ''
          ? null
          : timestampMs(normalizedMessageTimestamp)
        if (parsed.message.role === 'user') {
          pendingUserMessages++
          continue
        }
        if (parsed.message.role !== 'assistant') continue
        if (!isOptionalString(parsed.message.model) || !isOptionalString(parsed.message.provider)) {
          malformedLines++
          continue
        }
        // Assistant messages without usage are valid transcript rows, but do
        // not contribute metering evidence (and do not consume pending user
        // turns — those attribute to the next usage-bearing assistant message).
        if (parsed.message.usage == null) continue
        const u = validatedSessionUsage(parsed.message.usage)
        if (!u) {
          malformedLines++
          continue
        }
        const total = u.totalTokens
        if (!isNonNegativeSafeInteger(total)) {
          malformedLines++
          continue
        }
        const bareModel = parsed.message.model ?? ''
        const provider = parsed.message.provider ?? ''
        messages.push({
          tsMs: messageTimestampMs,
          model: provider && bareModel && !bareModel.includes('/')
            ? `${provider}/${bareModel}`
            : bareModel,
          userMessages: pendingUserMessages,
          tokens: {
            input: u.input,
            output: u.output,
            cacheRead: u.cacheRead ?? 0,
            cacheWrite: u.cacheWrite ?? 0,
            total,
          },
          cost: u.cost ?? null,
          costComplete: u.costComplete,
        })
        pendingUserMessages = 0
      }
    } catch {
      malformedLines++
    }
  }

  return {
    sessionId,
    sessionStarted,
    messages,
    trailingUserMessages: pendingUserMessages,
    integrity: malformedLines === 0
      ? { status: 'complete', malformedLines: 0 }
      : { status: 'partial', malformedLines },
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function validatedSessionUsage(value: unknown): SessionUsage | null {
  if (!isJsonObject(value)) return null
  const input = value.input
  const output = value.output
  const cacheRead = value.cacheRead
  const cacheWrite = value.cacheWrite
  const totalTokens = value.totalTokens
  if (
    !isNonNegativeSafeInteger(input)
    || !isNonNegativeSafeInteger(output)
    || !isOptionalNonNegativeSafeInteger(cacheRead)
    || !isOptionalNonNegativeSafeInteger(cacheWrite)
    || !isOptionalNonNegativeSafeInteger(totalTokens)
  ) return null

  const normalizedTokens = normalizeRunTokenEvidence('tokens', {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: totalTokens,
  })
  if (normalizedTokens.total === null) return null

  let cost: SessionUsageCost | undefined
  let costComplete = false
  const reportedCost = value.cost
  if (reportedCost != null) {
    if (!isJsonObject(reportedCost)) return null
    const costInput = reportedCost.input
    const costOutput = reportedCost.output
    const costCacheRead = reportedCost.cacheRead
    const costCacheWrite = reportedCost.cacheWrite
    const costTotal = reportedCost.total
    if (
      !isOptionalNonNegativeNumber(costInput)
      || !isOptionalNonNegativeNumber(costOutput)
      || !isOptionalNonNegativeNumber(costCacheRead)
      || !isOptionalNonNegativeNumber(costCacheWrite)
      || !isOptionalNonNegativeNumber(costTotal)
    ) return null
    const componentCosts = [costInput, costOutput, costCacheRead, costCacheWrite]
    if (costTotal !== undefined || componentCosts.some((component) => component !== undefined)) {
      cost = {
        input: costInput,
        output: costOutput,
        cacheRead: costCacheRead,
        cacheWrite: costCacheWrite,
        total: costTotal,
      }
      costComplete = costTotal !== undefined || [
        [normalizedTokens.input, costInput],
        [normalizedTokens.output, costOutput],
        [normalizedTokens.cacheRead, costCacheRead],
        [normalizedTokens.cacheWrite, costCacheWrite],
      ].every(([tokens, component]) => (tokens ?? 0) === 0 || component !== undefined)
    }
  }

  return {
    input: normalizedTokens.input!,
    output: normalizedTokens.output!,
    cacheRead: normalizedTokens.cacheRead ?? undefined,
    cacheWrite: normalizedTokens.cacheWrite ?? undefined,
    totalTokens: normalizedTokens.total,
    cost,
    costComplete,
  }
}

function isOptionalNonNegativeNumber(value: unknown): value is number | undefined {
  return value === undefined
    || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

function isOptionalNonNegativeSafeInteger(value: unknown): value is number | undefined {
  return value === undefined || isNonNegativeSafeInteger(value)
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

type SessionUsageReadResult =
  | { status: 'complete'; usage: AgentUsage | null }
  | { status: 'partial'; usage: null }

/**
 * Parse a session JSONL string and sum up usage across all assistant messages.
 * Returns null rather than publishing a partial total when any JSONL line is
 * malformed.
 */
export function parseSessionUsageContent(content: string, agentName: string): AgentUsage | null {
  return readSessionUsageContent(content, agentName).usage
}

function readSessionUsageContent(content: string, agentName: string): SessionUsageReadResult {
  try {
    const parsed = parseSessionUsageMessages(content)
    if (parsed.integrity.status === 'partial') {
      log.debug('Withholding partial session usage', {
        agentName,
        malformedLines: parsed.integrity.malformedLines,
      })
      return { status: 'partial', usage: null }
    }
    const { sessionId, sessionStarted, messages } = parsed

    let model = ''
    let messageCount = 0
    let costedMessages = 0
    let lastMessageMs: number | null = null
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    const costValues = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    const costSeen = { input: false, output: false, cacheRead: false, cacheWrite: false, total: false }

    for (const msg of messages) {
      messageCount++
      if (msg.model) model = msg.model
      if (msg.tsMs !== null && (lastMessageMs === null || msg.tsMs > lastMessageMs)) {
        lastMessageMs = msg.tsMs
      }

      tokens.input += msg.tokens.input
      tokens.output += msg.tokens.output
      tokens.cacheRead += msg.tokens.cacheRead
      tokens.cacheWrite += msg.tokens.cacheWrite
      tokens.total += msg.tokens.total

      if (msg.cost) {
        if (addUsageCost(costValues, costSeen, msg.cost) && msg.costComplete) costedMessages++
      }
    }

    if (!Object.values(tokens).every(isNonNegativeSafeInteger)) {
      return { status: 'partial', usage: null }
    }
    if (!Object.values(costValues).every(isNonNegativeFiniteNumber)) {
      return { status: 'partial', usage: null }
    }

    if (messageCount === 0) return { status: 'complete', usage: null }

    const hasAnyComponentCost = costSeen.input || costSeen.output || costSeen.cacheRead || costSeen.cacheWrite
    const hasAnyCost = hasAnyComponentCost || costSeen.total

    const usage: AgentUsage = {
      agent: agentName,
      sessionId,
      sessionStarted,
      lastMessageAt: lastMessageMs === null ? null : new Date(lastMessageMs).toISOString(),
      model,
      messages: messageCount,
      costedMessages,
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
    return { status: 'complete', usage }
  } catch (err) {
    log.debug('Failed to parse session usage', { agentName, error: err instanceof Error ? err.message : String(err) })
    return { status: 'partial', usage: null }
  }
}

type CostField = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'total'

function addUsageCost(
  values: Record<CostField, number>,
  seen: Record<CostField, boolean>,
  cost: SessionUsageCost,
): boolean {
  const componentValues = [
    addCostField(values, seen, 'input', cost.input),
    addCostField(values, seen, 'output', cost.output),
    addCostField(values, seen, 'cacheRead', cost.cacheRead),
    addCostField(values, seen, 'cacheWrite', cost.cacheWrite),
  ]
  const hasExplicitTotal = addCostField(values, seen, 'total', cost.total)
  if (hasExplicitTotal !== null) return true

  const knownComponents = componentValues.filter((value): value is number => value !== null)
  if (knownComponents.length === 0) return false
  values.total += knownComponents.reduce((sum, value) => sum + value, 0)
  seen.total = true
  return true
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
 * Get an evidence-qualified snapshot of every agent's most recent session.
 */
export async function getAgentUsageSnapshot(runtime: AgentRuntimeAdapter): Promise<AgentUsageSnapshot> {
  const generatedAt = new Date().toISOString()
  let tierId: string | null
  try {
    const tiers = await runtime.memory.listTiers()
    tierId = tiers.find((tier) => tier.metadata?.sourceKind === SESSION_JSONL_SOURCE_KIND)?.id ?? null
  } catch (err) {
    log.debug('Failed to discover runtime session transcript tier for usage', {
      error: err instanceof Error ? err.message : String(err),
    })
    tierId = null
  }
  if (!tierId) {
    return {
      generatedAt,
      source: { status: 'unavailable', reason: 'transcript_source_unavailable', failedAgents: [] },
      sessions: [],
    }
  }

  let agents: Awaited<ReturnType<AgentRuntimeAdapter['agents']['list']>>
  try {
    agents = await runtime.agents.list()
  } catch (err) {
    log.debug('Failed to list runtime agents for usage', {
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      generatedAt,
      source: { status: 'unavailable', reason: 'agent_roster_unavailable', failedAgents: [] },
      sessions: [],
    }
  }

  const outcomes = await mapWithConcurrency(agents, AGENT_USAGE_READ_CONCURRENCY, async (agent) => {
    const latest = await getLatestSessionEntry(runtime, tierId, agent.id)
    const parsed = latest.entry
      ? readSessionUsageContent(latest.entry.content, agent.id)
      : { status: 'complete' as const, usage: null }
    return {
      agent: agent.id,
      failed: latest.failed || parsed.status === 'partial',
      usage: parsed.usage,
    }
  })
  const failedAgents = outcomes.filter((outcome) => outcome.failed).map((outcome) => outcome.agent).sort()
  const sessions = outcomes
    .flatMap((outcome) => outcome.usage ? [outcome.usage] : [])
    .sort((a, b) => b.tokens.total - a.tokens.total || a.agent.localeCompare(b.agent))

  return {
    generatedAt,
    source: failedAgents.length > 0
      ? { status: 'partial', reason: 'session_read_failures', failedAgents }
      : { status: 'complete', reason: 'complete', failedAgents: [] },
    sessions,
  }
}

/** Legacy array projection retained for existing Team and API consumers. */
export async function getAllAgentUsage(runtime: AgentRuntimeAdapter): Promise<AgentUsage[]> {
  return (await getAgentUsageSnapshot(runtime)).sessions
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
): Promise<{ entry: RuntimeMemoryEntry | null; failed: boolean }> {
  let entries: RuntimeMemoryEntry[]
  try {
    entries = await runtime.memory.listEntries(tierId, { agentId })
  } catch (err) {
    log.debug('Failed to list runtime sessions for usage', { agentId, error: err instanceof Error ? err.message : String(err) })
    return { entry: null, failed: true }
  }

  const candidates = entries.filter((entry) =>
    !entry.id.includes('.deleted') && !entry.path?.includes('.deleted'))
  if (candidates.length === 0) return { entry: null, failed: false }

  const metadataRanked = candidates
    .map((entry) => ({ entry, ts: timestampMs(entry.updatedAt) }))
    .filter((candidate): candidate is { entry: RuntimeMemoryEntry; ts: number } => candidate.ts !== null)
    .sort((left, right) => right.ts - left.ts || left.entry.id.localeCompare(right.entry.id))
  if (metadataRanked.length === candidates.length) {
    const selected = metadataRanked[0].entry
    return readStableSessionEntry(runtime, tierId, selected.id, agentId)
  }

  // Compatibility fallback for adapters that do not yet publish lightweight
  // entry timestamps. Current bundled adapters avoid this exhaustive path.
  let latest: { entry: RuntimeMemoryEntry; ts: number } | null = null
  let failed = false
  for (const entry of candidates) {
    const read = await readStableSessionEntry(runtime, tierId, entry.id, agentId)
    if (read.failed || !read.entry) {
      failed = true
      continue
    }
    const full = read.entry
    const ts = sessionTimestamp(full.content) ?? timestampMs(full.updatedAt) ?? timestampMs(entry.updatedAt) ?? 0
    if (!latest || ts > latest.ts) latest = { entry: full, ts }
  }

  return { entry: failed ? null : latest?.entry ?? null, failed }
}

async function readStableSessionEntry(
  runtime: AgentRuntimeAdapter,
  tierId: string,
  sessionId: string,
  agentId: string,
): Promise<{ entry: RuntimeMemoryEntry | null; failed: boolean }> {
  let statBefore: Awaited<ReturnType<AgentRuntimeAdapter['memory']['statEntry']>>
  try {
    statBefore = await runtime.memory.statEntry(tierId, sessionId, { agentId })
  } catch (err) {
    log.debug('Failed to stat runtime session before usage read', {
      agentId,
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { entry: null, failed: true }
  }

  let entry: RuntimeMemoryEntry | null
  try {
    entry = await runtime.memory.getEntry(tierId, sessionId, { agentId })
  } catch (err) {
    log.debug('Failed to read runtime session for usage', {
      agentId,
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { entry: null, failed: true }
  }
  if (!entry) return { entry: null, failed: true }

  let statAfter: Awaited<ReturnType<AgentRuntimeAdapter['memory']['statEntry']>>
  try {
    statAfter = await runtime.memory.statEntry(tierId, sessionId, { agentId })
  } catch (err) {
    log.debug('Failed to stat runtime session after usage read', {
      agentId,
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { entry: null, failed: true }
  }

  if (!sameEntryGeneration(statBefore, statAfter)) {
    log.debug('Withholding runtime session that changed during usage read', { agentId, sessionId })
    return { entry: null, failed: true }
  }
  if (statAfter && Buffer.byteLength(entry.content, 'utf-8') !== statAfter.size) {
    log.debug('Withholding runtime session whose content does not match its file generation', {
      agentId,
      sessionId,
    })
    return { entry: null, failed: true }
  }

  return { entry, failed: false }
}

function sameEntryGeneration(
  before: Awaited<ReturnType<AgentRuntimeAdapter['memory']['statEntry']>>,
  after: Awaited<ReturnType<AgentRuntimeAdapter['memory']['statEntry']>>,
): boolean {
  // Bundled and third-party runtimes use null when entry stats are
  // unavailable. Preserve that compatibility only when both probes agree;
  // one-sided metadata is contradictory evidence, not a stable generation.
  if (!before || !after) return before === after
  return before.mtimeMs === after.mtimeMs && before.size === after.size
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  const workers = Array.from({ length: Math.min(values.length, concurrency) }, async () => {
    while (next < values.length) {
      const index = next++
      results[index] = await map(values[index])
    }
  })
  await Promise.all(workers)
  return results
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

function normalizeWireTimestamp(value: string | undefined): string | null {
  if (value === undefined) return ''
  const ms = timestampMs(value)
  if (ms === null) return null
  const normalized = new Date(ms).toISOString()
  return WIRE_TIMESTAMP_RE.test(normalized) ? normalized : null
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
