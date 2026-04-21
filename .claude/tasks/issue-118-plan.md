# Plan — Issue #118: Messaging plugin refactor

**Spec:** `.claude/specs/messaging-refactor.md`
**Issue:** https://github.com/markhayden/bakin/issues/118
**Branch:** `issue-118-messaging-refactor`
**Broader context:** `docs/ideas/plugin-system.md`

## Goal

Strip hardcoded agent/channel/content-type string-literal unions from the messaging plugin so it's a neutral core plugin, unblocking the plugin-system spec. Reuse existing `team.*` hooks + `useAgentStore` for agents. Make content types user-configurable via a new `list` field type in `PluginSettingsRenderer`. Leave channels mostly alone (type drops to `string`; hardcoded maps stay until the future channel registry lands).

## Dependency graph

```
T0 (branch + scaffold commit) — done, only archival commit to write
  │
  ▼
T1 (renderer `list` field — core primitive)     [standalone, reusable]
  │
  ▼
T2 (MessagingSettings.contentTypes + seed on activate)
  │
  ▼
T3 (runtime content-type label lookup + UI swap)
  │
  │     T4 (prompt-builder → team.getAgent) ────┐     [independent; can parallelize with T3]
  │                                              │
  ▼                                              ▼
  └────────────►  T5 (8 client components → useAgentStore) ◄─ requires T4 merged
                                              │
                                              ▼
                                  T6 (strip unions, AGENT_INFO, dead constants)
                                              │
                                              ▼
                                  T7 (regression guard tests)
                                              │
                                              ▼
                                  T8 (ship: push, PR, merge, close, archive)
```

Solo sequential is expected; parallelization note is for information only. Each task = one commit.

## Task detail

### T0 — chore(issue-118): spec + plan scaffold

**Already done:** branch created, spec written at `.claude/specs/messaging-refactor.md`, plugin-system one-pager at `docs/ideas/plugin-system.md`, this plan + todo being written, issue-115 tasks archived.

**Commit:** bundle all scaffolding into one chore commit.

**Verification:** `git status` clean after commit; spec/plan/todo files tracked in the new branch.

---

### T1 — feat(core): list field type in PluginSettingsRenderer

**What:** Add a `list` variant to `SettingsField` for list-of-rows editing. Reusable by any future plugin with a taxonomy setting.

**Files:**
- `packages/core/src/plugin-types.ts` — extend `SettingsField` union (turn into a discriminated union: scalar variants + new `list` variant with `itemShape: Record<string, SettingsField>`)
- `src/components/plugin-settings-renderer.tsx` — add `list` rendering branch
- `tests/components/plugin-settings-renderer.test.tsx` (new) — unit tests

**Shape:**

```ts
type SettingsField =
  | { type: 'string' | 'number';    key: string; label: string; description?: string; default?: unknown }
  | { type: 'boolean';              key: string; label: string; description?: string; default?: boolean }
  | { type: 'select';               key: string; label: string; description?: string; default?: string;
      options: { value: string; label: string }[] }
  | { type: 'list';                 key: string; label: string; description?: string; default?: unknown[];
      itemShape: Record<string, SettingsField>; addLabel?: string;
      minItems?: number; maxItems?: number }
```

Renderer behavior for `list`:
- Read value as `unknown[]`; default to `[]`
- Render one row per item; each row renders nested fields using the `itemShape`
- "Add" button appends a blank row (fields initialized to empty strings / false / field.default)
- Per-row delete (confirm not needed for v1 — click-through is cheap)
- Validation: required fields non-empty, `minItems` / `maxItems` respected, `id`-keyed fields enforce uniqueness within the list (when `key: 'id'` is in the shape)
- No reordering in v1

