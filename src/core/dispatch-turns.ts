/**
 * The concurrent-dispatch engine: budget gating, run claiming, the in-flight
 * turn registry + concurrency caps, the ladder-redispatch counter, and
 * fireDispatchTurn (fire a send + reconcile on settle). Extracted from
 * dispatch.ts.
 *
 * Owns turn REGISTRATION (the registry map itself lives in the leaf module
 * `dispatch-registry.ts` so task-store/watchdog can reach the abort surface
 * without importing this fire-core) and the `pendingLadderRedispatches`
 * counter — the counter is mutated ONLY here, via scheduleLadderRedispatch().
 * fireDispatchTurn's settle handlers serialize on the single withStateLock from
 * dispatch-state. turns ↔ session-death is an intentional runtime-only cycle
 * (fireDispatchTurn calls reconcileRejectedDispatch; handleSessionDeath calls
 * scheduleLadderRedispatch) — all accesses are inside function bodies.
 */
import { createLogger } from './logger'
import { getSettings } from './settings'
import { appendAudit } from './audit'
import { getAppServices } from './app-services-store'
import { RuntimeError, RuntimeTurnError, type ChatChunk, type MessageResult } from '@bakin/core/adapters/runtime'
import { claimNextRun, loseRun, settleRun, openBudgetIncident, resolveExpiredBudgetIncidents, findOpenCapIncident, type ClaimNextRunResult } from './execution-ledger'
import { meterAgentTurn } from './agent-cost'
import { classifyDispatchWorkClass, resolveTurnModel, type DispatchWorkClass, type ResolvedTurn, type RoutingConfig } from './model-routing'
import { evaluateBudget, ruleMatchesTurn, dayStartMs, monthStartMs, type BudgetPolicy, type BudgetDecision, type TurnBillingContext } from './budget'
import { assembleBudgetSpend, type BudgetSpendFacets } from './budget-spend'
import { notifyBudgetIncidentOpened } from './budget-notify'
import { getBootId } from './boot-id'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { moveTask as moveStoredTask } from './task-store'
import { formatDispatchError } from './dispatch-failures'
import type { DispatchTask, ConcurrencyGate } from './dispatch-types'
import { withStateLock, loadDispatchState, saveDispatchState } from './dispatch-state'
import { findDispatchTaskSnapshot, tryAddTaskLog } from './dispatch-board'
import { reconcileRejectedDispatch } from './dispatch-session-death'
import { allocateRunWorkspace, readRunSidecar, removeRunWorkspace, setRunWorkspaceRepo, settleRunWorkspace } from './run-workspace'
import { addRunWorktree, removeRunWorktree } from './git-worktree'
import { resolveRepoBinding } from './repo-binding'

const log = createLogger('dispatch-turns')
const hooks = () => getHookRegistry()

/**
 * Task-work sends get a per-dispatch session: a fresh, deterministic
 * threadId per attempt so context can't accumulate across tasks, forensics
 * knows exactly which provider session to inspect, and a corrective
 * re-dispatch never replays a dead session's bloated context. Notification
 * sends (orchestrator/watchdog/doctor) deliberately stay in the agent's
 * default session and don't go through here.
 */
async function sendDispatchMessage(agentId: string, content: string, threadId: string, routing?: ResolvedTurn, signal?: AbortSignal, onActivity?: (chunk: ChatChunk) => void, runWorkspace?: string): Promise<MessageResult> {
  return getAppServices().runtime.messaging.send({
    agentId,
    content,
    threadId,
    ...(routing?.model ? { model: routing.model } : {}),
    ...(routing?.thinking ? { thinking: routing.thinking } : {}),
    ...(signal ? { signal } : {}),
    ...(onActivity ? { onActivity } : {}),
    // Per-run isolation cwd — set ONLY here, only for dispatch turns on
    // isolated runtimes (same-agent-concurrency D2). Chat and system sends
    // never carry it.
    ...(runWorkspace ? { runWorkspace } : {}),
    // Typed contract field (T29) — core policy never rides the metadata bag.
    oversizedOutputBytes: getSettings().dispatch.oversizedOutputBytes,
  })
}

/**
 * The active runtime's same-agent concurrency mode, cached per process:
 * capability declarations are static per adapter, and a completed runtime
 * switch requires a server restart anyway. Unreachable/undeclared reads
 * fail SAFE to 'serialized' (per-agent cap clamps to 1) without caching,
 * so a late-initializing runtime is re-probed next dispatch.
 */
let sameAgentTurnsModeCache: 'isolated' | 'serialized' | undefined
export function resetSameAgentTurnsModeCache(): void {
  sameAgentTurnsModeCache = undefined
  concurrencyClampAudited = false
}
export async function getSameAgentTurnsMode(): Promise<'isolated' | 'serialized'> {
  if (sameAgentTurnsModeCache) return sameAgentTurnsModeCache
  try {
    sameAgentTurnsModeCache = (await getAppServices().runtime.capabilities()).concurrency.sameAgentTurns
    return sameAgentTurnsModeCache
  } catch {
    return 'serialized'
  }
}

