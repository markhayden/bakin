/**
 * Schedule plugin context cell.
 *
 * The single source of the activated PluginContext, shared by every schedule
 * seam module. The scheduler loop, heal path, and fire engine run with no
 * incoming request, so they read ctx from here rather than threading it.
 *
 * MUST be exactly one cell: if any module kept its own copy, the test hook
 * `__scheduleTestInternals.setPluginCtxForTests` would set the wrong one and
 * the cron-dedup / blocked-fire-routing tests would silently exercise a null
 * ctx (the audit calls are optional-chained).
 */
import type { PluginContext } from '@bakin/core/plugin-types'

let pluginCtx: PluginContext | null = null

export function setPluginCtx(ctx: PluginContext | null): void {
  pluginCtx = ctx
}

export function getPluginCtx(): PluginContext | null {
  return pluginCtx
}
