# TODO: Issue #118 — Messaging plugin refactor

**Spec:** `.claude/specs/messaging-refactor.md`
**Plan:** `tasks/plan.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/118
**Branch:** `issue-118-messaging-refactor`

## T0 — Branch + scaffold commit

- [x] `git checkout -b issue-118-messaging-refactor`
- [x] Archive issue-115 tasks → `.claude/tasks/issue-115-{plan,todo}.md`
- [x] Commit `4a6fa3e`: `chore(issue-118): spec + plan scaffold`

## T1 — feat(core): list field type in PluginSettingsRenderer

- [x] Turn `SettingsField` into a discriminated union in `packages/core/src/plugin-types.ts`; add `list` variant with `itemShape`
- [x] `pnpm tsc --noEmit` across repo — all existing plugin schemas still compile
- [x] Add `list` rendering branch in `src/components/plugin-settings-renderer.tsx` (add / delete / edit)
- [x] Validation: `required` per sub-field, `minItems` / `maxItems`
- [x] Uniqueness guard cut from v1 (noted in the `Not Doing` list in spec)
- [x] New test file: `tests/components/plugin-settings-renderer.test.tsx` — 8 cases, all green
- [x] Checkpoint: `tsc --noEmit` + full `vitest run` clean
- [x] Commit `30dbf02`: `feat(core): support list-of-rows field in PluginSettingsRenderer`

## T2 — feat(messaging): contentTypes setting + seed on activate

- [x] Add `MessagingSettings.contentTypes` interface in `plugins/messaging/types.ts`
- [x] `DEFAULT_CONTENT_TYPES` (Post / Article / Video / Image / Announcement)
- [x] Register `settingsSchema` in `plugins/messaging/index.ts` using the new `list` field
- [x] Seed defaults in `activate()` when `contentTypes` absent or empty; idempotent on re-activate
- [x] Test file `tests/plugins/messaging/activate.test.ts` — 3 cases, all green
- [x] Checkpoint: tests pass
- [x] Commit `c376534`: `feat(messaging): user-configurable content types with generic defaults`

## T3 — refactor(messaging): runtime content-type lookup

- [x] Discovery: no existing client-side plugin-settings hook; introduced `useContentTypes()` (module-level cached fetch) at `plugins/messaging/hooks/use-content-types.ts`
- [x] `getContentTypeLabel(id, contentTypes)` helper with id-fallback
- [x] Replaced all `CONTENT_TYPE_LABELS[x]` reads in `item-detail-drawer.tsx` and `content-calendar.tsx`
- [x] Widened `ContentType`-typed local variables to `string` where needed
- [x] Checkpoint: `tsc --noEmit` clean
- [x] Commit `b78ae14`: `refactor(messaging): runtime content-type lookup from settings`

## T4 — refactor(messaging): server agent resolution via team.getAgent

- [x] Refactored `prompt-builder.ts` to take `PromptBuilderOptions { agentName?, contentTypes, contentDir? }`; fell back to agentId when agentName missing
- [x] Removed `AGENT_INFO` import + dead `agentInfo` assignment + hardcoded `AGENT_NAMES` map + "BetterFit content creator" identity + hardcoded `recipe|tip|motivation|...` contentType enumeration
- [x] Two callers in `index.ts` now resolve via shared `resolvePromptOptions(ctx, agentId)` → `team.getAgent` hook + `ctx.getSettings<MessagingSettings>()`
- [x] Updated `prompt-builder.test.ts` with the new signature + new cases (orphan fallback, empty contentTypes, brand-neutral identity)
- [x] Checkpoint: tests pass
- [x] Commit `abefea8`: `refactor(messaging): resolve agents via team.getAgent hook`

## T5 — refactor(messaging): client agents via useAgentStore

- [x] `item-detail-drawer.tsx` — `useAgent`, `useAgentIds`; removed `ContentAgent` default, widened state to string
- [x] `planning-layout.tsx` — `useAgent(session?.agentId ?? '')` at top-level (hook rules)
- [x] `session-chat.tsx` — `useAgent` + `useAgentColor`; border color moved from tailwind class map to inline style
- [x] `brainstorm-panel.tsx` — `useAgentList` drives the agent pill bar; default agent = `agentIds[0]`
- [x] `new-session-dialog.tsx` — `useAgent(agentId ?? '')` with name fallback
- [x] `content-calendar.tsx` — `useAgentIds` for filter; `AGENT_INFO` import removed (was unused)
- [x] `brainstorm-view.tsx` — `useAgentList` for "New Session" dropdown
- [x] `session-list.tsx` — `useAgentList` for empty-state agent cards
- [x] Grep verification: `AGENT_INFO` / `CONTENT_AGENTS` → 0 hits under `plugins/messaging/components/`
- [x] Test mocks added in `session-chat.test.tsx` + `session-list.test.tsx` for `@bakin/team/hooks/use-agent-store`
- [x] `contract.test.ts` gains `list` as a valid settings field type + shape check
- [x] Checkpoint: `tsc --noEmit` clean; full `vitest run` green
- [x] Commit `1f1ce02`: `refactor(messaging): client agent resolution via useAgentStore`

## T6 — refactor(messaging): strip unions, AGENT_INFO, dead constants

- [x] `ContentAgent | ContentChannel | ContentType` widened to `type X = string` aliases in `types.ts` (kept as documented aliases)
- [x] Removed `AGENT_INFO` from `types.ts`
- [x] Removed `CONTENT_AGENTS` + `CONTENT_TYPE_LABELS` from `constants.ts`
- [x] Kept `STATUS_BADGE`, `TONE_LABELS`, `CHANNEL_LABELS`, `CHANNEL_INITIALS` per spec
- [x] Swept three remaining brand refs (legacy `/brainstorm` route's agent-name map + BetterFit identity + hardcoded contentType enum; default `'tip'` fallback in two create paths → `'post'`)
- [x] TYPE_ICONS in `content-calendar.tsx` updated to keys matching `DEFAULT_CONTENT_TYPES` (post / article / video / image / announcement)
- [x] Grep verifications — all zero:
  - [x] `AGENT_INFO` / `CONTENT_AGENTS` / `CONTENT_TYPE_LABELS`
  - [x] `'basil'|'scout'|'nemo'|'zen'`
  - [x] `'recipe'|'tip'|'motivation'|'workout'|'outdoor'|'image-post'` (only hit is an explanatory comment in `types.ts`)
- [x] Checkpoint: `tsc --noEmit` + full `vitest run` clean
- [x] Commit `d4bcc50`: `refactor(messaging): strip hardcoded unions and AGENT_INFO`

## T7 — test: regression guards

- [x] New test file: `tests/plugins/messaging/orphan-refs.test.tsx`
- [x] Case: orphaned content-type id → raw id rendered (`getContentTypeLabel` fallback)
- [x] Case: empty content-type taxonomy → handles cleanly
- [x] Case: prompt-builder with missing agentName → falls back to agentId, no `undefined` leaks
- [x] Case: prompt-builder with empty contentTypes → neutral placeholder in instruction
- [x] Mocks: content-dir, logger, watcher, openclaw-client, team store
- [x] Checkpoint: tests pass
- [x] Commit `61d9342`: `test(messaging): regression guards for orphaned agent/content-type refs`

## T8 — Ship

- [x] Full `pnpm vitest run` (2853 passed | 1 skipped) + `pnpm tsc --noEmit` clean
- [ ] Manual end-to-end smoke with `~/.bakin/messaging/` wiped (user task)
- [ ] `git push -u origin issue-118-messaging-refactor`
- [ ] Open PR against `main`, reference #118, link `docs/ideas/plugin-system.md`
- [ ] Merge when green
- [ ] Close #118 with before/after summary
- [ ] Archive `tasks/plan.md` + `tasks/todo.md` → `.claude/tasks/issue-118-{plan,todo}.md`
