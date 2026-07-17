/**
 * Work-class model + thinking routing — Bakin-owned policy resolved per turn.
 * Bakin decides WHICH model/thinking a turn gets; the runtime SERVES it (the
 * adapter passes `model`/`thinking` per turn).
 *
 * The routing key is the turn's WORK CLASS: dispatch classes are classified
 * deterministically from task shape; system classes are declared by their
 * call site (auto-titles, enrichment, relays, …) — never inferred. `chat` is
 * the one metered-only class: interactive chat model choice belongs to the
 * operator, but its spend is still attributed.
 *
 * A turn that matches no tag override and no class route resolves to nothing —
 * "inherit": the adapter passes no model and the runtime uses the agent's
 * configured default, exactly as before routing existed. So the per-agent/
 * global tail of the cascade is the runtime's existing default behavior, not
 * something this resolver reproduces.
 *
 * Pure functions — no I/O. Callers load the RoutingConfig (from the models
 * plugin settings via the `models.getRoutingConfig` hook) and resolve before
 * each turn. The same work class is stamped on the turn's `run_costs` row, so
 * the dimension that routes IS the dimension spend reports on.
 */

/** Runtime thinking levels the adapter forwards as the per-turn thinking param. */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'adaptive' | 'max'

/** A route may explicitly inherit (no thinking override) — distinct from unset. */
export type ThinkingSetting = ThinkingLevel | 'inherit'

/** Deterministic dispatch classes — classified from task shape at dispatch. */
export type DispatchWorkClass = 'scheduled' | 'workflow' | 'adhoc' | 'recovery' | 'decomposition'

/** System classes — declared by the call site that sends the turn. */
export type SystemWorkClass = 'auto-title' | 'enrichment' | 'relay' | 'team-routing' | 'send' | 'chat'

/** The unified routing + spend-attribution key. */
export type WorkClass = DispatchWorkClass | SystemWorkClass

export interface WorkClassMeta {
  id: WorkClass
  label: string
  description: string
  kind: 'dispatch' | 'system'
  /** false = metered-only: spend is attributed but no route can target it. */
  routable: boolean
  /** Tier the recommended-routes proposal targets; absent = no recommendation. */
  recommendedTier?: 'cheap' | 'cheap-vision'
}

export const WORK_CLASSES: readonly WorkClassMeta[] = [
  { id: 'scheduled', label: 'Scheduled', description: 'Cron-fired tasks', kind: 'dispatch', routable: true },
  { id: 'workflow', label: 'Workflow', description: 'Workflow step turns', kind: 'dispatch', routable: true },
  { id: 'adhoc', label: 'Ad-hoc', description: 'Manually kicked tasks', kind: 'dispatch', routable: true },
  { id: 'recovery', label: 'Recovery', description: 'Session-death re-dispatch', kind: 'dispatch', routable: true },
  { id: 'decomposition', label: 'Decomposition', description: 'Subtask breakdown turns', kind: 'dispatch', routable: true },
  { id: 'auto-title', label: 'Auto-title', description: 'Chat title generation', kind: 'system', routable: true, recommendedTier: 'cheap' },
  { id: 'enrichment', label: 'Enrichment', description: 'Asset vision/caption/OCR turns', kind: 'system', routable: true, recommendedTier: 'cheap-vision' },
  { id: 'relay', label: 'Relay', description: 'Doctor, watchdog, budget, and task-complete notifications to the main agent', kind: 'system', routable: true, recommendedTier: 'cheap' },
  { id: 'team-routing', label: 'Team routing', description: 'Team-assignment classification calls', kind: 'system', routable: true, recommendedTier: 'cheap' },
  { id: 'send', label: 'Direct send', description: 'Operator/UI messages sent straight to an agent', kind: 'system', routable: true },
  { id: 'chat', label: 'Chat', description: 'Interactive chat turns (metered only — model choice stays with the operator)', kind: 'system', routable: false },
]

export const DISPATCH_WORK_CLASSES: readonly DispatchWorkClass[] = ['scheduled', 'workflow', 'adhoc', 'recovery', 'decomposition']

export const ROUTABLE_WORK_CLASSES: readonly WorkClass[] = WORK_CLASSES.filter((c) => c.routable).map((c) => c.id)

export interface WorkClassRoute {
  workClass: WorkClass
  /** Model id to route this class to; omit to inherit. */
  model?: string
  /** Thinking level for this class; omit or 'inherit' to leave the default. */
  thinking?: ThinkingSetting
}

export interface TagOverride {
  tag: string
  model?: string
  thinking?: ThinkingSetting
}

export interface RoutingConfig {
  routes: WorkClassRoute[]
  tagOverrides: TagOverride[]
}

