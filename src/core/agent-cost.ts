/**
 * Per-turn cost attribution, shared by every Bakin-side agent send (dispatch
 * task turns AND non-dispatch sends: watchdog, doctor, orchestrator,
 * task-service). Without this, a budget cap would only bound dispatched task
 * spend and a runaway non-dispatch loop would be uncapped (#464 / review #2).
 *
 * Pricing is delegated to the models plugin via the `models.priceTurn` hook
 * so core stays pricing-agnostic; absent plugin → null cost (unmetered,
 * never a fabricated zero). The same data feeds the live usage recorder.
 * Never throws — a metering failure must not fail the turn that succeeded.
 */
import { randomUUID } from 'crypto'

import { createLogger } from './logger'
import type { MessageResult } from '@bakin/core/adapters/runtime'
import { normalizeRunCostUsdMicros, normalizeRunTokenEvidence } from '@bakin/core/execution/token-evidence'
import type { ActivityClass } from '@makinbakin/sdk/types'

const log = createLogger('agent-cost')

// Ledger / usage / hook deps are imported dynamically (not statically) so the
// many modules that now meter their sends — task-service, doctor, watchdog,
// agents — don't pull the execution ledger into their static import graph.
// That keeps existing tests (which mock the ledger facade with a subset of
// verbs) from breaking at load; a missing export simply no-ops inside the
// try/catch below. Modules are cached after first import — negligible cost.

/** Dynamically load the hook registry (see note above on why it's dynamic). */
async function loadHooks() {
  return (await import('@bakin/core/hooks/hook-registry-singleton')).getHookRegistry()
}

/**
 * Single writer for both meter paths: persist one durable run_costs row + one
 * live usage-recorder entry. Single-sourced so the two callers can't drift on
 * the budget-cap's spend contract. Never throws.
 */
async function recordSpend(e: {
  runId: string
  taskId?: string | null
  agent: string
  activityClass: ActivityClass
  model?: string | null
  /** Billing attribution from the pricing hook; null when unattributed. */
  provider?: string | null
  lane?: 'metered' | 'subscription' | null
  usageKind: 'tokens' | 'media'
  costUsdMicros: number | null
  /** Usage-recorder entry name (e.g. 'turn', 'image'). */
  name: string
  tokens?: { input?: number; output?: number; total?: number; cacheRead?: number; cacheWrite?: number }
  /** Extra recorder meta (e.g. image count). */
  meta?: Record<string, unknown>
}): Promise<void> {
  try {
    const [{ recordRunCost }, { recordUsage }] = await Promise.all([
      import('./execution-ledger'),
      import('./usage'),
    ])
    const tokens = normalizeRunTokenEvidence(e.usageKind, e.tokens)
    const costUsdMicros = normalizeRunCostUsdMicros(e.costUsdMicros)
    recordRunCost({
      runId: e.runId,
      taskId: e.taskId ?? null,
      agent: e.agent,
      model: e.model ?? undefined,
      provider: e.provider ?? null,
      lane: e.lane ?? null,
      usageKind: e.usageKind,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      totalTokens: tokens.total,
      cacheReadTokens: tokens.cacheRead,
      cacheWriteTokens: tokens.cacheWrite,
      costUsdMicros,
      occurredAt: Date.now(),
    })
    recordUsage({
      kind: 'agent',
      activityClass: e.activityClass,
      name: e.name,
      agent: e.agent,
      durationMs: null,
      status: 'ok',
      ...(tokens.input !== null ? { tokensIn: tokens.input } : {}),
      ...(tokens.output !== null ? { tokensOut: tokens.output } : {}),
      ...(tokens.cacheRead !== null ? { tokensCacheRead: tokens.cacheRead } : {}),
      ...(tokens.cacheWrite !== null ? { tokensCacheWrite: tokens.cacheWrite } : {}),
      ...(costUsdMicros !== null ? { costUsdMicros } : {}),
      meta: { ...(e.taskId ? { taskId: e.taskId } : {}), ...(e.model ? { model: e.model } : {}), ...(e.meta ?? {}) },
    })
  } catch (err) {
    log.error('Failed to record spend event', err, { agent: e.agent, runId: e.runId })
  }
}

