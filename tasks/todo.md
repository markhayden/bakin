# TODO: Issue #125 — Notification channels registry

**Spec:** `.claude/specs/issue-125-notification-channels-registry.md`
**Plan:** `tasks/plan.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/125
**Branch:** `issue-125-notification-channels-registry`

## T0 — Branch + scaffold commit

- [x] `git checkout -b issue-125-notification-channels-registry`
- [x] Archive issue-118 tasks → `.claude/tasks/issue-118-{plan,todo}.md` (staged)
- [ ] Commit: `chore(issue-125): spec + plan scaffold`

## T1 — feat(core): notification-channel types on PluginContext

- [ ] Add `PluginNotificationChannelInput` + `NotificationChannelDef` in `packages/core/src/plugin-types.ts`
- [ ] Add `registerNotificationChannel(def): string` method to `PluginContext` interface
- [ ] Extend the re-export list in `src/lib/plugin-types.ts`
- [ ] Checkpoint: `pnpm tsc --noEmit` clean (will fail at plugin-registry stub until T3; acceptable to carry the stub `() => ''` in T1 to keep tsc green)
- [ ] Commit: `feat(core): notification-channel types on PluginContext`

## T2 — feat(workflows): registry store with lazy builtin seeding

- [ ] New file: `plugins/workflows/lib/notification-channel-registry.ts`
- [ ] Full surface: `registerNotificationChannel`, `getNotificationChannel`, `listNotificationChannels`, `unregisterNotificationChannel`, `unregisterPluginNotificationChannels`, `registerPluginNotificationChannel`
- [ ] Lazy-seed 7 builtins at bottom of module (discord, slack, email, instagram, twitter, youtube, tiktok) with lucide icon names
- [ ] New test: `tests/plugins/workflows/notification-channel-registry.test.ts` — cover register/get/list, collision throw, plugin namespacing, plugin teardown, module-load seeding
- [ ] Checkpoint: `pnpm vitest run tests/plugins/workflows/notification-channel-registry.test.ts`
- [ ] Commit: `feat(workflows): notification-channel registry with builtin seeding`

## T3 — feat(core): wire registerNotificationChannel through plugin-registry

- [ ] Import `registerPluginNotificationChannel` + `unregisterPluginNotificationChannels` in `src/lib/plugin-registry.ts`
- [ ] Add `channelIds: string[]` to `PluginState`
- [ ] Implement `ctx.registerNotificationChannel` at plugin-registry around line ~204 mirroring `registerNodeType` shape
- [ ] Mirror teardown: add `unregisterPluginNotificationChannels(pluginId)` call at :351 alongside the existing `unregisterPluginNodeTypes`
- [ ] "Look first": grep for other sites calling `unregisterPluginNodeTypes`; mirror all
- [ ] Checkpoint: `pnpm tsc --noEmit` + full `pnpm vitest run` clean
- [ ] Commit: `feat(core): wire registerNotificationChannel through plugin-registry`

## T4 — feat(workflows): hooks + REST route

- [ ] Register `workflows.listNotificationChannels` hook in `plugins/workflows/index.ts` activate
- [ ] Register `workflows.getNotificationChannel` hook
- [ ] Register `GET /notification-channels` route
- [ ] Test: route/hook integration test (use `activatePlugin` helper) — asserts 7 builtins returned
- [ ] Checkpoint: `pnpm vitest run tests/plugins/workflows/` clean
- [ ] Commit: `feat(workflows): expose notification channels via hooks + REST route`

## T5 — feat(workflows): client hook + ChannelIcon

- [ ] New file: `plugins/workflows/hooks/use-notification-channels.ts` with module-level promise cache + in-flight coalescing
- [ ] Exports: `useNotificationChannels`, `getChannelLabel`, `getChannelInitials`, `__resetNotificationChannelsCache` (test-only, NODE_ENV-guarded)
- [ ] New file: `plugins/workflows/hooks/channel-icon.tsx` — explicit lucide-name-to-component map (MessageSquare/Mail/Instagram/Twitter/Youtube/Music2/HelpCircle fallback)
- [ ] New test: `tests/plugins/workflows/use-notification-channels.test.tsx` — mocks fetch, verifies single-flight coalescing
- [ ] Checkpoint: `pnpm vitest run` clean
- [ ] Commit: `feat(workflows): client hook + ChannelIcon for notification channels`

## T6 — refactor(workflows): widen NotifyChannel.channel to string

- [ ] `plugins/workflows/types.ts:25` — `channel: 'discord' | 'slack'` → `channel: string`
- [ ] `plugins/workflows/lib/node-type-registry.ts:145-148` — `channel: z.enum(['discord', 'slack'])` → `z.string().min(1)`
- [ ] "Look first": grep for any test that asserts enum rejection of non-builtin channels; update if found
- [ ] Checkpoint: `pnpm tsc --noEmit` + full `pnpm vitest run` clean
- [ ] Commit: `refactor(workflows): widen NotifyChannel.channel to string`

## T7 — refactor(messaging): migrate channel consumers

- [ ] `item-detail-drawer.tsx` — replace `CHANNEL_LABELS[ch]` / `CHANNEL_INITIALS[ch]` reads at :295-313 and :532-534
- [ ] `content-calendar.tsx` — delete `CHANNEL_ICONS` map at :84-91; replace `CHANNEL_OPTIONS` with in-component derivation
- [ ] `plugins/messaging/constants.ts` — delete `CHANNEL_LABELS` (lines 26-34) and `CHANNEL_INITIALS` (lines 35-44); keep `STATUS_BADGE`, `TONE_LABELS`
- [ ] Update affected messaging test mocks to stub `@bakin/workflows/hooks/use-notification-channels`
- [ ] Grep verification: `CHANNEL_LABELS|CHANNEL_INITIALS|CHANNEL_ICONS` under `plugins/messaging/` → zero hits
- [ ] Manual smoke: drawer chips + calendar channel icons render correctly
- [ ] Checkpoint: `pnpm tsc --noEmit` + full `pnpm vitest run` clean
- [ ] Commit: `refactor(messaging): resolve notification channels via workflows registry`

## T8 — test: regression guards

- [ ] New/extended test: messaging drawer renders channel chips with a mocked `useNotificationChannels` returning 3 channels
- [ ] Orphan-channel test: item with `channel: 'mastodon'` (not in registry) renders raw id without crashing
- [ ] Checkpoint: full `pnpm vitest run` + `pnpm tsc --noEmit` clean
- [ ] Commit: `test(channels): regression guards for registry consumers`

## T9 — Ship

- [ ] Manual smoke: drawer chips + calendar icons + workflow YAML with `notify: { channel: email, ... }`
- [ ] `git push -u origin issue-125-notification-channels-registry`
- [ ] Open PR against `main`, reference #125, link spec + plugin-system one-pager
- [ ] Merge when green
- [ ] Close #125 with before/after summary
- [ ] Archive `tasks/plan.md` + `tasks/todo.md` → `.claude/tasks/issue-125-{plan,todo}.md`
