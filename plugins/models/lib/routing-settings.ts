/**
 * Reads this plugin's persisted routing config + page mode (leaf module:
 * shared by the selections mutator, the catalog overlay and the plan
 * composition without any of them importing each other).
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import type { RoutingConfig } from '../../../src/core/model-routing'
import type { UiMode } from '../../../src/core/model-selections'
import { isLegacyRouting, migrateLegacyRouting } from '../../../src/core/routing-migration'
import type { ModelsPluginSettings } from '../types'

export function readRoutingSettings(ctx: PluginContext): { routing: RoutingConfig; uiMode: UiMode | null } {
  const settings = ctx.getSettings<ModelsPluginSettings>()
  const stored = settings.routing
  const routing = isLegacyRouting(stored) ? migrateLegacyRouting(stored) : (stored ?? { routes: [], tagOverrides: [] })
  const uiMode = settings.ui?.mode === 'simple' || settings.ui?.mode === 'advanced' ? settings.ui.mode : null
  return { routing, uiMode }
}