/**
 * Clamp-and-warn (thinking-level precedent, never a silent drop): when
 * settings ask for per-agent parallelism a serialized runtime can't isolate,
 * audit it — once per boot, not per turn (the clamp is a standing condition,
 * not an event stream).
 */
let concurrencyClampAudited = false
export function auditConcurrencyClampIfNeeded(contentDir: string, mode: 'isolated' | 'serialized'): void {
  if (concurrencyClampAudited || mode === 'isolated') return
  if (getSettings().dispatch.maxTurnsPerAgent <= 1) return
  concurrencyClampAudited = true
  appendAudit(contentDir, 'dispatch.concurrency_clamped', 'dispatch', {
    requested: getSettings().dispatch.maxTurnsPerAgent,
    effective: 1,
    reason: 'runtime declares concurrency.sameAgentTurns: serialized — per-run isolation unavailable',
  })
  log.warn('Per-agent concurrency clamped to 1: active runtime cannot isolate same-agent turns', {
    requested: getSettings().dispatch.maxTurnsPerAgent,
  })
}

/**
 * Live turn activity: the adapter's best-effort onActivity tap (tool/status
 * chunks, T8) broadcast straight to SSE — EPHEMERAL by design. Never
 * persisted: no task log, no audit, no heartbeat bump — the durable record
 * of a turn stays the ledger run + the agent's own progress logs. Rides the
 * ephemeral broadcast (no replay buffer, no event id) so a long turn can
 * never evict durable events from the reconnect window. Chunks arrive
 * classified, with previews redacted by BOTH adapters (redactSensitiveText),
 * and sparse upstream (tool phases + a once-per-turn thinking status), so no
 * additional throttling here.
 */
export interface TurnActivityEvent extends Record<string, unknown> {
  type: 'turn-activity'
  taskId: string
  /** Nested-workflow child board task the step turn serves, when present. */
  childTaskId?: string
  agentId: string
  /** The ledger run id (== threadId) of the turn producing the activity. */
  runId: string
  chunk: { type: ChatChunk['type']; content?: string; data?: unknown }
  ts: string
}

function broadcastTurnActivity(event: TurnActivityEvent): void {
  const fn = (globalThis as { __bakinBroadcastEphemeral?: (data: Record<string, unknown>) => void }).__bakinBroadcastEphemeral
  if (fn) fn(event)
}

// Fail-closed (ledger unreadable) can't write a durable incident — the
// ledger IS the incident store — so its audit keeps a small in-memory
// once-per-window latch to avoid per-task spam. Every readable-ledger breach
// debounces durably via the budget_incidents UNIQUE instead.
const failClosedAuditedWindows = new Set<number>()

// Kill-switch audit latch: one `dispatch.paused` row per activation (the
// transition matters, not every deferred task). Re-arms on unpause; a
// restart re-audits an active switch — harmless and honest.
let killSwitchAudited = false

/**
 * The global kill switch (settings.dispatch.paused): pauses ALL Bakin-
 * initiated task dispatch (and billed media via gateBilledMediaCall). The
 * operator's break-glass control — independent of budget caps. Watchdog/
 * doctor health probes stay allowed (documented boundary).
 */
export function dispatchPaused(contentDir: string): boolean {
  const paused = getSettings().dispatch.paused
  if (paused && !killSwitchAudited) {
    killSwitchAudited = true
    appendAudit(contentDir, 'dispatch.paused', 'system', { reason: 'dispatch_paused' })
  }
  if (!paused) killSwitchAudited = false
  return paused
}

/**
 * Per-cycle memo for the spend engine: the facets are identical for every
 * task evaluated in one dispatch cycle (costs are only recorded on settle,
 * after the loop), so one assembly serves the whole cycle.
 */
export interface BudgetSpendMemo {
  facets?: Promise<BudgetSpendFacets>
  /** Local day-start the memoized facets were assembled in — a cycle that
   *  straddles midnight must NOT gate post-midnight tasks on pre-midnight
   *  windows (the old spendCache keyed on window start for the same reason). */
  dayStartMs?: number
}

/**
 * Consult the budget policy before a dispatch claims a run. allow / warn /
 * defer; warn and defer are audited (debounced per window). Spend comes from
 * the shared engine (assembleBudgetSpend) — attributed run_costs PLUS the
 * unattributed usage.db delta (total-observed basis, spec V4). FAIL-CLOSED:
 * if the spend ledger can't be read, defer — consistent with the ledger's
 * existing posture. No policy (plugin absent / empty) → allow.
 */
/** The fail-closed pseudo-rule when the spend ledger is unreadable. */
const FAIL_CLOSED_DECISION: BudgetDecision = {
  action: 'defer',
  cause: 'spend_evidence_unavailable',
  rule: { scope: 'global', lane: 'metered' },
  window: 'daily',
  unit: 'usd_micros',
  spentValue: 0,
  capValue: 0,
}