**Acceptance criteria:**
- [ ] `SettingsField` is a discriminated union; TS compiles
- [ ] All existing plugins' settings schemas still validate (type-check clean after the union change)
- [ ] Renderer renders add/edit/delete for a list field; validation blocks save when rules fail
- [ ] Unit tests cover: add row, edit row, delete row, `required` validation, unique-id validation, `maxItems`
- [ ] `pnpm tsc --noEmit` clean; full test suite runs green

**Commit:** `feat(core): support list-of-rows field in PluginSettingsRenderer`

---

### T2 — feat(messaging): add contentTypes setting + seed defaults on activate

**What:** Add `MessagingSettings.contentTypes`, register the `settingsSchema` using T1's new `list` field, and seed generic defaults on first activate.

**Files:**
- `plugins/messaging/types.ts` — add `MessagingSettings` interface (or extend existing one)
- `plugins/messaging/index.ts` — register `settingsSchema`; seed `DEFAULT_CONTENT_TYPES` in `activate()` if missing
- `tests/plugins/messaging/activate.test.ts` (new or extended) — seed behavior

**Defaults:**

```ts
const DEFAULT_CONTENT_TYPES = [
  { id: 'post',         label: 'Post' },
  { id: 'article',      label: 'Article' },
  { id: 'video',        label: 'Video' },
  { id: 'image',        label: 'Image' },
  { id: 'announcement', label: 'Announcement' },
]
```

**Acceptance criteria:**
- [ ] `MessagingSettings` typed with `contentTypes: Array<{ id: string; label: string }>`
- [ ] `settingsSchema` uses the new `list` field with `itemShape: { id, label }`, both `required: true`
- [ ] Fresh activate with no persisted settings → defaults seeded and persisted
- [ ] Re-activate with settings already present → idempotent no-op
- [ ] Unit test covers both paths; uses `activatePlugin` helper from `tests/plugins/test-helpers.ts`
- [ ] Settings page at `/settings` renders the content-types editor correctly (manual check)

**Commit:** `feat(messaging): user-configurable content types with generic defaults`

---

### T3 — feat(messaging): runtime content-type lookup

**What:** Replace compile-time `CONTENT_TYPE_LABELS` lookups with a runtime function reading from settings.

**Discovery step (do first):** grep for the existing pattern by which messaging's client components read plugin settings. Two likely paths:
1. A hook exists (e.g., `usePluginSettings('messaging')`) — use it
2. No hook exists — add a small fetch-on-mount at the top-level layout (`plugins/messaging/components/planning-layout.tsx` or similar) and pass `contentTypes` down via props or Zustand store

Document which path in the commit message.

**Files:**
- `plugins/messaging/lib/content-types.ts` (new) — `getContentTypeLabel(id, contentTypes)` + `listContentTypes(contentTypes)` helpers
- `plugins/messaging/components/item-detail-drawer.tsx` — 3 call sites (line 229 select-value, line 232 iteration, line 488 label read)
- `plugins/messaging/components/content-calendar.tsx` — `TYPE_OPTIONS` derivation at line 88 becomes runtime
- `plugins/messaging/constants.ts` — keep `CONTENT_TYPE_LABELS` ONLY as a fallback-empty placeholder during transition, remove in T6
- Any settings-fetch wiring identified in discovery

**Fallback behavior:** `getContentTypeLabel(id, contentTypes)` returns the match's label, or the raw `id` (title-cased) if no match. Orphaned references render the id; no crash.

**Acceptance criteria:**
- [ ] All `CONTENT_TYPE_LABELS[x]` reads replaced with `getContentTypeLabel(x, contentTypes)` or the runtime iteration equivalent
- [ ] Typing compiles: `ContentType` widened to `string` in any local annotations that blocked the swap (types.ts stays untouched until T6)
- [ ] Manual smoke: open a calendar item, change its content type, save; verify selector shows current list from settings; add/remove a type in settings and see it reflected after refresh
- [ ] No new tests strictly required; helper unit test nice-to-have

**Commit:** `refactor(messaging): runtime content-type lookup from settings`

---

### T4 — refactor(messaging): server agent resolution via team.getAgent

