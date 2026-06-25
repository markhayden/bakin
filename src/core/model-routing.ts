/**
 * Per-turn model + thinking routing — Bakin-owned policy resolved at dispatch
 * time. Bakin decides WHICH model/thinking a turn gets; OpenClaw SERVES it
 * (the adapter passes `model`/`thinking` to the gateway `agent` RPC).
 *
 * The adapter is the only place that talks to the runtime; this module just
 * decides the values. The routing key is the turn's dispatch ORIGIN
 * (deterministic, no classification needed) with a per-task TAG override.
 * A turn that matches no tag and no origin policy resolves to nothing —
 * which means "inherit": the adapter passes no model and OpenClaw uses the
 * agent's configured default, exactly as before routing existed. So the
 * per-agent/global tail of the cascade is the runtime's existing default
 * behavior, not something this resolver reproduces.
 *
 * Pure functions — no I/O. Dispatch loads the RoutingConfig (from the models
 * plugin settings via a hook) and calls resolveTurnModel before each turn.
 */

/** Runtime thinking levels the adapter forwards as the per-turn thinking param. */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'adaptive' | 'max'

/** A policy may explicitly inherit (no thinking override) — distinct from unset. */
export type ThinkingSetting = ThinkingLevel | 'inherit'

/** Deterministic dispatch origin — the primary routing key. */
export type Origin = 'scheduled' | 'workflow' | 'adhoc' | 'recovery' | 'decomposition'

export const ORIGINS: readonly Origin[] = ['scheduled', 'workflow', 'adhoc', 'recovery', 'decomposition']

export interface RoutingPolicy {
  origin: Origin
  /** Model id to route this origin to; omit to inherit. */
  model?: string
  /** Thinking level for this origin; omit or 'inherit' to leave the default. */
  thinking?: ThinkingSetting
}

export interface TagOverride {
  tag: string
  model?: string
  thinking?: ThinkingSetting
}

export interface RoutingConfig {
  policies: RoutingPolicy[]
  tagOverrides: TagOverride[]
}

/** The slice of a task the resolver reads — origin signals + tags. */
export interface RoutableTask {
  tags?: string[]
  scheduleJobId?: string
  workflowId?: string
  parentId?: string | null
}

/** The resolved per-turn overrides. Empty object = inherit (unchanged dispatch). */
export interface ResolvedTurn {
  model?: string
  thinking?: ThinkingLevel
}

/**
 * Classify a turn's origin. `isRecovery` is a dispatch-context signal (the
 * recovery ladder re-dispatching after a session death), not a task field, so
 * it overrides the task-shape origins. Precedence:
 * recovery → workflow → scheduled → decomposition → adhoc.
 */
export function classifyOrigin(task: RoutableTask, isRecovery: boolean): Origin {
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
 * Resolve the per-turn model + thinking overrides. model and thinking resolve
 * INDEPENDENTLY, each taking the first layer that specifies it: tag override
 * → origin policy → inherit. A tag can override just the model while thinking
 * falls through to the origin policy (and vice versa). The first tag in the
 * task's tag list that has a matching override wins.
 */
export function resolveTurnModel(input: {
  task: RoutableTask
  isRecovery?: boolean
  config: RoutingConfig
}): ResolvedTurn {
  const { task, config } = input
  const origin = classifyOrigin(task, input.isRecovery ?? false)
  const tag = (task.tags ?? [])
    .map((t) => config.tagOverrides.find((o) => o.tag === t))
    .find((o): o is TagOverride => o !== undefined)
  const policy = config.policies.find((p) => p.origin === origin)

  const model = tag?.model ?? policy?.model
  const thinking = normalizeThinking(tag?.thinking) ?? normalizeThinking(policy?.thinking)

  return {
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
  }
}