export async function budgetGate(
  agentId: string,
  contentDir: string,
  spendMemo?: BudgetSpendMemo,
  /** Model the turn is routed to (explicit override); omit = agent default.
   *  `billedMedia` marks a billed media call: its lane resolves from
   *  provider-level overrides only — the agent's CHAT auth (subscription)
   *  must never reclassify image dollars. */
  prospect?: { model?: string; billedMedia?: boolean },
): Promise<BudgetDecision> {
  let policy: BudgetPolicy | undefined
  try {
    policy = (await hooks().invoke<BudgetPolicy>('models.getBudgetPolicy', {})) ?? undefined
  } catch (err) {
    log.error('Budget policy read failed; allowing (no policy)', err, { agentId })
    return { action: 'allow' }
  }
  const now = Date.now()

  // Lazy window rollover runs even with NO rules — deleting every rule must
  // not strand yesterday's open defer-mode incidents in the banner forever.
  try {
    resolveExpiredBudgetIncidents({ dailyWindowStartMs: dayStartMs(now), monthlyWindowStartMs: monthStartMs(now), now })
  } catch (err) {
    log.warn('Budget incident rollover sweep failed', { err: err instanceof Error ? err.message : String(err) })
  }

  if (!policy?.rules?.length) return { action: 'allow' }

  // Billing context of the prospective turn — provider + lane let provider-
  // scoped and subscription-lane rules match. Unresolvable (plugin absent /
  // hook error) → metered lane, no provider: dollar rules still gate.
  const turn: TurnBillingContext = { agent: agentId, model: prospect?.model }
  try {
    const billing = await hooks().invoke<{ provider?: string; lane?: 'metered' | 'subscription'; model?: string | null }>(
      'models.resolveBilling',
      {
        // Billed media: provider-keyed lane only — omit agentId so the
        // agent's chat-auth detection can't reclassify image dollars.
        ...(prospect?.billedMedia ? {} : { agentId }),
        ...(prospect?.model ? { model: prospect.model } : {}),
      },
    )
    if (billing) {
      turn.provider = billing.provider
      turn.lane = billing.lane
      turn.model = billing.model ?? turn.model
    }
  } catch (err) {
    log.warn('Billing resolution failed; gating as metered', { agentId, err: err instanceof Error ? err.message : String(err) })
  }

  // PAUSE mode: a matching rule whose cap incident is still live blocks the
  // turn regardless of current spend — the rollover sweep above never
  // touches pause-mode rows, so this holds past the window until a human
  // resolves (raise / resume). Checked before the spend assembly: post-
  // rollover spend is under cap by definition.
  for (const rule of policy.rules) {
    if (rule.atCap !== 'pause' || !ruleMatchesTurn(rule, turn)) continue
    try {
      const blocking = findOpenCapIncident({ scope: rule.scope, scopeId: rule.scopeId, lane: rule.lane })
      if (blocking) {
        return {
          action: 'defer',
          cause: 'open_pause_incident',
          rule,
          window: blocking.window,
          unit: blocking.unit,
          spentValue: blocking.spentValue,
          capValue: blocking.capValue,
        }
      }
    } catch (err) {
      log.error('Pause-incident probe failed; deferring (fail-closed)', err, { agentId })
      return FAIL_CLOSED_DECISION
    }
  }

  let facets: BudgetSpendFacets
  try {
    const windowStart = dayStartMs(now)
    const memoValid = spendMemo?.facets !== undefined && spendMemo.dayStartMs === windowStart
    const pending = memoValid ? spendMemo!.facets! : assembleBudgetSpend(now)
    if (spendMemo) {
      spendMemo.facets = pending
      spendMemo.dayStartMs = windowStart
    }
    facets = await pending
  } catch (err) {
    log.error('Budget spend read failed; deferring (fail-closed)', err, { agentId })
    const windowStart = dayStartMs(now)
    if (!failClosedAuditedWindows.has(windowStart)) {
      failClosedAuditedWindows.add(windowStart)
      appendAudit(contentDir, 'budget.deferred', agentId, { scope: 'global', window: 'daily', reason: 'ledger-unavailable' })
    }
    return FAIL_CLOSED_DECISION
  }

  const decision = evaluateBudget({ policy, turn, facets })
  if (decision.action !== 'allow') {
    if (decision.cause === 'spend_evidence_incomplete' || decision.cause === 'spend_evidence_unavailable') {
      recordSpendEvidenceDeferral(contentDir, agentId, decision, facets)
    } else if (decision.cause === 'threshold') {
      recordBudgetBreach(contentDir, agentId, decision, facets)
    }
  }
  return decision
}

// Evidence gaps can heal as soon as a later runtime result reports usage, so
// unlike a real cap breach they must not open a durable "cap reached"
// incident. They are still audited once per rule/window for observability.
const incompleteSpendEvidenceAudits = new Set<string>()

