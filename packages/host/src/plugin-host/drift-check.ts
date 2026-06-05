/**
 * Drift validation for declarative plugin manifests (lazy loading).
 *
 * A lazily-loaded plugin's sidebar nav, route ownership, and slot ownership
 * come from `bakin-plugin.json` `contributes.{nav,routes,slots}` — but the
 * actual registrations happen when its client bundle finally executes
 * `registerPlugin`. If the two drift apart, symptoms are subtle (a route
 * that 404s until some unrelated slot loads the client, nav that vanishes
 * after hot-swap), so the host checks every loaded client against its
 * manifest and warns loudly.
 *
 * Runs as a startup diagnostic after each client import (eager or lazy).
 * The CI-side twin lives in tests/plugins/manifest-drift.test.tsx, which
 * imports every core plugin's client and applies the same comparison.
 */
import {
  getManifestNav,
  getPluginNavItems,
  getPluginRoutes,
  type NavItem,
  type PluginContributions,
} from '@makinbakin/sdk'
import { getSlotNamesOwnedBy } from '@makinbakin/sdk/slots'

/**
 * Compare a loaded plugin's runtime registrations against its declarative
 * manifest metadata. Returns human-readable drift warnings; empty when in
 * sync. Plugins with no declarative client metadata (legacy, eager-loaded)
 * are exempt — they have nothing to drift from.
 */
export function checkPluginDrift(
  pluginId: string,
  contributes: PluginContributions | undefined,
): string[] {
  const declaredNav = contributes?.nav
  const declaredRoutes = contributes?.routes
  const declaredSlots = contributes?.slots
  if (!declaredNav && !declaredRoutes && !declaredSlots) return []

  const warnings: string[] = []

  // --- nav ---------------------------------------------------------------
  // A migrated plugin's client passes no navItems (manifest nav renders the
  // sidebar). Runtime navItems override manifest nav — that's the
  // conditional-nav escape hatch — but silently diverging from declared nav
  // is an authoring bug worth surfacing.
  const runtimeNav = getPluginNavItems(pluginId)
  if (runtimeNav.length > 0) {
    const manifestNav = getManifestNav(pluginId)
    if (manifestNav.length === 0) {
      warnings.push(
        `registers navItems at runtime but declares no contributes.nav — its sidebar entry won't exist until the client loads, defeating lazy loading`,
      )
    } else if (!navEquals(manifestNav, runtimeNav)) {
      warnings.push(
        `runtime navItems differ from contributes.nav (runtime wins while registered; remove contributes.nav if the override is intentional)`,
      )
    }
  }

  // --- routes ------------------------------------------------------------
  const runtimeRoutePaths = new Set(getPluginRoutes(pluginId).map((r) => r.path))
  const declaredRoutePaths = new Set((declaredRoutes ?? []).map((r) => r.path))
  for (const path of declaredRoutePaths) {
    if (!runtimeRoutePaths.has(path)) {
      warnings.push(`contributes.routes declares "${path}" but the client never registered it`)
    }
  }
  for (const path of runtimeRoutePaths) {
    if (!declaredRoutePaths.has(path)) {
      warnings.push(
        `client registers route "${path}" missing from contributes.routes — direct navigation there won't trigger a lazy load`,
      )
    }
  }

  // --- slots -------------------------------------------------------------
  const runtimeSlots = new Set(getSlotNamesOwnedBy(pluginId))
  const declaredSlotNames = new Set(declaredSlots ?? [])
  for (const name of declaredSlotNames) {
    if (!runtimeSlots.has(name)) {
      warnings.push(`contributes.slots declares "${name}" but the client never registered it`)
    }
  }
  for (const name of runtimeSlots) {
    if (!declaredSlotNames.has(name)) {
      warnings.push(
        `client registers slot "${name}" missing from contributes.slots — rendering that slot won't trigger a lazy load`,
      )
    }
  }

  return warnings
}

function navEquals(a: ReadonlyArray<NavItem>, b: ReadonlyArray<NavItem>): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