**What:** Replace `AGENT_INFO[agentId]` in the server-side prompt-builder with a hook call to team.

**Files:**
- `plugins/messaging/lib/prompt-builder.ts:64` — swap lookup; need to check whether `ctx`/hooks are available at the call site
- Caller updates if prompt-builder doesn't have hook access — lift the lookup one level up and pass `AgentMeta` in
- `tests/plugins/messaging/prompt-builder.test.ts` (new or extended) — mock `team.getAgent` hook

**Acceptance criteria:**
- [ ] `prompt-builder.ts` no longer imports `AGENT_INFO`
- [ ] Agent resolution goes through `ctx.hooks.invoke<AgentMeta>('team.getAgent', { agentId })` (or an `AgentMeta` param passed in from caller)
- [ ] Test covers: hook returns agent → prompt includes name/emoji; hook returns null → prompt degrades cleanly to id-only
- [ ] Tests mock `openclaw-client`, `content-dir`, `logger`, `watcher` per CLAUDE.md

**Commit:** `refactor(messaging): resolve agents via team.getAgent hook`

---

### T5 — refactor(messaging): client agent resolution via useAgentStore

**What:** Swap all client-side `AGENT_INFO[id]` and `CONTENT_AGENTS` usages to use the team plugin's `useAgentStore`.

**Files (8 components):**
- `plugins/messaging/components/item-detail-drawer.tsx` — AGENT_INFO at `:367`; CONTENT_AGENTS at `:220`
- `plugins/messaging/components/planning-layout.tsx` — AGENT_INFO at `:164`
- `plugins/messaging/components/session-chat.tsx` — AGENT_INFO at `:85`
- `plugins/messaging/components/brainstorm-panel.tsx` — AGENT_INFO at `:143`, `:162`; CONTENT_AGENTS at `:151`
- `plugins/messaging/components/new-session-dialog.tsx` — AGENT_INFO at `:25`
- `plugins/messaging/components/content-calendar.tsx` — AGENT_INFO at `:41`; CONTENT_AGENTS at `:546`
- `plugins/messaging/components/brainstorm-view.tsx` — AGENT_INFO at `:115`; CONTENT_AGENTS at `:114`, `:134`
- `plugins/messaging/components/session-list.tsx` — AGENT_INFO at `:182`; CONTENT_AGENTS at `:181`

**Swap pattern:**

```tsx
// BEFORE
import { AGENT_INFO } from '../types'
import { CONTENT_AGENTS } from '../constants'
const info = AGENT_INFO[id]
CONTENT_AGENTS.map(id => ...)

// AFTER
import { useAgentStore, getAgentColor } from '@bakin/team/hooks/use-agent-store'
const agent = useAgentStore(s => s.getAgent(id))
const color = useAgentStore(s => getAgentColor(s, id))
const agentIds = useAgentStore(s => s.agents.map(a => a.id))
// handle agent?? with sensible fallback (show id, neutral styling)
```

**Acceptance criteria:**
- [ ] `grep -n AGENT_INFO plugins/messaging/components/` → zero hits
- [ ] `grep -n CONTENT_AGENTS plugins/messaging/components/` → zero hits
- [ ] Every component handles `agent === null` (orphaned id) without crashing: renders id, no emoji/color
- [ ] Manual smoke: calendar loads, opens item drawer, switches agent, runs brainstorm session end-to-end; no console errors
- [ ] Manual degraded-display check: stage one calendar item with a fake agent id in frontmatter → drawer opens, id shown, no crash
- [ ] `pnpm tsc --noEmit` clean

**Commit:** `refactor(messaging): client agent resolution via useAgentStore`

---

### T6 — refactor(messaging): strip unions, AGENT_INFO, dead constants

**What:** Final cleanup — remove the now-unreferenced hardcoded unions and constants.

