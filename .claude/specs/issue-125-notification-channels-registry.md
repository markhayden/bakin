# Notification Channels Registry (#125)

**Status:** Draft
**Tracking issue:** [#125](https://github.com/markhayden/bakin/issues/125)
**Depends on:** #118 (merged, PR #121)
**Unblocks:** broader plugin-system spec (five registry extension points, of which this is #2)

## Problem Statement

Core plugins still hardcode the set of notification channels they know about:

- `plugins/workflows/types.ts:25` — `NotifyChannel.channel: 'discord' | 'slack'` (union type)
- `plugins/messaging/constants.ts:26-44` — `CHANNEL_LABELS` / `CHANNEL_INITIALS` as static `Record<ContentChannel, string>` maps
- `plugins/messaging/components/content-calendar.tsx:84-91` — `CHANNEL_ICONS` map of lucide components

Adding a new channel today requires editing each of those files. That doesn't scale as a plugin-system reference pattern, and the messaging refactor (#118) explicitly deferred the channel piece pending this registry.

## Goals

- Establish the first **extension-point registry** as a working pattern other registries (model providers, asset renderers, health checks) can follow. Mirror the existing `registerNodeType` shape as closely as the notification domain allows.
- One `ctx.registerNotificationChannel(...)` surface on `PluginContext`; workflows plugin owns the registry store and exposes cross-plugin read hooks.
- Replace messaging's hardcoded `CHANNEL_LABELS` / `CHANNEL_INITIALS` / `CHANNEL_ICONS` reads with a runtime lookup against the registry.
- Widen `NotifyChannel.channel` from `'discord' | 'slack'` to `string` (registry-referenced id); existing workflow YAML continues to load.
- Zero-touch for third-party plugins that want to contribute new channels post-marketplace — same contract as the node-type registry.

## Non-Goals

- Not changing how channels actually **deliver** messages. `sendChannelMessage('discord', ...)` and friends in `src/core/openclaw-client.ts` stay exactly as today.
- Not building an admin UI for viewing/managing registered channels. A `GET /api/plugins/workflows/notification-channels` route is enough for consumer plugins.
- Not adding channel contributions to the plugin manifest (`bakin-plugin.json`). Registry-only for now; manifest comes with the broader plugin-system spec.
- Not touching auth/config/targets per channel (Discord tokens, Slack webhooks, etc) — that stays in `BakinSettings` / per-plugin settings as today.
- Not building validation in the delivery path ("channel id X isn't registered"). Delivery stays duck-typed until it becomes a real pain.

## Design

### Types (core)

`packages/core/src/plugin-types.ts` adds a small section after the node-type block. No React dependency — icons are string names that consumers resolve to components.

```ts
// ---------------------------------------------------------------------------
// Notification channel registration
// ---------------------------------------------------------------------------

/**
 * Input shape plugins pass to `ctx.registerNotificationChannel`. The plugin id
 * is prepended to `id` automatically (`{pluginId}.{id}`), matching the node-
 * type precedent. Built-in workflows-plugin channels are registered directly
 * via `registerNotificationChannel()` without the plugin wrapper, so they keep
 * their short ids (`discord`, `slack`, ...) for backwards compat with existing
 * workflow YAML.
 */
export interface PluginNotificationChannelInput {
  id: string
  label: string
  /** Optional 2-character badge (e.g. "DC", "IG"). Falls back to `id.slice(0, 2).toUpperCase()`. */
  initials?: string
  /** Lucide icon name (e.g. "MessageSquare"). Consumers resolve to components. */
  icon?: string
}

export interface NotificationChannelDef extends PluginNotificationChannelInput {
  runtime: 'builtin' | 'plugin'
  pluginId?: string
}
```

### Registry store (workflows plugin)

New file: `plugins/workflows/lib/notification-channel-registry.ts`. Copies the shape of `node-type-registry.ts`:

```ts
const registry = new Map<string, NotificationChannelDef>()

export function registerNotificationChannel(def: NotificationChannelDef): void {
  if (registry.has(def.id)) {
    throw new Error(`Notification channel "${def.id}" is already registered`)
  }
  registry.set(def.id, def)
}
export function getNotificationChannel(id: string): NotificationChannelDef | undefined
export function listNotificationChannels(): NotificationChannelDef[]
export function unregisterNotificationChannel(id: string): void
export function unregisterPluginNotificationChannels(pluginId: string): void

/** Plugin wrapper — namespaces id to `{pluginId}.{id}` and returns namespaced id. */
export function registerPluginNotificationChannel(
  pluginId: string,
  input: PluginNotificationChannelInput,
): string
```

### PluginContext surface

`packages/core/src/plugin-types.ts` — adds one method:

```ts
/**
 * Register a notification channel owned by this plugin. The id is
 * auto-namespaced to `{pluginId}.{id}`. Returns the namespaced id so
 * callers can wire delivery hooks against it.
 */
registerNotificationChannel(def: PluginNotificationChannelInput): string
```

`src/lib/plugin-registry.ts` — wires it through the same way `registerNodeType` does (imports `registerPluginNotificationChannel` / `unregisterPluginNotificationChannels`, tracks namespaced ids per plugin, cleans up on teardown).

### Built-in seeding — lazy at module load

`plugins/workflows/lib/notification-channel-registry.ts` seeds the seven built-in channels **at the bottom of the module file**, matching the `node-type-registry.ts` precedent (which self-registers `agent`, `gate`, `parallel`, `output`, `workflow` the same way).

```ts
// ─── Built-in channels (self-register on module load) ──────────────────────

registerNotificationChannel({ runtime: 'builtin', id: 'discord',   label: 'Discord',   initials: 'DC', icon: 'MessageSquare' })
registerNotificationChannel({ runtime: 'builtin', id: 'slack',     label: 'Slack',     initials: 'SL', icon: 'MessageSquare' })
registerNotificationChannel({ runtime: 'builtin', id: 'email',     label: 'Email',     initials: 'EM', icon: 'Mail' })
registerNotificationChannel({ runtime: 'builtin', id: 'instagram', label: 'Instagram', initials: 'IG', icon: 'Instagram' })
registerNotificationChannel({ runtime: 'builtin', id: 'twitter',   label: 'Twitter',   initials: 'TW', icon: 'Twitter' })
registerNotificationChannel({ runtime: 'builtin', id: 'youtube',   label: 'YouTube',   initials: 'YT', icon: 'Youtube' })
registerNotificationChannel({ runtime: 'builtin', id: 'tiktok',    label: 'TikTok',    initials: 'TK', icon: 'Music2' })
```

Rationale for lazy vs activate-time: seeding in `activate()` creates an activation-order dependency — any plugin that activates before workflows would see an empty registry. Module-load seeding eliminates that class of bug, matches the node-type precedent, and is free (seven map inserts).

### Cross-plugin read surface (hooks)

`plugins/workflows/index.ts` — registers two hooks for server-side consumers:

```ts
ctx.hooks.register('workflows.listNotificationChannels', () => listNotificationChannels())
ctx.hooks.register('workflows.getNotificationChannel', (d: Record<string, unknown>) => {
  return getNotificationChannel(d.id as string) ?? null
})
```

### Client-side read surface (REST + hook)

`plugins/workflows/index.ts` — registers a GET route:

```ts
ctx.registerRoute({
  path: '/notification-channels',
  method: 'GET',
  description: 'List registered notification channels',
  handler: async () => json({ channels: listNotificationChannels() }),
})
```

Exposes at `/api/plugins/workflows/notification-channels`.

New file: `plugins/workflows/hooks/use-notification-channels.ts` — mirrors the shape of `plugins/messaging/hooks/use-content-types.ts` (module-level promise cache, in-flight coalescing, `__resetCache` for tests):

```ts
'use client'
export function useNotificationChannels(): NotificationChannelDef[]
export function getChannelLabel(id: string, channels: NotificationChannelDef[]): string
export function getChannelInitials(id: string, channels: NotificationChannelDef[]): string
```

Lucide icon resolution happens in a small component adjacent to the hook so consumers can `<ChannelIcon channelId="discord" className="size-3.5" />` without leaking lucide-name-to-component plumbing into each plugin.

### Migration — messaging consumers

Replace the three messaging sites:

1. `plugins/messaging/components/item-detail-drawer.tsx:295-313` and `:532-534` — swap `CHANNEL_LABELS[ch]` / `CHANNEL_INITIALS[ch]` reads for `getChannelLabel(ch, channels)` / `getChannelInitials(ch, channels)` where `channels = useNotificationChannels()`.
2. `plugins/messaging/components/content-calendar.tsx:84-97` — delete `CHANNEL_ICONS` map; replace `CHANNEL_OPTIONS` module-level derivation with an inside-component derivation driven by `useNotificationChannels()`.
3. `plugins/messaging/constants.ts:26-44` — delete `CHANNEL_LABELS` and `CHANNEL_INITIALS` entirely. Keep `STATUS_BADGE` and `TONE_LABELS` (out of scope, see #118 spec).

### Migration — workflows consumers

- `plugins/workflows/types.ts:25` — `NotifyChannel.channel: 'discord' | 'slack'` widens to `string`. Existing YAML still parses; delivery path unchanged.

## Acceptance Criteria

- [ ] `registerNotificationChannel` on `PluginContext`, namespaces plugin ids as `{pluginId}.{id}`
- [ ] Workflows plugin owns `plugins/workflows/lib/notification-channel-registry.ts` with seven built-in channels seeded at activate
- [ ] `workflows.listNotificationChannels` + `workflows.getNotificationChannel` hooks registered
- [ ] `GET /api/plugins/workflows/notification-channels` returns `{ channels: [...] }`
- [ ] `useNotificationChannels()` client hook with module-level cache, in-flight coalescing, and `__resetCache` for tests
- [ ] Messaging's `CHANNEL_LABELS`, `CHANNEL_INITIALS`, `CHANNEL_ICONS` consumers migrated to registry reads
- [ ] `CHANNEL_LABELS` and `CHANNEL_INITIALS` removed from `plugins/messaging/constants.ts`
- [ ] `NotifyChannel.channel` widened to `string` in `plugins/workflows/types.ts`
- [ ] Existing workflow YAML with `notify: { channel: discord, ... }` loads without change
- [ ] `pnpm tsc --noEmit` + full `pnpm vitest run` clean
- [ ] Plugin registry cleanup (`unregisterPluginNotificationChannels`) runs on plugin teardown so hot reload doesn't accumulate
- [ ] Unit tests: registry add/collision/list/get/unregister + plugin namespacing
- [ ] Integration test: messaging item-detail-drawer renders channel chips sourced from the registry

## Testing Strategy

Follow `.claude/specs/messaging-refactor.md` and CLAUDE.md test rules (mock `content-dir`, `logger`, `watcher`, `openclaw-client`; never touch `~/.bakin/`).

- **Unit:** `notification-channel-registry.ts` full surface (register / get / list / unregister, collision throw, plugin namespacing, plugin teardown clears only that plugin's entries)
- **Integration:** activate the workflows plugin through `activatePlugin` helper, call the `/notification-channels` route, verify seven built-in channels returned
- **Client:** `useNotificationChannels.test.ts` — mocks fetch, verifies single-flight coalescing across two concurrent callers (mirrors the pattern validated in PR #121 for `useContentTypes`)
- **Regression:** messaging drawer test renders with a mocked `useNotificationChannels` returning three channels; asserts chips appear for each

## Sequencing

1. Core types + plugin context surface (`packages/core/src/plugin-types.ts`, `src/lib/plugin-registry.ts`) — one commit
2. Registry store + workflows-plugin seeding + hooks + REST route — one commit
3. Client hook + icon-resolver component — one commit
4. Messaging consumer migration + messaging constants cleanup — one commit
5. Workflow type widening — one commit (bundles with #2 if it stays small)
6. Tests + regression guards — one commit
7. Ship — PR, smoke, merge

## Not Doing (and Why)

- **Manifest declaration (`bakin-plugin.json` channel list)** — registry-only for now; manifest is the plugin-system spec's job
- **Admin UI for channel registry** — the cross-plugin read hook + REST route is sufficient
- **Replacing the delivery path** (`sendChannelMessage`) — send pipeline stays as-is
- **Registering channel delivery handlers** (e.g. `workflows.deliverChannel.{id}` hook) — delivery-layer extension is its own concern; not needed until a plugin actually wants to add a new send target
- **Validation at delivery time** — the delivery path stays duck-typed; if a plugin sends on an unregistered channel, today's behavior (the send fails or is ignored) continues
- **Dynamic icon components** — icons are stored as lucide string names; consumers resolve to components client-side via a small helper. Keeps core types React-free
- **Reordering or priority on channels** — `listNotificationChannels()` returns insertion order; no priority system in v1

## Resolved Decisions

- **Icon shape:** plain `icon: string` holding a lucide-react export name. Future-non-lucide consumers (emoji, SVG) will be accommodated by widening the field to `string | IconSpec` later — non-breaking.
- **Registration timing:** lazy / module-load seeding in `notification-channel-registry.ts`, matching the node-type-registry precedent. No activation-order dependency.
- **Channel capabilities:** deferred. Add `capabilities?: string[]` when a consumer asks.

## Open Questions

- **Client-side refresh on registry change.** Issue #124 already tracks this problem generically (settings changes don't propagate to the UI without refresh). Follow the same "accept refresh, improve later" posture here.