function recordSpendEvidenceDeferral(
  contentDir: string,
  agentId: string,
  decision:
    | Extract<BudgetDecision, { cause: 'spend_evidence_incomplete' }>
    | Extract<BudgetDecision, { cause: 'spend_evidence_unavailable' }>,
  facets: BudgetSpendFacets,
): void {
  const windowStart = decision.window === 'monthly' ? facets.monthly.startMs : facets.daily.startMs
  const key = JSON.stringify([
    contentDir,
    windowStart,
    decision.window,
    decision.rule.scope,
    decision.rule.scopeId ?? '',
    decision.rule.lane,
  ])
  if (incompleteSpendEvidenceAudits.has(key)) return
  try {
    appendAudit(contentDir, 'budget.deferred', agentId, {
      scope: decision.rule.scope,
      ...(decision.rule.scopeId ? { scopeId: decision.rule.scopeId } : {}),
      lane: decision.rule.lane,
      window: decision.window,
      unit: decision.unit,
      reason: decision.cause === 'spend_evidence_unavailable'
        ? 'spend-evidence-unavailable'
        : 'spend-evidence-incomplete',
      knownSpentValue: decision.spentValue,
      capValue: decision.capValue,
      ...(decision.cause === 'spend_evidence_incomplete'
        ? { unknownEvidenceCount: decision.unknownEvidenceCount }
        : {}),
    })
    incompleteSpendEvidenceAudits.add(key)
  } catch (err) {
    log.error('Failed to audit incomplete spend evidence deferral', err, { agentId })
  }
}

/**
 * Open (idempotently) the durable incident for a breach and audit it exactly
 * once per (rule identity, window, kind) — the budget_incidents UNIQUE is
 * the restart-safe debounce. Never throws into the gate.
 */
function recordBudgetBreach(
  contentDir: string,
  agentId: string,
  decision: Extract<BudgetDecision, { cause: 'threshold' }>,
  facets: BudgetSpendFacets,
): void {
  try {
    const windowStart = decision.window === 'monthly' ? facets.monthly.startMs : facets.daily.startMs
    const incident = openBudgetIncident({
      scope: decision.rule.scope,
      scopeId: decision.rule.scopeId,
      lane: decision.rule.lane,
      window: decision.window,
      windowStartMs: windowStart,
      kind: decision.action === 'defer' ? 'cap' : 'warn',
      unit: decision.unit,
      capValue: decision.capValue,
      spentValue: decision.spentValue,
      // Warn incidents never block — they must always rollover-sweep, even
      // on pause-mode rules (only CAP incidents inherit the pause hold).
      atCap: decision.action === 'defer' ? decision.rule.atCap ?? 'defer' : 'defer',
      openedAt: Date.now(),
    })
    if (!incident.opened) return
    const event = decision.action === 'defer' ? 'budget.deferred' : 'budget.warn'
    appendAudit(contentDir, event, agentId, {
      incidentId: incident.id,
      scope: decision.rule.scope,
      ...(decision.rule.scopeId ? { scopeId: decision.rule.scopeId } : {}),
      lane: decision.rule.lane,
      window: decision.window,
      unit: decision.unit,
      spentValue: decision.spentValue,
      capValue: decision.capValue,
    })
    // Proactive fan-out (SSE/browser + main-agent relay) — fresh opens only.
    notifyBudgetIncidentOpened({
      incidentId: incident.id,
      kind: decision.action === 'defer' ? 'cap' : 'warn',
      scope: decision.rule.scope,
      ...(decision.rule.scopeId ? { scopeId: decision.rule.scopeId } : {}),
      lane: decision.rule.lane,
      window: decision.window,
      unit: decision.unit,
      capValue: decision.capValue,
      spentValue: decision.spentValue,
      // Warn incidents never block — they must always rollover-sweep, even
      // on pause-mode rules (only CAP incidents inherit the pause hold).
      atCap: decision.action === 'defer' ? decision.rule.atCap ?? 'defer' : 'defer',
    }, () => getAppServices().runtime)
  } catch (err) {
    log.error('Failed to record budget breach incident', err, { agentId })
  }
}

/**
 * True when the turn must not fire: the kill switch is on, or budget says
 * defer — the shared shape all three dispatch paths use.
 */
export async function deferForBudget(
  agentId: string,
  contentDir: string,
  spendMemo?: BudgetSpendMemo,
  prospect?: { model?: string },
): Promise<boolean> {
  if (dispatchPaused(contentDir)) return true
  return (await budgetGate(agentId, contentDir, spendMemo, prospect)).action === 'defer'
}

/**
 * Resolve the per-turn model/thinking for a dispatch from the Bakin-owned
 * routing policy (stored in the models plugin; read via hook). Returns {} —
 * inherit, unchanged dispatch — when no plugin/config/match applies or the
 * read fails. Never throws into the dispatch path.
 */
