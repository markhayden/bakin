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
    const [{ recordRunCost }, { recordUsage }, { getHookRegistry }] = await Promise.all([
      import('./execution-ledger'),
      import('./usage'),
      import('../lib/plugin-registry'),
    ])
    const usage = opts.result.usage
    // Prefer the model the runtime ACTUALLY ran (from usage) over the one we
    // requested — a per-turn override the provider rejected/fell back from
    // must be priced against what ran, not what we asked for (review #3).
    const ranModel = usage?.model ?? opts.resolvedModel
    const priced = await getHookRegistry().invoke<{ model: string | null; costUsdMicros: number | null }>(
      'models.priceTurn',
      { agentId: opts.agent, model: ranModel, input: usage?.input, output: usage?.output },
    )
    const model = ranModel ?? priced?.model ?? null
    const costUsdMicros = priced?.costUsdMicros ?? null
    recordRunCost({
      runId: opts.runId ?? `turn:${randomUUID()}`,
      taskId: opts.taskId ?? null,
      agent: opts.agent,
      model: model ?? undefined,
      inputTokens: usage?.input ?? null,
      outputTokens: usage?.output ?? null,
      totalTokens: usage?.total ?? null,
      costUsdMicros,
      occurredAt: Date.now(),
    })
    recordUsage({
      kind: 'agent',
      name: opts.name ?? 'turn',
      agent: opts.agent,
      durationMs: null,
      status: 'ok',
      ...(usage?.input !== undefined ? { tokensIn: usage.input } : {}),
      ...(usage?.output !== undefined ? { tokensOut: usage.output } : {}),
      ...(costUsdMicros !== null ? { costUsdMicros } : {}),
      meta: { ...(opts.taskId ? { taskId: opts.taskId } : {}), ...(model ? { model } : {}) },
    })
  } catch (err) {
    log.error('Failed to meter agent turn', err, { agent: opts.agent, runId: opts.runId })
  }
}