**Files:**
- `plugins/messaging/types.ts` — remove `ContentAgent | ContentChannel | ContentType` unions, replace with `type ContentAgent = string` / `type ContentChannel = string` / `type ContentType = string` aliases (kept for documentation of intent). Remove `AGENT_INFO`.
- `plugins/messaging/constants.ts` — remove `CONTENT_AGENTS` (line 4) and `CONTENT_TYPE_LABELS` (lines 16-24). Keep `STATUS_BADGE`, `TONE_LABELS`, `CHANNEL_LABELS`, `CHANNEL_INITIALS`.

**Verifications (run all):**
- `grep -r AGENT_INFO plugins/messaging/` → zero hits
- `grep -rn "CONTENT_AGENTS\|CONTENT_TYPE_LABELS" plugins/messaging/` → zero hits
- `grep -rE "'chef'|'explorer'|'trainer'|'coach'" plugins/messaging/` → zero hits
- `grep -rE "'recipe'|'tip'|'motivation'|'workout'|'outdoor'|'image-post'" plugins/messaging/` → zero hits (confirm `DEFAULT_CONTENT_TYPES` didn't accidentally adopt any brand values)
- `pnpm tsc --noEmit` clean
- `pnpm vitest run` clean

**Acceptance criteria:**
- [ ] All grep checks return zero hits
- [ ] Full test suite passes
- [ ] tsc clean

**Commit:** `refactor(messaging): strip hardcoded unions and AGENT_INFO`

---

### T7 — test: regression guards for orphaned refs

**What:** Add fixture-based tests that prove the "graceful degradation" promise.

**Files:**
- `tests/plugins/messaging/orphan-refs.test.tsx` (new) — renders components with fixture data containing unknown agent id and unknown content-type id; asserts no crash, raw id rendered

**Acceptance criteria:**
- [ ] Test for orphaned agent id in a calendar item
- [ ] Test for orphaned content-type id in a calendar item
- [ ] Tests mock all required surfaces per CLAUDE.md (content-dir, logger, watcher, openclaw-client, team.getAgent hook)
- [ ] Tests pass

**Commit:** `test(messaging): regression guards for orphaned agent/content-type refs`

---

### T8 — Ship

- [ ] `pnpm vitest run` full pass + `pnpm tsc --noEmit` clean
- [ ] Manual smoke: wipe local `~/.bakin/messaging/` → start server → content calendar renders empty → create a new item with one of the default content types → works end-to-end
- [ ] `git push -u origin issue-118-messaging-refactor`
- [ ] Open PR against `main`, reference #118, link one-pager (`docs/ideas/plugin-system.md`)
- [ ] Merge when green
- [ ] Close #118 with before/after summary
- [ ] Archive `tasks/plan.md` + `tasks/todo.md` to `.claude/tasks/issue-118-{plan,todo}.md`

## Commit strategy

One PR, 7 commits (T0 scaffold + T1 through T6 + T7 regression tests). Commit boundaries match task boundaries. Each commit should be self-contained: passes tests, passes tsc, doesn't break runtime (T3 in particular: UI keeps rendering using the fallback path even before T6 removes the old constants).

## Risks / call-outs

- **Renderer discriminated-union change (T1)** — turning `SettingsField` into a discriminated union could require touching every plugin's `settingsSchema` if any of them rely on the loose shape. Mitigation: after the type change, run `tsc --noEmit` across the whole repo before proceeding; fix any per-plugin schema sites in the same T1 commit.
- **Client settings read pattern (T3)** — if no existing hook exists, the minimal fetch-and-pass-through approach is acceptable but introduces a small wiring footprint that will be superseded when the plugin-system spec formalizes settings-read. Fine for now; don't over-engineer.
- **useAgentStore SSR-safety (T5)** — client components are `'use client'`, so hook usage is fine. Just confirm no message plugin component has accidentally become server-rendered.
- **DEFAULT_CONTENT_TYPES creep** — watch that no brand-specific values slip into the defaults during T2. Grep in T6 is the backstop.