export async function resolveDispatchRouting(task: DispatchTask, isRecovery: boolean): Promise<ResolvedTurn> {
  try {
    const config = await hooks().invoke<RoutingConfig>('models.getRoutingConfig', {})
    if (!config) return { source: 'inherit' }
    const resolved = resolveTurnModel({
      task: { tags: task.tags, scheduleJobId: task.scheduleJobId, workflowId: task.workflowId, parentId: task.parentId },
      isRecovery,
      config,
    })
    const { applyThinkingCapability } = await import('./system-route')
    return await applyThinkingCapability(resolved, classifyDispatchWorkClass(task, isRecovery))
  } catch (err) {
    log.error('Routing resolve failed; using agent default', err, { id: task.id })
    return { source: 'inherit' }
  }
}

/**
 * Record the cost of a settled turn. The threadId IS the ledger run id, so
 * the row is first-write-wins idempotent. Pricing is delegated to the models
 * plugin via the `models.priceTurn` hook (core stays pricing-agnostic);
 * absent plugin → null model/cost, tokens still recorded ("unmetered"). The
 * same data also feeds the live usage recorder. Never throws into the settle
 * path — a metering failure must not fail a successful turn.
 */
function recordTurnCost(runId: string, taskId: string, agent: string, result: MessageResult, workClass: DispatchWorkClass, routeSource: string, resolvedModel?: string): Promise<void> {
  return meterAgentTurn({ runId, taskId, agent, activityClass: 'user', result, resolvedModel, workClass, routeSource })
}

/**
 * Atomically mint the next per-attempt session key AND claim the live-run
 * slot in the execution ledger. The runs table's partial unique index (one
 * running row per exec key) is the correctness mechanism: a duplicate
 * dispatch (overlapping cycle, manual kick racing the cycle, second server
 * process) fails the INSERT instead of racing in-memory markers.
 *
 * `seq` stays a monotonic per-task counter (now ledger-owned, seeded from
 * the legacy .dispatch-state.json watermarks) — it must never be derived
 * from the failure count and reusing one could re-enter a live provider
 * session. Workflow steps carry the stepId so parallel step agents can't
 * collide: their exec key is `${taskId}:${stepId}`.
 *
 * Callers MUST settle the claim on every outcome (fireDispatchTurn's settle
 * handlers do) or release it via loseRun when the turn never fires.
 */
export function claimDispatchRun(taskId: string, targetAgent: string, stepId?: string): ClaimNextRunResult {
  return claimNextRun({
    taskId,
    execKey: stepId ? `${taskId}:${stepId}` : taskId,
    agent: targetAgent,
    bootId: getBootId(),
    runIdFor: (seq) => (stepId ? `task:${taskId}:step:${stepId}:d${seq}` : `task:${taskId}:d${seq}`),
  })
}

/** Suppressed-duplicate bookkeeping shared by all three dispatch paths. */
export function auditDispatchSuppressed(contentDir: string, task: { id: string; title: string }, targetAgent: string, liveRunId: string | undefined, path: 'cycle' | 'single' | 'workflow'): void {
  appendAudit(contentDir, 'task.dispatch_suppressed', targetAgent, {
    id: task.id,
    title: task.title,
    liveRunId: liveRunId ?? null,
    path,
  })
  log.warn('Dispatch suppressed — live run already exists', { id: task.id, liveRunId, path })
}

// ─── In-flight turn registry (concurrent dispatch) ─────────────────────────
//
// The registry itself lives in `dispatch-registry.ts` — a LEAF module so
// task-store.deleteTask and the watchdog sweep can reach the abort surface
// without importing the dispatch fire-core (task-store → dispatch-turns
// would cycle). This module OWNS registration: only fireDispatchTurn
// registers/unregisters turns. getInFlightTurnCount is re-exported for the
// public dispatch barrel.

export { getInFlightTurnCount } from './dispatch-registry'
import { getInFlightTurnCount, getInFlightSettledPromises, getInFlightTurn, registerTurn, unregisterTurn } from './dispatch-registry'

/** Why a dispatch can't fire right now, or null when a slot is free. */
export function concurrencyGate(
  agentId: string,
  settings: { dispatch: { maxConcurrentTurns: number; maxTurnsPerAgent: number } },
  // Slots reserved by collected-but-not-yet-fired turns in the current
  // two-phase cycle — invisible to the in-flight registry until phase 2.
  reserved?: { total: number; forAgent: number },
  // The active runtime's concurrency declaration (getSameAgentTurnsMode).
  // Omitted/serialized ⇒ per-agent cap clamps to 1 regardless of settings:
  // without per-run isolation, two same-agent turns share one workspace.
  sameAgentTurns: 'isolated' | 'serialized' = 'serialized',
): ConcurrencyGate {
  const perAgentCap = sameAgentTurns === 'isolated' ? settings.dispatch.maxTurnsPerAgent : Math.min(settings.dispatch.maxTurnsPerAgent, 1)
  if (getInFlightTurnCount() + (reserved?.total ?? 0) >= settings.dispatch.maxConcurrentTurns) return 'concurrency_cap'
  if (getInFlightTurnCount(agentId) + (reserved?.forAgent ?? 0) >= perAgentCap) return 'agent_busy'
  return null
}