export async function meterAgentTurn(opts: {
  /** Ledger run id for dispatched turns (== threadId); omit for non-dispatch
   *  sends, which get a synthetic id (they aren't retried at this layer). */
  runId?: string
  /** Owning task for dispatched turns; null/omitted for non-dispatch sends. */
  taskId?: string | null
  agent: string
  /** Producer-assigned intent; automatic notifications are system work. */
  activityClass: ActivityClass
  result: MessageResult
  /** Model dispatch routed this turn to, if any — used only when the runtime
   *  didn't report the model it actually ran. */
  resolvedModel?: string
  /** Usage-recorder entry name (default 'turn'). */
  name?: string
}): Promise<void> {
  try {
    const usage = opts.result.usage
    // Prefer the model the runtime ACTUALLY ran (from usage) over the one we
    // requested — a per-turn override the provider rejected/fell back from
    // must be priced against what ran, not what we asked for (review #3).
    const ranModel = usage?.model ?? opts.resolvedModel
    let priced: {
      model: string | null; provider?: string | null; lane?: 'metered' | 'subscription' | null; costUsdMicros: number | null
    } | undefined
    try {
      priced = await (await loadHooks()).invoke(
        'models.priceTurn',
        { agentId: opts.agent, model: ranModel, input: usage?.input, output: usage?.output, cacheRead: usage?.cacheRead, cacheWrite: usage?.cacheWrite },
      )
    } catch (err) {
      log.error('Failed to price agent turn; recording unpriced usage', err, { agent: opts.agent, runId: opts.runId })
    }
    await recordSpend({
      runId: opts.runId ?? `turn:${randomUUID()}`,
      taskId: opts.taskId,
      agent: opts.agent,
      activityClass: opts.activityClass,
      // Prefer the hook's NORMALIZED id (it resolves from ranModel) — spend
      // facets and rule scopeIds must key identically or model-scoped caps
      // read zero spend. Raw ranModel is the no-plugin fallback only.
      model: priced?.model ?? ranModel ?? null,
      provider: priced?.provider ?? null,
      lane: priced?.lane ?? null,
      usageKind: 'tokens',
      costUsdMicros: priced?.costUsdMicros ?? null,
      name: opts.name ?? 'turn',
      tokens: { input: usage?.input, output: usage?.output, total: usage?.total, cacheRead: usage?.cacheRead, cacheWrite: usage?.cacheWrite },
      meta: {
        resultId: opts.result.id,
        ...(typeof opts.result.metadata?.adapterTurnId === 'string'
          ? { turnId: opts.result.metadata.adapterTurnId }
          : {}),
      },
    })
  } catch (err) {
    log.error('Failed to meter agent turn', err, { agent: opts.agent, runId: opts.runId })
  }
}

/**
 * Record the cost of an image generation/edit as a spend event (no tokens;
 * cost from the flat per-image rate via models.priceImage). Counts toward the
 * budget cap like any other run. Unpriced models record the run with null
 * cost. Never throws.
 */
export async function meterImageTurn(opts: {
  agent: string
  activityClass: ActivityClass
  /** `provider/model` of the image generation. */
  model: string
  /** Number of images generated (billed count). */
  count: number
  taskId?: string | null
}): Promise<void> {
  try {
    let priced: {
      model: string | null; provider?: string | null; lane?: 'metered' | 'subscription' | null; costUsdMicros: number | null
    } | undefined
    try {
      priced = await (await loadHooks()).invoke(
        'models.priceImage',
        { model: opts.model, count: opts.count },
      )
    } catch (err) {
      log.error('Failed to price image turn; recording unpriced usage', err, { agent: opts.agent, model: opts.model })
    }
    await recordSpend({
      runId: `image:${randomUUID()}`,
      taskId: opts.taskId,
      agent: opts.agent,
      activityClass: opts.activityClass,
      // Hook-normalized id preferred — same keying rule as chat turns.
      model: priced?.model ?? opts.model,
      provider: priced?.provider ?? null,
      lane: priced?.lane ?? null,
      usageKind: 'media',
      costUsdMicros: priced?.costUsdMicros ?? null,
      name: 'image',
      meta: { count: opts.count },
    })
  } catch (err) {
    log.error('Failed to meter image turn', err, { agent: opts.agent, model: opts.model })
  }
}
