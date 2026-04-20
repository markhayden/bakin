# TODO: Issue #118 — Messaging plugin refactor

**Spec:** `.claude/specs/messaging-refactor.md`
**Plan:** `tasks/plan.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/118
**Branch:** `issue-118-messaging-refactor`

## T0 — Branch + scaffold commit

- [x] `git checkout -b issue-118-messaging-refactor`
- [x] Archive issue-115 tasks → `.claude/tasks/issue-115-{plan,todo}.md`
- [ ] Commit: `chore(issue-118): spec + plan scaffold`

## T1 — feat(core): list field type in PluginSettingsRenderer

- [ ] Turn `SettingsField` into a discriminated union in `packages/core/src/plugin-types.ts`; add `list` variant with `itemShape`
- [ ] Run `pnpm tsc --noEmit` across repo; fix any per-plugin schema breakage in the same change
- [ ] Add `list` rendering branch in `src/components/plugin-settings-renderer.tsx` (add-row, per-row delete, per-field edit)
- [ ] Validation: required fields, `minItems` / `maxItems`, unique `id` within list
- [ ] New test file: `tests/components/plugin-settings-renderer.test.tsx` covering add / edit / delete / validation
- [ ] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [ ] Commit: `feat(core): support list-of-rows field in PluginSettingsRenderer`

## T2 — feat(messaging): contentTypes setting + seed on activate

- [ ] Add `MessagingSettings.contentTypes` interface in `plugins/messaging/types.ts`
- [ ] Define `DEFAULT_CONTENT_TYPES` (Post/Article/Video/Image/Announcement)
- [ ] Register `settingsSchema` in `plugins/messaging/index.ts` using the new `list` field
- [ ] Seed defaults in `activate()` when `contentTypes` absent; idempotent on re-activate
- [ ] Test: both paths (fresh → seeded, re-activate → no-op) using `activatePlugin` helper
- [ ] Manual check: `/settings` page renders content-types editor
- [ ] Checkpoint: tests pass
- [ ] Commit: `feat(messaging): user-configurable content types with generic defaults`

## T3 — refactor(messaging): runtime content-type lookup

- [ ] Discovery: find or add the client-side pattern for reading plugin settings (hook vs fetch-and-pass)
- [ ] New helper: `plugins/messaging/lib/content-types.ts` — `getContentTypeLabel(id, contentTypes)` with id-fallback
- [ ] Replace `CONTENT_TYPE_LABELS[x]` reads in `item-detail-drawer.tsx` (3 sites) and `content-calendar.tsx` (option derivation)
- [ ] Widen any `ContentType`-typed local variables to `string` where needed
- [ ] Manual smoke: add/remove content type in settings → reflected in calendar item drawer after refresh
- [ ] Checkpoint: `pnpm tsc --noEmit` clean
- [ ] Commit: `refactor(messaging): runtime content-type lookup from settings`

## T4 — refactor(messaging): server agent resolution via team.getAgent

- [ ] Verify `ctx`/hooks access at `plugins/messaging/lib/prompt-builder.ts:64`; lift lookup to caller if needed
- [ ] Swap `AGENT_INFO[agentId]` → `ctx.hooks.invoke<AgentMeta>('team.getAgent', { agentId })` (or caller-passed `AgentMeta`)
- [ ] Test with mocked `team.getAgent` hook — agent returned path + null path
- [ ] Checkpoint: tests pass
- [ ] Commit: `refactor(messaging): resolve agents via team.getAgent hook`

## T5 — refactor(messaging): client agents via useAgentStore

- [ ] `item-detail-drawer.tsx` — swap `AGENT_INFO[id]` at `:367`, `CONTENT_AGENTS` at `:220`
- [ ] `planning-layout.tsx` — swap `AGENT_INFO[id]` at `:164`
- [ ] `session-chat.tsx` — swap at `:85`
- [ ] `brainstorm-panel.tsx` — swap at `:143`, `:162`, `:151` (CONTENT_AGENTS)
- [ ] `new-session-dialog.tsx` — swap at `:25`
- [ ] `content-calendar.tsx` — swap at `:41`, `:546` (CONTENT_AGENTS)
- [ ] `brainstorm-view.tsx` — swap at `:114`, `:115`, `:134`
- [ ] `session-list.tsx` — swap at `:181`, `:182`
- [ ] Handle `agent === null` in each — degraded display (raw id, neutral styling)
- [ ] Verify: `grep -n AGENT_INFO plugins/messaging/components/` → zero; same for `CONTENT_AGENTS`
- [ ] Manual smoke: calendar → drawer → brainstorm end-to-end; no console errors
- [ ] Manual degraded-display check: stage an item with a bogus agent id in frontmatter → drawer renders cleanly
- [ ] Checkpoint: `pnpm tsc --noEmit` clean
- [ ] Commit: `refactor(messaging): client agent resolution via useAgentStore`

## T6 — refactor(messaging): strip unions, AGENT_INFO, dead constants

- [ ] Remove `ContentAgent | ContentChannel | ContentType` unions in `types.ts`; replace with `type X = string` aliases
- [ ] Remove `AGENT_INFO` from `types.ts`
- [ ] Remove `CONTENT_AGENTS` and `CONTENT_TYPE_LABELS` from `constants.ts`
- [ ] Keep `STATUS_BADGE`, `TONE_LABELS`, `CHANNEL_LABELS`, `CHANNEL_INITIALS`
- [ ] Verify grep checks:
  - [ ] `grep -r AGENT_INFO plugins/messaging/` → zero hits
  - [ ] `grep -rn "CONTENT_AGENTS\|CONTENT_TYPE_LABELS" plugins/messaging/` → zero hits
  - [ ] `grep -rE "'basil'|'scout'|'nemo'|'zen'" plugins/messaging/` → zero hits
  - [ ] `grep -rE "'recipe'|'tip'|'motivation'|'workout'|'outdoor'|'image-post'" plugins/messaging/` → zero hits
- [ ] Checkpoint: `pnpm tsc --noEmit` + full `pnpm vitest run` clean
- [ ] Commit: `refactor(messaging): strip hardcoded unions and AGENT_INFO`

## T7 — test: regression guards

- [ ] New test file: `tests/plugins/messaging/orphan-refs.test.tsx`
- [ ] Case: orphaned agent id → no crash, raw id rendered
- [ ] Case: orphaned content-type id → no crash, raw id rendered
- [ ] Mocks: content-dir, logger, watcher, openclaw-client, team.getAgent
- [ ] Checkpoint: tests pass
- [ ] Commit: `test(messaging): regression guards for orphaned agent/content-type refs`

## T8 — Ship

- [ ] Full `pnpm vitest run` + `pnpm tsc --noEmit`
- [ ] Manual end-to-end smoke with `~/.bakin/messaging/` wiped
- [ ] `git push -u origin issue-118-messaging-refactor`
- [ ] Open PR against `main`, reference #118, link `docs/ideas/plugin-system.md`
- [ ] Merge when green
- [ ] Close #118 with before/after summary
- [ ] Archive `tasks/plan.md` + `tasks/todo.md` → `.claude/tasks/issue-118-{plan,todo}.md`
