# Plan — Issue #125: Notification Channels Registry

**Spec:** `.claude/specs/issue-125-notification-channels-registry.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/125
**Branch:** `issue-125-notification-channels-registry`
**Precedent to mirror:** `plugins/workflows/lib/node-type-registry.ts` + wiring at `src/lib/plugin-registry.ts:204-216`

## Goal

Land the first Registry Extension Point — `workflows.notificationChannels` — as the proof-of-concept for the pattern that four more registries will follow (model providers, asset renderers, health checks, etc.). Finish the job started in #118: messaging's `CHANNEL_LABELS` / `CHANNEL_INITIALS` / `CHANNEL_ICONS` disappear, workflows' `NotifyChannel.channel` widens from the literal union to `string`, and plugins (including future third-parties) contribute channels via `ctx.registerNotificationChannel(...)`.

## Dependency graph

```
T0 scaffold (branch + archive #118 tasks)
  ↓
T1 core types ............................................ (foundation)
  ↓
T2 registry store + lazy builtin seeding ................. (depends on T1)
  ↓
T3 plugin-registry wiring + teardown path ................ (depends on T2)
  ↓
T4 workflows plugin: hooks + REST route .................. (depends on T3)
  ↓
  ├─ T5 client hook + ChannelIcon component .............. (depends on T4)
  │      ↓
  └─ T6 workflows type + zod widening .................... (independent of T5)
         ↓
         T7 messaging migration ........................... (needs T5 + T6)
            ↓
            T8 regression tests + full checkpoint
               ↓
               T9 ship
```

Solo sequential expected. Each task = one commit.

## Task detail

### T0 — chore(issue-125): spec + plan scaffold

**Already done:** branch `issue-125-notification-channels-registry` created from main; `tasks/plan.md` + `tasks/todo.md` git-mv'd to `.claude/tasks/issue-118-{plan,todo}.md` (staged).

**Still to do:** commit the archival + spec + new plan/todo.

**Acceptance:**
- [ ] Single commit `chore(issue-125): spec + plan scaffold`
- [ ] `git status` clean after commit
- [ ] Issue-118 archives visible at `.claude/tasks/issue-118-{plan,todo}.md`

---

### T1 — feat(core): NotificationChannel types + PluginContext.registerNotificationChannel

**Files:**
- `packages/core/src/plugin-types.ts` — add `PluginNotificationChannelInput`, `NotificationChannelDef` interfaces; add `registerNotificationChannel(def: PluginNotificationChannelInput): string` to `PluginContext`
- `src/lib/plugin-types.ts` — extend the re-export list

**Type shape:**

```ts
export interface PluginNotificationChannelInput {
  id: string
  label: string
  initials?: string
  icon?: string  // lucide icon export name (e.g. "MessageSquare")
}

export interface NotificationChannelDef extends PluginNotificationChannelInput {
  runtime: 'builtin' | 'plugin'
  pluginId?: string
}
```

**Acceptance:**
- [ ] Types exist and are exported from both `packages/core/src/plugin-types.ts` and re-exported via `src/lib/plugin-types.ts`
- [ ] `PluginContext` has `registerNotificationChannel(def: PluginNotificationChannelInput): string`
- [ ] `pnpm tsc --noEmit` passes (every plugin's `ctx` type still compiles; the new method is used nowhere yet — a stub in `plugin-registry.ts` will satisfy the interface in T3)

**Commit:** `feat(core): notification-channel types on PluginContext`

---

### T2 — feat(workflows): notification-channel-registry with lazy builtin seeding

**New file:** `plugins/workflows/lib/notification-channel-registry.ts` — mirrors `node-type-registry.ts`:

```ts
const registry = new Map<string, NotificationChannelDef>()

export function registerNotificationChannel(def: NotificationChannelDef): void
export function getNotificationChannel(id: string): NotificationChannelDef | undefined
export function listNotificationChannels(): NotificationChannelDef[]
export function unregisterNotificationChannel(id: string): void
export function unregisterPluginNotificationChannels(pluginId: string): void

/** Plugin wrapper — namespaces id to `{pluginId}.{id}`, returns namespaced id. */
export function registerPluginNotificationChannel(
  pluginId: string,
  input: PluginNotificationChannelInput,
): string

// ─── Built-in channels — lazy self-register at module load ─────────────────
registerNotificationChannel({ runtime: 'builtin', id: 'discord',   label: 'Discord',   initials: 'DC', icon: 'MessageSquare' })
registerNotificationChannel({ runtime: 'builtin', id: 'slack',     label: 'Slack',     initials: 'SL', icon: 'MessageSquare' })
registerNotificationChannel({ runtime: 'builtin', id: 'email',     label: 'Email',     initials: 'EM', icon: 'Mail' })
registerNotificationChannel({ runtime: 'builtin', id: 'instagram', label: 'Instagram', initials: 'IG', icon: 'Instagram' })
registerNotificationChannel({ runtime: 'builtin', id: 'twitter',   label: 'Twitter',   initials: 'TW', icon: 'Twitter' })
registerNotificationChannel({ runtime: 'builtin', id: 'youtube',   label: 'YouTube',   initials: 'YT', icon: 'Youtube' })
registerNotificationChannel({ runtime: 'builtin', id: 'tiktok',    label: 'TikTok',    initials: 'TK', icon: 'Music2' })
```

**New test:** `tests/plugins/workflows/notification-channel-registry.test.ts` — cover:
- register + get + list
- collision throw on duplicate id
- plugin helper namespaces ids as `{pluginId}.{id}`
- `unregisterPluginNotificationChannels(pluginId)` removes only that plugin's entries
- builtin-seeding fires at module load (list returns 7 channels without any explicit seed call)

**Acceptance:**
- [ ] Registry module loads 7 builtins immediately (no activation-order dependency)
- [ ] Unit test file passes 6+ assertions
- [ ] `pnpm tsc --noEmit` clean

**Commit:** `feat(workflows): notification-channel registry with builtin seeding`

---

### T3 — feat(core): wire registerNotificationChannel through plugin-registry

**File:** `src/lib/plugin-registry.ts`

- Import `registerPluginNotificationChannel`, `unregisterPluginNotificationChannels` alongside the existing node-type helpers (line 24 area)
- Add `channelIds: string[]` to `PluginState` (next to `nodeKinds`)
- Implement `ctx.registerNotificationChannel` mirroring `ctx.registerNodeType` at :204-216 — try/catch + log on collision, push namespaced id onto `state.channelIds`
- Call `unregisterPluginNotificationChannels(pluginId)` alongside `unregisterPluginNodeTypes(pluginId)` at :351 (user-plugin-overrides-builtin path)

**"Look first" verification during build:** grep for other teardown sites that call `unregisterPluginNodeTypes`; if any exist beyond :351, mirror the same call.

**Acceptance:**
- [ ] `ctx.registerNotificationChannel` returns namespaced id
- [ ] Teardown clears only the owning plugin's channels (existing contract-test pattern proves this)
- [ ] `pnpm tsc --noEmit` + full `pnpm vitest run` clean

**Commit:** `feat(core): wire registerNotificationChannel through plugin-registry`

---

### T4 — feat(workflows): expose channels via hooks + REST route

**File:** `plugins/workflows/index.ts`

- Register hooks in `activate(ctx)`:
  - `ctx.hooks.register('workflows.listNotificationChannels', () => listNotificationChannels())`
  - `ctx.hooks.register('workflows.getNotificationChannel', (d) => getNotificationChannel(d.id as string) ?? null)`
- Register REST route:
  - `GET /notification-channels` → `json({ channels: listNotificationChannels() })`

**Test:** extend `tests/plugins/workflows/` (either an existing routes test or a new `notification-channels-route.test.ts`) — activate plugin via `activatePlugin` helper, call the route, assert 7 built-in channels returned.

**Acceptance:**
- [ ] Hooks registered during activate
- [ ] `GET /api/plugins/workflows/notification-channels` returns 7 builtins
- [ ] Route + hook tests pass
- [ ] Full `pnpm vitest run` clean

**Commit:** `feat(workflows): expose notification channels via hooks + REST route`

---

### T5 — feat(workflows): client hook + ChannelIcon component

**New files:**
- `plugins/workflows/hooks/use-notification-channels.ts` — module-level promise cache + in-flight coalescing, mirroring `plugins/messaging/hooks/use-content-types.ts`:
  ```ts
  export function useNotificationChannels(): NotificationChannelDef[]
  export function getChannelLabel(id: string, channels: NotificationChannelDef[]): string
  export function getChannelInitials(id: string, channels: NotificationChannelDef[]): string
  export function __resetNotificationChannelsCache(): void  // test-only, NODE_ENV-guarded
  ```
  Fetches from `/api/plugins/workflows/notification-channels`. Falls back to empty array on error.

- `plugins/workflows/hooks/channel-icon.tsx` — small component that resolves a lucide name to a component via an **explicit map** (not `import * as Lucide`, which bundles everything):
  ```ts
  const CHANNEL_ICON_MAP = {
    MessageSquare, Mail, Instagram, Twitter, Youtube, Music2, HelpCircle,
  }
  // <ChannelIcon channelId="discord" className="size-3.5" />
  ```
  Falls back to `HelpCircle` for unknown names. Plugin-contributed channels with non-map icons render the fallback — accepted for v1.

**Test:** `tests/plugins/workflows/use-notification-channels.test.tsx` — mocks `fetch`, verifies single-flight coalescing across two concurrent callers (mirrors the `useContentTypes` test pattern in PR #121).

**Acceptance:**
- [ ] Hook returns channels from cache after first fetch
- [ ] Two concurrent callers trigger one `fetch` (single-flight)
- [ ] `getChannelLabel` / `getChannelInitials` return raw id as fallback for unknown channels
- [ ] `ChannelIcon` renders `HelpCircle` for unknown/missing icon
- [ ] Tests pass

**Commit:** `feat(workflows): client hook + ChannelIcon for notification channels`

---

### T6 — refactor(workflows): widen NotifyChannel.channel to string

**Files:**
- `plugins/workflows/types.ts:25` — `channel: 'discord' | 'slack'` → `channel: string`
- `plugins/workflows/lib/node-type-registry.ts:145-148` — `notifyChannelSchema.channel: z.enum(['discord', 'slack'])` → `z.string().min(1)`

**"Look first" verification:** grep for any test that asserts the zod enum shape specifically, e.g. `expect(...).toThrow` on `channel: 'email'` being invalid. If any, update.

**Acceptance:**
- [ ] Existing workflow YAML with `notify: { channel: discord, target: ... }` loads
- [ ] New YAML with `notify: { channel: email, target: ... }` loads (previously would have been rejected by the zod enum)
- [ ] `pnpm tsc --noEmit` clean
- [ ] Full `pnpm vitest run` clean

**Commit:** `refactor(workflows): widen NotifyChannel.channel to string`

---

### T7 — refactor(messaging): migrate channel consumers to registry

**Files:**
- `plugins/messaging/components/item-detail-drawer.tsx` — sites at :295-313 (channel chip selector) and :532-534 (channel display):
  - `CHANNEL_LABELS[ch]` → `getChannelLabel(ch, channels)`
  - `CHANNEL_INITIALS[ch]` → `getChannelInitials(ch, channels)`
  - Add `const channels = useNotificationChannels()` near the top of the component
- `plugins/messaging/components/content-calendar.tsx` — sites at :84-97:
  - Delete local `CHANNEL_ICONS` map (lines 84-91)
  - Replace module-level `CHANNEL_OPTIONS` derivation with in-component derivation driven by `useNotificationChannels()`
  - `<ChannelIcon channelId={ch} />` replaces direct lucide component use where relevant
- `plugins/messaging/constants.ts` — delete `CHANNEL_LABELS` and `CHANNEL_INITIALS` constants (lines 26-44). Keep `STATUS_BADGE`, `TONE_LABELS`.

**Test mock updates (if existing messaging tests import the deleted constants):** swap to mocked `useNotificationChannels`. Mirror the pattern used for `useAgentStore` in `session-list.test.tsx`.

**Acceptance:**
- [ ] Grep: `CHANNEL_LABELS|CHANNEL_INITIALS|CHANNEL_ICONS` under `plugins/messaging/` returns zero hits
- [ ] `pnpm tsc --noEmit` clean
- [ ] Full `pnpm vitest run` clean
- [ ] Manual smoke: item drawer renders channel chips; calendar list renders channel icons

**Commit:** `refactor(messaging): resolve notification channels via workflows registry`

---

### T8 — test: regression guards + full checkpoint

**Add:**
- `tests/plugins/messaging/channel-rendering.test.tsx` (or extend an existing drawer test) — mocks `useNotificationChannels` with 3 channels, renders the drawer, asserts chips for each
- If no existing orphan-channel test exists: add one that passes an item with `channel: 'mastodon'` (not in registry) and asserts the drawer renders the raw id without crashing

**Full run:** `pnpm tsc --noEmit` + `pnpm vitest run` both clean.

**Acceptance:**
- [ ] Two new regression tests pass
- [ ] Full test suite + tsc green

**Commit:** `test(channels): regression guards for registry consumers`

---

### T9 — Ship

- [ ] Manual smoke on maintainer's install: open messaging item → channel chips render; open calendar → channel icons render; create/edit a workflow with `notify: { channel: email, ... }` → validates
- [ ] `git push -u origin issue-125-notification-channels-registry`
- [ ] Open PR against `main`, reference #125, link spec + one-pager
- [ ] Merge when green
- [ ] Close #125 with before/after summary
- [ ] Archive `tasks/plan.md` + `tasks/todo.md` → `.claude/tasks/issue-125-{plan,todo}.md`

## Commit strategy

One PR, 8 commits (T0 scaffold + T1–T8). Each commit self-contained: tsc clean, tests pass, runtime behavior preserved (T5 ships the hook before T7 consumes it, so each intermediate commit still builds and runs).

## Risks / call-outs

- **T3 teardown site audit.** The plan assumes `:351` is the only place that drops per-plugin node-type registrations. Verify during T3; if there are more, mirror all of them for channels.
- **T5 ChannelIcon bundle size.** Using an explicit map (not `import * as Lucide`) caps the lucide surface we pull into the client bundle. Plugins with exotic icons get `HelpCircle`. Accept for v1.
- **T6 zod widening backwards compat.** Existing YAML with `channel: 'discord'` or `'slack'` still passes `z.string().min(1)`. Risk is only if some test asserts the enum rejects non-builtin channels — grep during T6.
- **T7 messaging test mocks.** At least one existing test (`item-detail-drawer.test.tsx` or similar) likely imports `CHANNEL_LABELS`. Update those mocks in the same commit — don't let test breakage leak across tasks.
- **Single-flight in T5.** The pattern is proven from `useContentTypes` but the test needs to trigger two mounts in the same tick. Use the same test pattern as PR #121.
