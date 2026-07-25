/**
 * One-shot migration of the origin-shaped routing config ({policies:
 * [{origin,…}]}) into work-class routes ({routes: [{workClass,…}]}). Runs
 * once at plugin activation: a legacy-shaped `routing` setting is mapped,
 * written back, and the old key is gone. Origin names map 1:1 onto the five
 * dispatch work classes. Like the budget migration, a read-guard also
 * migrates on READ (a settings file restored after the one-shot ran must
 * never make dispatch silently ignore routes the operator believes exist).
 */
import { DISPATCH_WORK_CLASSES, type DispatchWorkClass, type RoutingConfig, type TagOverride, type ThinkingSetting } from '../../../src/core/model-routing'

interface LegacyRoutingPolicy {
  origin: string
  model?: string
  thinking?: ThinkingSetting
}
export interface LegacyRoutingConfig {
  policies: LegacyRoutingPolicy[]
  tagOverrides?: TagOverride[]
}

/** True when the stored routing config is the pre-work-class shape. */
export function isLegacyRouting(routing: unknown): routing is LegacyRoutingConfig {
  if (routing === null || typeof routing !== 'object') return false
  const r = routing as Record<string, unknown>
  return !('routes' in r) && 'policies' in r
}

/** Map origins to work classes 1:1; unknown origins are dropped, not guessed. */
export function migrateLegacyRouting(legacy: LegacyRoutingConfig): RoutingConfig {
  const routes = (legacy.policies ?? [])
    .filter((p): p is LegacyRoutingPolicy & { origin: DispatchWorkClass } =>
      (DISPATCH_WORK_CLASSES as readonly string[]).includes(p.origin))
    .map((p) => ({
      workClass: p.origin,
      ...(p.model ? { model: p.model } : {}),
      ...(p.thinking ? { thinking: p.thinking } : {}),
    }))
  return { routes, tagOverrides: legacy.tagOverrides ?? [] }
}