/** The slice of a task the dispatch classifier reads — class signals + tags. */
export interface RoutableTask {
  tags?: string[]
  scheduleJobId?: string
  workflowId?: string
  parentId?: string | null
}

/**
 * How a turn's model/thinking were chosen — the route receipt's provenance
 * half, recorded on the run_costs row so evidence rides the turn itself.
 */
export type RouteSource = `tag:${string}` | 'class' | 'inherit'

/** The resolved per-turn overrides. No model/thinking = inherit (unchanged dispatch). */
export interface ResolvedTurn {
  model?: string
  thinking?: ThinkingLevel
  /** Which layer won: a tag override, the class route, or nothing (inherit). */
  source: RouteSource
  /** Present when the requested thinking level was clamped to the runtime's declared support. */
  thinkingClamp?: { requested: ThinkingLevel; applied: ThinkingLevel | undefined }
}

/**
 * Classify a dispatch turn's work class. `isRecovery` is a dispatch-context
 * signal (the recovery ladder re-dispatching after a session death), not a
 * task field, so it overrides the task-shape classes. Precedence:
 * recovery → workflow → scheduled → decomposition → adhoc.
 */
export function classifyDispatchWorkClass(task: RoutableTask, isRecovery: boolean): DispatchWorkClass {
  if (isRecovery) return 'recovery'
  if (task.workflowId) return 'workflow'
  if (task.scheduleJobId) return 'scheduled'
  if (task.parentId) return 'decomposition'
  return 'adhoc'
}

function normalizeThinking(setting: ThinkingSetting | undefined): ThinkingLevel | undefined {
  return setting && setting !== 'inherit' ? setting : undefined
}

/**
 * Resolve the per-turn model + thinking overrides for a work class. model and
 * thinking resolve INDEPENDENTLY, each taking the first layer that specifies
 * it: tag override → class route → inherit. A tag can override just the model
 * while thinking falls through to the class route (and vice versa). The first
 * tag in the list that has a matching override wins. System call sites pass
 * no tags — tags are a task concept.
 */
export function resolveWorkClassRoute(config: RoutingConfig, workClass: WorkClass, tags?: string[]): ResolvedTurn {
  const tag = (tags ?? [])
    .map((t) => config.tagOverrides.find((o) => o.tag === t))
    .find((o): o is TagOverride => o !== undefined)
  const route = config.routes.find((r) => r.workClass === workClass)

  const model = tag?.model ?? route?.model
  const thinking = normalizeThinking(tag?.thinking) ?? normalizeThinking(route?.thinking)

  // Provenance: a tag override that contributed anything wins the receipt;
  // else the class route; else inherit.
  const tagContributed = tag !== undefined && (tag.model !== undefined || normalizeThinking(tag.thinking) !== undefined)
  const routeContributed = route !== undefined && (route.model !== undefined || normalizeThinking(route.thinking) !== undefined)
  const source: RouteSource = tagContributed ? `tag:${tag.tag}` : routeContributed ? 'class' : 'inherit'

  return {
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    source,
  }
}

/**
 * Ordinal thinking ladder for clamping — 'max' sits above 'xhigh';
 * 'adaptive' has no ordinal (clamps to inherit when unsupported).
 */
const THINKING_LADDER: readonly ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export interface ThinkingClampResult {
  /** Level to actually send; undefined = inherit (no override). */
  applied: ThinkingLevel | undefined
  /** True when applied differs from requested — surface it, never silent. */
  clamped: boolean
}

/**
 * Clamp a requested thinking level to what the active runtime declares it
 * honors (clamp-and-warn — the fix for Pi silently dropping 'max'/'adaptive').
 * Unsupported ordinal levels clamp DOWN to the nearest supported level;
 * 'adaptive' (no ordinal) clamps to inherit.
 */
export function clampThinkingLevel(requested: ThinkingLevel, supported: readonly string[]): ThinkingClampResult {
  if (supported.includes(requested)) return { applied: requested, clamped: false }
  const idx = THINKING_LADDER.indexOf(requested)
  if (idx === -1) return { applied: undefined, clamped: true } // adaptive
  for (let i = idx - 1; i >= 0; i--) {
    const candidate = THINKING_LADDER[i]
    if (supported.includes(candidate)) return { applied: candidate, clamped: true }
  }
  return { applied: undefined, clamped: true }
}

/**
 * Dispatch wrapper: classify the task's work class, then resolve its route
 * with the task's tags in play.
 */
export function resolveTurnModel(input: {
  task: RoutableTask
  isRecovery?: boolean
  config: RoutingConfig
}): ResolvedTurn {
  const workClass = classifyDispatchWorkClass(input.task, input.isRecovery ?? false)
  return resolveWorkClassRoute(input.config, workClass, input.task.tags)
}