// Ladder re-dispatches scheduled via the post-lock timer but not yet fired —
// without counting these, awaitDispatchIdle() would report idle during the
// window between a dying turn settling and its recovery turn firing.
let pendingLadderRedispatches = 0

/**
 * Schedule a ladder re-dispatch after `delayMs`, tracking it in the idle
 * counter until it settles. The counter is mutated ONLY here so awaitDispatchIdle
 * has a single source of truth (session-death calls this rather than touching
 * the counter directly). `run` owns its own error handling.
 */
export function scheduleLadderRedispatch(run: () => Promise<unknown>, delayMs: number): void {
  pendingLadderRedispatches += 1
  const timer = setTimeout(() => {
    void Promise.resolve()
      .then(run)
      .finally(() => {
        pendingLadderRedispatches -= 1
      })
  }, delayMs)
  timer.unref?.()
}

/**
 * Wait until every tracked turn (including its settle-time reconciliation)
 * and every scheduled ladder re-dispatch has finished. Deterministic
 * synchronization point for tests and shutdown.
 */
export async function awaitDispatchIdle(): Promise<void> {
  while (getInFlightTurnCount() > 0 || pendingLadderRedispatches > 0) {
    const settled = getInFlightSettledPromises()
    if (settled.length > 0) {
      await Promise.allSettled(settled)
    } else {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

/**
 * Fire a dispatch send and reconcile on settle. Returns immediately. The
 * settle handlers re-load state under the lock — the firing cycle's state
 * object must not be touched after the cycle's own save.
 */
export function fireDispatchTurn(opts: {
  marker: string
  task: DispatchTask
  targetAgent: string
  threadId: string
  message: string
  contentDir: string
  port: number
  initialLogCount: number
  logPrefix: string
  dispatchKind: 'regular' | 'workflow'
  /** Nested-workflow child board task this step turn serves — deleting it
   *  must abort the turn even though `task` is the parent (#604 review). */
  childTaskId?: string
  /** Workflow step id (recorded on the run-workspace sidecar so the sweep's
   *  failed-retention and salvage can attribute per step). */
  stepId?: string
  /** True when this is a recovery-ladder re-dispatch (routes to the
   *  'recovery' origin policy regardless of the task's shape). */
  isRecovery?: boolean
  /** Routing pre-resolved by the caller (also consulted by the budget gate);
   *  when present the fire path reuses it instead of re-resolving — one
   *  resolution per dispatch, so the gated model IS the fired model. */
  routing?: ResolvedTurn
  onSettled?: (outcome: 'ok' | 'error', err?: unknown) => void
}): void {
  // The registry entry is released only AFTER settle reconciliation
  // completes — awaitDispatchIdle() must mean "all bookkeeping done", and a
  // turn's slot shouldn't free until its outcome has been recorded.
  const abort = new AbortController()
  // Allocated inside the settle chain (isolated runtimes only); shared with
  // the catch branches so every settle path stamps the sidecar. For bound
  // tasks the execution cwd is the worktree CHECKOUT inside the run dir.
  let runWorkspace: string | undefined
  let executionWorkspace: string | undefined
  const settled = (opts.routing ? Promise.resolve(opts.routing) : resolveDispatchRouting(opts.task, opts.isRecovery ?? false))
    .then(async (routing) => {
      // Fire-time existence check: a delete can interleave between the
      // cycle's phase-1 claim and this fire (the turn is only registered —
      // and thus abortable — below). If the task vanished, surface it as an
      // abort instead of sending a turn for a deleted task (#604 review F3).
      if (!findDispatchTaskSnapshot(opts.task.id) || (opts.childTaskId && !findDispatchTaskSnapshot(opts.childTaskId))) {
        abort.abort('task-deleted')
        throw new RuntimeError('Task deleted before dispatch turn fired', { kind: 'aborted' })
      }
      // Per-run isolation (same-agent-concurrency D2/D4): allocate AFTER the
      // existence check (a deleted task never mints a dir) and inside the
      // settle chain — post-claim, outside withStateLock (the chain runs
      // after the lock releases). Serialized runtimes never get a dir.
      if ((await getSameAgentTurnsMode()) === 'isolated') {
        runWorkspace = allocateRunWorkspace({
          threadId: opts.threadId,
          taskId: opts.task.id,
          ...(opts.stepId ? { stepId: opts.stepId } : {}),
          agentId: opts.targetAgent,
        })
        // Repo-bound task (D6): materialize the worktree at <runDir>/repo on
        // branch-per-run and make the CHECKOUT the turn's cwd (the agent
        // starts where the code is; scratch is one level up; the adapter's
        // .git guard keeps seeding out of the checkout). Multi-second git
        // adds run here in the settle chain — this turn waits, dispatch
        // doesn't. Failure removes the dir and takes the failure ladder —
        // a bound task never fires without its checkout.
        try {
          const binding = await resolveRepoBinding(opts.task as { id: string; repoPath?: unknown; projectId?: unknown })
          if (binding) {
            const { checkoutDir, branch } = await addRunWorktree(binding.repoPath, runWorkspace, opts.threadId)
            setRunWorkspaceRepo(opts.targetAgent, opts.threadId, binding.repoPath)
            executionWorkspace = checkoutDir
            appendAudit(opts.contentDir, 'task.worktree_materialized', opts.targetAgent, {
              id: opts.task.id,
              runId: opts.threadId,
              repoPath: binding.repoPath,
              branch,
              source: binding.source,
            })
            // The BRANCH is the deliverable and the checkout dies at settle —
            // the task log is where the user learns which branch holds the
            // work (UI review #2).
            await tryAddTaskLog(opts.task.id, 'system', `Working in an isolated worktree of ${binding.repoPath} on branch ${branch}. The checkout is removed when the task settles; the branch (and its commits) survive for your review.`)
          }
        } catch (err) {
          removeRunWorkspace(runWorkspace)
          runWorkspace = undefined
          throw err
        }
      }
      if (routing.model || routing.thinking || routing.thinkingClamp) {
        appendAudit(opts.contentDir, 'task.routed', opts.targetAgent, {
          source: routing.source,
          ...(routing.thinkingClamp ? { requestedThinking: routing.thinkingClamp.requested, clamped: true } : {}),
          id: opts.task.id,
          ...(routing.model ? { model: routing.model } : {}),
          ...(routing.thinking ? { thinking: routing.thinking } : {}),
        })
      }
      // Drop-after-settle guard: the tap can rarely fire after the turn
      // settles (late gateway frames) — once the registry entry is gone,
      // nothing broadcasts. The registry is threadId-keyed, so this lookup
      // is structurally this attempt's own entry: a retry under the same
      // marker can never broadcast a zombie chunk under a stale runId.
      const onActivity = (chunk: ChatChunk): void => {
        if (chunk.type === 'done' || chunk.type === 'error') return
        if (!getInFlightTurn(opts.threadId)) return
        broadcastTurnActivity({
          type: 'turn-activity',
          taskId: opts.task.id,
          ...(opts.childTaskId ? { childTaskId: opts.childTaskId } : {}),
          agentId: opts.targetAgent,
          runId: opts.threadId,
          chunk: { type: chunk.type, ...(chunk.content !== undefined ? { content: chunk.content } : {}), ...(chunk.data !== undefined ? { data: chunk.data } : {}) },
          ts: new Date().toISOString(),
        })
      }
      const result = await sendDispatchMessage(opts.targetAgent, opts.message, opts.threadId, routing, abort.signal, onActivity, executionWorkspace ?? runWorkspace)
      // Free the live-run slot FIRST — the settle reconciliation below (and
      // any ladder re-dispatch it schedules) must be able to claim anew.
      try {
        settleRun(opts.threadId, 'ok')
      } catch (err) {
        log.error('Failed to settle run in ledger', err, { threadId: opts.threadId })
      }
      if (runWorkspace) {
        settleRunWorkspace(opts.targetAgent, opts.threadId, 'ok')
        // Worktrees die at successful settle — the BRANCH is the deliverable,
        // the checkout is reproducible scratch (spec r4; unbounded retained
        // checkouts were the audited machine-killer). Failed/aborted runs
        // keep theirs for the 48h salvage window (sweep-owned).
        if (executionWorkspace) {
          const sidecar = readRunSidecar(runWorkspace)
          if (sidecar?.repoPath && (await removeRunWorktree(sidecar.repoPath, executionWorkspace))) {
            setRunWorkspaceRepo(opts.targetAgent, opts.threadId, null)
          }
        }
      }
      // Attribute the turn's token/dollar cost (run_id == threadId). The
      // resolved routing model is what actually ran — price against it.
      const workClass = classifyDispatchWorkClass(opts.task, opts.isRecovery ?? false)
      await recordTurnCost(opts.threadId, opts.task.id, opts.targetAgent, result, workClass, routing.source ?? 'inherit', routing.model)
      let completedDecomposition = false
      await withStateLock(() => {
        const state = loadDispatchState(opts.contentDir)
        const record = state.failedDispatches?.[opts.task.id]
        if (record) {
          completedDecomposition = record.sessionDeath?.stage === 'decomposition'
          delete state.failedDispatches![opts.task.id]
          saveDispatchState(opts.contentDir, state)
        }
      })
      // A successful DECOMPOSITION turn ends with the agent creating the
      // subtask chain and STOPPING (no tasks_complete, by design) — which
      // leaves the parent inProgress, where continuation skips it when the
      // chain finishes (found live on the rig: the parent idled until
      // watchdog recovery). Park it in todo; the dependsOn gate the agent
      // set holds it there until the chain completes, then continuation
      // re-dispatches it for final assembly.
      if (completedDecomposition && findDispatchTaskSnapshot(opts.task.id)?.column === 'inProgress') {
        try {
          await moveStoredTask(opts.task.id, 'todo', 'inProgress')
          await tryAddTaskLog(opts.task.id, 'system', 'Decomposition complete — parked in Todo until the subtask chain finishes (dependency gate), then re-dispatched for final assembly.')
        } catch (err) {
          log.warn('Failed to park decomposed parent in todo', err, { id: opts.task.id })
        }
      }
      opts.onSettled?.('ok')
    })
    .catch(async (err) => {
      // Intentional cancellation (task deleted / orphan sweep): clean exit.
      // No recovery ladder — a corrective re-dispatch would resurrect work
      // for a task that no longer exists — and no reconcile fail-noise. The
      // ledger row is usually already purged by deleteTask; settleRun on a
      // missing/settled row is a first-write-wins no-op by design.
      if (err instanceof RuntimeError && err.kind === 'aborted') {
        // The reason rides the closure-captured signal (abort.abort(reason)),
        // which survives a force-released registry entry.
        const reason = typeof abort.signal.reason === 'string' ? abort.signal.reason : 'unknown'
        try {
          settleRun(opts.threadId, `aborted: ${reason}`)
        } catch (ledgerErr) {
          log.debug('Ledger settle after abort was a no-op', { threadId: opts.threadId, err: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr) })
        }
        if (runWorkspace) settleRunWorkspace(opts.targetAgent, opts.threadId, `aborted: ${reason}`)
        appendAudit(opts.contentDir, 'task.turn_aborted', opts.targetAgent, {
          id: opts.task.id,
          title: opts.task.title,
          runId: opts.threadId,
          reason,
        })
        log.info(`Turn aborted for "${opts.task.title}" → ${opts.targetAgent}`, { id: opts.task.id, reason })
        opts.onSettled?.('error', err)
        return
      }
      log.error(`${opts.logPrefix}: turn failed for "${opts.task.title}" → ${opts.targetAgent}`, err)
      // Free the slot before reconciliation — the recovery ladder's
      // re-dispatch claims a fresh run and must not be suppressed by the
      // dead one. Session deaths are 'lost'; other failures 'settled'.
      try {
        if (err instanceof RuntimeTurnError) loseRun(opts.threadId, 'session-death')
        else settleRun(opts.threadId, `failed: ${formatDispatchError(err).slice(0, 120)}`)
      } catch (ledgerErr) {
        log.error('Failed to settle failed run in ledger', ledgerErr, { threadId: opts.threadId })
      }
      // Failed/lost runs KEEP their dir (salvage window — sweep owns aging).
      if (runWorkspace) {
        settleRunWorkspace(opts.targetAgent, opts.threadId, err instanceof RuntimeTurnError ? 'lost: session-death' : `failed: ${formatDispatchError(err).slice(0, 80)}`)
        // Tell the USER where the attempt's scratch lives — files that used
        // to be findable in the agent workspace now live here (UI review #7).
        await tryAddTaskLog(opts.task.id, 'system', `The failed attempt's working files are retained for review at ${runWorkspace} (kept up to 30 days${executionWorkspace ? '; its repo checkout is kept 48 hours' : ''}).`)
      }
      try {
        await withStateLock(async () => {
          const state = loadDispatchState(opts.contentDir)
          await reconcileRejectedDispatch({
            contentDir: opts.contentDir,
            port: opts.port,
            state,
            dispatchedSet: null,
            task: opts.task,
            targetAgent: opts.targetAgent,
            err,
            initialLogCount: opts.initialLogCount,
            logPrefix: opts.logPrefix,
            dispatchKind: opts.dispatchKind,
            threadId: opts.threadId,
          })
          saveDispatchState(opts.contentDir, state)
        })
      } catch (reconcileErr) {
        log.error('Dispatch settle reconciliation failed', reconcileErr, { id: opts.task.id })
      }
      opts.onSettled?.('error', err)
    })
    .finally(() => {
      unregisterTurn(opts.threadId)
    })

  // A live entry under this threadId is a bug: the ledger mints seq
  // atomically, so two fires can only share a threadId if a dispatch path
  // double-fired one claim. Register-over audits loudly and proceeds (the
  // newer settle chain wins the entry; both settles are idempotent).
  if (getInFlightTurn(opts.threadId)) {
    appendAudit(opts.contentDir, 'dispatch.registry_clobber', opts.targetAgent, {
      id: opts.task.id,
      runId: opts.threadId,
      marker: opts.marker,
    })
    log.error('Registry clobber: threadId already live at register', { threadId: opts.threadId, marker: opts.marker })
  }
  registerTurn({
    marker: opts.marker,
    agentId: opts.targetAgent,
    taskId: opts.task.id,
    ...(opts.childTaskId ? { childTaskId: opts.childTaskId } : {}),
    threadId: opts.threadId,
    startedAt: Date.now(),
    settled,
    abort,
  })
}
