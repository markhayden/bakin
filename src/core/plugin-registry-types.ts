/**
 * Shared types for the server-side plugin registry.
 *
 * Extracted from plugin-registry.ts (the public barrel) so the registry
 * implementation, the topological sort, and the activation helpers can share
 * one definition without the file owning every concern. plugin-registry.ts
 * re-exports `CorePluginRegistration` to keep its public surface unchanged.
 */
import type {
  BakinPlugin,
  PluginContext,
  NavItem,
  RegisteredAPIRoute,
  UISlotRegistration,
} from '@bakin/core/plugin-types'
import type { PluginManifest as PublicPluginManifest } from '@makinbakin/sdk/types'

/**
 * One entry in the static core-plugin table that `server.ts` registers via
 * `registerCorePlugins` on startup — this is what lets `bun build --compile`
 * trace each plugin's module graph from the entry point.
 */
export interface CorePluginRegistration {
  plugin: BakinPlugin
  manifest: PublicPluginManifest
}

export interface PluginState {
  plugin: BakinPlugin
  manifest?: PublicPluginManifest
  source: 'core' | 'user'
  description: string
  navItems: NavItem[]
  routes: RegisteredAPIRoute[]
  slots: UISlotRegistration[]
  watchPatterns: string[]
  /** Namespaced workflow node kinds registered via ctx.registerNodeType. */
  nodeKinds: string[]
  /** Namespaced notification channel ids registered via ctx.registerNotificationChannel. */
  channelIds: string[]
  /** Namespaced health check ids registered via ctx.registerHealthCheck. */
  healthCheckIds: string[]
  /** Namespaced repair action ids registered via ctx.registerHealthRepairAction. */
  healthRepairActionIds: string[]
  /** Cached PluginContext — handed to onUninstall during plugin remove (#119). */
  ctx?: PluginContext
}

export interface PluginFailureState {
  id: string
  name: string
  version: string
  description: string
  source: 'built-in' | 'user'
  errorCode: 'manifest_invalid' | 'missing_dependency' | 'dependency_cycle' | 'dependency_failed' | 'activation_failed' | 'incompatible_host'
  errorMessage: string
  missingDependencies?: string[]
}

export interface PluginLoadEntry {
  path: string
  id: string
  deps: string[]
  manifest?: PublicPluginManifest
}
