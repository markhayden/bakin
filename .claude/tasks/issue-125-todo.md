# TODO: Issue #125 — Notification channels registry

**Spec:** `.claude/specs/issue-125-notification-channels-registry.md`
**Plan:** `tasks/plan.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/125
**Branch:** `issue-125-notification-channels-registry`

## T0 — Branch + scaffold commit

- [x] `git checkout -b issue-125-notification-channels-registry`
- [x] Archive issue-118 tasks → `.claude/tasks/issue-118-{plan,todo}.md`
- [x] Commit `39e30fa`: `chore(issue-125): spec + plan scaffold`

## T1 — feat(core): notification-channel types on PluginContext

- [x] `PluginNotificationChannelInput` + `NotificationChannelDef` in `packages/core/src/plugin-types.ts`
- [x] `registerNotificationChannel(def): string` on `PluginContext`
- [x] Re-exported from `src/lib/plugin-types.ts`
- [x] Interim stubs added at all 8 PluginContext-literal sites
- [x] Commit `a378ccb`: `feat(core): notification-channel types on PluginContext`

## T2 — feat(workflows): registry store with lazy builtin seeding

- [x] `plugins/workflows/lib/notification-channel-registry.ts` — Map store, register/get/list/unregister helpers
- [x] `registerPluginNotificationChannel` namespaces ids as `{pluginId}.{id}`
- [x] 7 builtins self-register at module load (discord/slack/email/instagram/twitter/youtube/tiktok)
- [x] `tests/plugins/workflows/notification-channel-registry.test.ts` — 9 tests pass
- [x] Commit `3492331`: `feat(workflows): notification-channel registry with builtin seeding`

## T3 — feat(core): wire registerNotificationChannel through plugin-registry

- [x] Imported helpers in `src/lib/plugin-registry.ts`
- [x] `channelIds: string[]` added to `PluginState`
- [x] Real `ctx.registerNotificationChannel` replaces the T1 stub
- [x] `unregisterPluginNotificationChannels(pluginId)` mirrors the node-type teardown at the user-plugin-override path
- [x] Commit `4d73a8d`: `feat(core): wire registerNotificationChannel through plugin-registry`

## T4 — feat(workflows): hooks + REST route

- [x] `workflows.listNotificationChannels` + `workflows.getNotificationChannel` hooks
- [x] `GET /notification-channels` route
- [x] `tests/plugins/workflows/notification-channels-route.test.ts` — 3 tests pass
- [x] Commit `79c4aa8`: `feat(workflows): expose notification channels via hooks + REST route`

## T5 — feat(workflows): client hook + ChannelIcon

- [x] `plugins/workflows/hooks/use-notification-channels.ts` with module cache + single-flight
- [x] `getChannelLabel`, `getChannelInitials`, `__resetNotificationChannelsCache` (test-only, NODE_ENV-guarded)
- [x] `plugins/workflows/hooks/channel-icon.tsx` — explicit lucide map (7 icons + HelpCircle fallback)
- [x] `tests/plugins/workflows/use-notification-channels.test.tsx` — 7 tests pass
- [x] Commit `71a3e76`: `feat(workflows): client hook + ChannelIcon for notification channels`
- [x] Commit `65d6d7e`: `fix(workflows): narrow ChannelIcon's LucideIcon type properly` (follow-up tsc fix)

## T6 — refactor(workflows): widen NotifyChannel.channel to string

- [x] `plugins/workflows/types.ts` — `'discord' | 'slack'` → `string`
- [x] `node-type-registry.ts` — `z.enum(['discord', 'slack'])` → `z.string().min(1)`
- [x] Confirmed no test asserted enum rejection of non-builtin channels
- [x] Commit `3aada18`: `refactor(workflows): widen NotifyChannel.channel to string`

## T7 — refactor(messaging): migrate channel consumers

- [x] `item-detail-drawer.tsx` — `CHANNEL_LABELS` / `CHANNEL_INITIALS` reads → registry helpers (both edit form + detail view)
- [x] `content-calendar.tsx` — deleted `CHANNEL_ICONS` map + module-level `CHANNEL_OPTIONS`; in-component derivation via `useNotificationChannels()` + `<ChannelIcon>`
- [x] Trimmed unused lucide imports (Instagram, Mail, Twitter, Youtube, Music2)
- [x] `plugins/messaging/constants.ts` — deleted `CHANNEL_LABELS`, `CHANNEL_INITIALS`
- [x] `calendar-local-filter.test.tsx` lucide mock extended with `HelpCircle`
- [x] Grep verification: zero hits for `CHANNEL_LABELS|CHANNEL_INITIALS|CHANNEL_ICONS|CHANNEL_OPTIONS` under `plugins/messaging/`
- [x] Commit `64d2003`: `refactor(messaging): resolve notification channels via workflows registry`

## T8 — test: regression guards

- [x] `tests/plugins/messaging/channel-rendering.test.tsx` — both scenarios (registered channel labels + orphan fallback) pass
- [x] Full `pnpm vitest run` — 2913 passed, 1 skipped (2 pre-existing dagre failures unrelated)
- [x] `pnpm tsc --noEmit` clean
- [x] Commit `356a891`: `test(channels): regression guards for registry consumers`

## T9 — Ship

- [ ] Manual smoke: messaging drawer chips + calendar filter + workflow YAML with `notify: { channel: email, ... }`
- [ ] `git push -u origin issue-125-notification-channels-registry`
- [ ] Open PR against `main`, reference #125, link spec + plugin-system one-pager
- [ ] Merge when green
- [ ] Close #125 with before/after summary
- [ ] Archive `tasks/plan.md` + `tasks/todo.md` → `.claude/tasks/issue-125-{plan,todo}.md`
