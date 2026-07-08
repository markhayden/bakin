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
  model?: string | null
  /** Billing attribution from the pricing hook; null when unattributed. */
  provider?: string | null
  lane?: 'metered' | 'subscription' | null
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
    recordRunCost({
      runId: e.runId,
      taskId: e.taskId ?? null,
      agent: e.agent,
      model: e.model ?? undefined,
      provider: e.provider ?? null,
      lane: e.lane ?? null,
      inputTokens: e.tokens?.input ?? null,
      outputTokens: e.tokens?.output ?? null,
      totalTokens: e.tokens?.total ?? null,
      cacheReadTokens: e.tokens?.cacheRead ?? null,
      cacheWriteTokens: e.tokens?.cacheWrite ?? null,
      costUsdMicros: e.costUsdMicros,
      occurredAt: Date.now(),
    })
    recordUsage({
      kind: 'agent',
      name: e.name,
      agent: e.agent,
      durationMs: null,
      status: 'ok',
      ...(e.tokens?.input !== undefined ? { tokensIn: e.tokens.input } : {}),
      ...(e.tokens?.output !== undefined ? { tokensOut: e.tokens.output } : {}),
      ...(e.tokens?.cacheRead !== undefined ? { tokensCacheRead: e.tokens.cacheRead } : {}),
      ...(e.tokens?.cacheWrite !== undefined ? { tokensCacheWrite: e.tokens.cacheWrite } : {}),
      ...(e.costUsdMicros !== null ? { costUsdMicros: e.costUsdMicros } : {}),
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
    const priced = await (await loadHooks()).invoke<{
      model: string | null; provider?: string | null; lane?: 'metered' | 'subscription' | null; costUsdMicros: number | null
    }>(
      'models.priceTurn',
      { agentId: opts.agent, model: ranModel, input: usage?.input, output: usage?.output, cacheRead: usage?.cacheRead, cacheWrite: usage?.cacheWrite },
    )
    await recordSpend({
      runId: opts.runId ?? `turn:${randomUUID()}`,
      taskId: opts.taskId,
      agent: opts.agent,
      // Prefer the hook's NORMALIZED id (it resolves from ranModel) — spend
      // facets and rule scopeIds must key identically or model-scoped caps
      // read zero spend. Raw ranModel is the no-plugin fallback only.
      model: priced?.model ?? ranModel ?? null,
      provider: priced?.provider ?? null,
      lane: priced?.lane ?? null,
      costUsdMicros: priced?.costUsdMicros ?? null,
      name: opts.name ?? 'turn',
      tokens: { input: usage?.input, output: usage?.output, total: usage?.total, cacheRead: usage?.cacheRead, cacheWrite: usage?.cacheWrite },
    })
  } catch (err) {
    log.error('Failed to meter agent turn', err, { agent: opts.agent, runId: opts.runId })
  }
}

/** Typed refusal a billed media tool relays to the agent (cost-control v2). */
export interface MediaGateRefusal {
  code: 'budget_exceeded' | 'dispatch_paused'
  scope?: string
  scopeId?: string
  lane?: 'metered' | 'subscription'
  window?: 'daily' | 'monthly'
  unit?: 'usd_micros' | 'tokens'
  capValue?: number
  spentValue?: number
  /** Human-readable reason the agent can surface honestly. */
  message: string
}

export type MediaGateResult = { allowed: true } | { allowed: false; refusal: MediaGateRefusal }

/**
 * Per-call gate for billed media (image generate/edit): consult the kill
 * switch and the SAME budget gate dispatch uses — provider/lane resolve from
 * the image model, breaches open the shared incident + audit — BEFORE any
 * provider call or idempotency row exists. Closes the within-turn leak where
 * one turn loops billed generations past the cap (spec G7/V6). warn does not
 * block (mid-task flapping); defer and the kill switch do. Unexpected gate
 * failure refuses (fail-closed — consistent with billing posture).
 */
export async function gateBilledMediaCall(opts: { agent: string; model: string }): Promise<MediaGateResult> {
  try {
    const [{ dispatchPaused, budgetGate }, { getContentDir }] = await Promise.all([
      import('./dispatch-turns'),
      import('./content-dir'),
    ])
    const contentDir = getContentDir()
    if (dispatchPaused(contentDir)) {
      return {
        allowed: false,
        refusal: { code: 'dispatch_paused', message: 'Dispatch is paused (kill switch) — billed media calls are blocked until it is resumed in Settings.' },
      }
    }
    const decision = await budgetGate(opts.agent, contentDir, undefined, { model: opts.model, billedMedia: true })
    if (decision.action !== 'defer') return { allowed: true }
    const fmt = (v: number) => (decision.unit === 'usd_micros' ? `$${(v / 1_000_000).toFixed(2)}` : `${v.toLocaleString()} tokens`)
    const scopeLabel = decision.rule.scopeId ? `${decision.rule.scope} '${decision.rule.scopeId}'` : decision.rule.scope
    return {
      allowed: false,
      refusal: {
        code: 'budget_exceeded',
        scope: decision.rule.scope,
        ...(decision.rule.scopeId ? { scopeId: decision.rule.scopeId } : {}),
        lane: decision.rule.lane,
        window: decision.window,
        unit: decision.unit,
        capValue: decision.capValue,
        spentValue: decision.spentValue,
        message: `Budget exceeded: ${scopeLabel} ${decision.window} ${decision.rule.lane} spend ${fmt(decision.spentValue)} is at/over the ${fmt(decision.capValue)} cap — billed media is blocked until the window resets or the cap is raised.`,
      },
    }
  } catch (err) {
    log.error('Billed-media gate failed; refusing (fail-closed)', err, { agent: opts.agent, model: opts.model })
    return {
      allowed: false,
      refusal: { code: 'budget_exceeded', message: 'Budget gate unavailable — billed media is blocked (fail-closed).' },
    }
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
  /** `provider/model` of the image generation. */
  model: string
  /** Number of images generated (billed count). */
  count: number
  taskId?: string | null
}): Promise<void> {
  try {
    const priced = await (await loadHooks()).invoke<{
      model: string | null; provider?: string | null; lane?: 'metered' | 'subscription' | null; costUsdMicros: number | null
    }>(
      'models.priceImage',
      { model: opts.model, count: opts.count },
    )
    await recordSpend({
      runId: `image:${randomUUID()}`,
      taskId: opts.taskId,
      agent: opts.agent,
      // Hook-normalized id preferred — same keying rule as chat turns.
      model: priced?.model ?? opts.model,
      provider: priced?.provider ?? null,
      lane: priced?.lane ?? null,
      costUsdMicros: priced?.costUsdMicros ?? null,
      name: 'image',
      meta: { count: opts.count },
    })
  } catch (err) {
    log.error('Failed to meter image turn', err, { agent: opts.agent, model: opts.model })
  }
}
