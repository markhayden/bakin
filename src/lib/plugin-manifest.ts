/**
 * TRANSITIONAL STUB — Phase E of #147.
 *
 * The pre-migration aggregation lived here and statically imported each
 * plugin's client.tsx to build `allNavItems` + register node renderers.
 * Phase F's runtime loader (`/api/plugins/manifest` + `PluginHost`)
 * supersedes this. For the TE1..TF3 window the sidebar has no nav items
 * and plugin-contributed node kinds don't render — acceptable per
 * operating principle 3 (broken mid-migration).
 */
import type { NavItem } from './plugin-types'

export const allNavItems: NavItem[] = []
