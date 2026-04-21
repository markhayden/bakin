/**
 * Notification-channel registry — single source of truth for the set of
 * channels a workflow can notify (gate alerts, messaging publishes, etc).
 *
 * Builtins self-register at the bottom of this module, matching the
 * node-type-registry precedent. Plugins register their own channels via
 * `ctx.registerNotificationChannel()`, which calls `registerPluginNotificationChannel()`
 * here. Plugin ids are auto-namespaced as `{pluginId}.{id}` to avoid
 * cross-plugin collisions with the shared builtin ids.
 */
import type {
  NotificationChannelDef,
  PluginNotificationChannelInput,
} from '../../../packages/core/src/plugin-types'

export type { NotificationChannelDef, PluginNotificationChannelInput }

// ─── Registry store ─────────────────────────────────────────────────────────

const registry = new Map<string, NotificationChannelDef>()

export function registerNotificationChannel(def: NotificationChannelDef): void {
  if (registry.has(def.id)) {
    throw new Error(`Notification channel "${def.id}" is already registered`)
  }
  registry.set(def.id, def)
}

export function getNotificationChannel(id: string): NotificationChannelDef | undefined {
  return registry.get(id)
}

export function listNotificationChannels(): NotificationChannelDef[] {
  return Array.from(registry.values())
}

/** Remove a single registration. Useful for test cleanup. */
export function unregisterNotificationChannel(id: string): void {
  registry.delete(id)
}

/** Remove every channel owned by a plugin. Called at plugin teardown / hot reload. */
export function unregisterPluginNotificationChannels(pluginId: string): void {
  for (const [id, def] of registry.entries()) {
    if (def.runtime === 'plugin' && def.pluginId === pluginId) {
      registry.delete(id)
    }
  }
}

// ─── Plugin-side registration helper ────────────────────────────────────────

/**
 * Register a plugin-owned notification channel. The id is auto-namespaced
 * to `{pluginId}.{id}` so two plugins can ship the same unprefixed id
 * without colliding. Returns the namespaced id so callers can reference
 * it from downstream code and tests.
 */
export function registerPluginNotificationChannel(
  pluginId: string,
  input: PluginNotificationChannelInput,
): string {
  const namespacedId = `${pluginId}.${input.id}`
  registerNotificationChannel({
    runtime: 'plugin',
    pluginId,
    id: namespacedId,
    label: input.label,
    initials: input.initials,
    icon: input.icon,
  })
  return namespacedId
}

// ─── Built-in channels — lazy self-register at module load ──────────────────
//
// Seeding happens here (not inside the workflows plugin's activate) so the
// registry is ready before any other plugin's activate runs. This avoids an
// activation-order dependency where a plugin activated before workflows would
// see an empty registry.

registerNotificationChannel({ runtime: 'builtin', id: 'discord',   label: 'Discord',   initials: 'DC', icon: 'MessageSquare' })
registerNotificationChannel({ runtime: 'builtin', id: 'slack',     label: 'Slack',     initials: 'SL', icon: 'MessageSquare' })
registerNotificationChannel({ runtime: 'builtin', id: 'email',     label: 'Email',     initials: 'EM', icon: 'Mail' })
registerNotificationChannel({ runtime: 'builtin', id: 'instagram', label: 'Instagram', initials: 'IG', icon: 'Instagram' })
registerNotificationChannel({ runtime: 'builtin', id: 'twitter',   label: 'Twitter',   initials: 'TW', icon: 'Twitter' })
registerNotificationChannel({ runtime: 'builtin', id: 'youtube',   label: 'YouTube',   initials: 'YT', icon: 'Youtube' })
registerNotificationChannel({ runtime: 'builtin', id: 'tiktok',    label: 'TikTok',    initials: 'TK', icon: 'Music2' })
