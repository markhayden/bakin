# PLAN — Team plugin URL state (Phase 2, PR 1 of `.claude/specs/settings-url-state.md`)

Companion to the spec's Phase 2 rules. Branch `feat/team-url-state` from `main` (post-#829). Same shape as
`tasks/settings-url-state/plan.md`: vertical slices, one commit each, commit boundaries are the rollback points.

## Overview

Three team surfaces hold bookmark-worthy selection in local state. Move each into the URL under the Phase 2 rules
(in-page master-detail → noun param, replace; edit-vs-preview → `mode`; windows → `<area>_window`), pin each with a
URL-seeded RTL test through the router shim, and sweep docs. No producers exist for the new params yet (nothing
links to a specific skill or memory file) — the URL becomes linkable; wiring producers is not in scope.

| # | Surface | Today | URL |
|---|---------|-------|-----|
| 1 | Agent detail → Skills tab: selected skill (`NavList`) | `useState`, auto-selects first | `/team/$id?tab=skills&skill=<skillId>` |
| 2 | Agent detail → Memory tab: selected daily file (`NavList`) | `useState`, auto-selects first | `/team/$id?tab=memory&file=<name.md>` |
| 3 | Agent detail → Diagnostics → Activity timeline window | `useState('24h')` beside URL-backed `activityPage` | `/team/$id?tab=diagnostics&activity_window=7d` |
| 4 | Team detail (`/team/teams/$teamId`) shared-context Edit/Preview | `useState('edit')` | `/team/teams/$teamId?mode=preview` |

## Architecture decisions

- **Derived selection, default omitted, no URL rewrite for stale ids.** `selected = items.includes(param) ? param : items[0]` for skills/files. Unlike the settings *tab* (page-level view → normalize), an in-page selection with a stale id simply shows the first item; rewriting the URL would need an effect + spy plumbing for no user-visible gain. Documented as the Phase 2 rule for noun params.
- **Tab switches clear the noun params.** `AgentDetail`'s `onValueChange` sets `tab` and clears `skill` + `file` in the same tick (batched into one replace navigation) — `?tab=memory&skill=x` must never linger. Same shape as settings clearing `field`.
- **`activity_window` default `24h`, replace-mode; changing it resets `activityPage` in the same navigation.** Name follows health's `agents_window` / `activity_window` (per-page defaults differ; that is already the case between health tabs).
- **`mode` default `edit`, so only `?mode=preview` ever appears.** Brands' doc editor (Phase 2 PR 5) will mirror this. The dirty-exit guard ignores same-pathname navigations (`unsaved-changes-guard.tsx:87`), so toggling mode while dirty never prompts — pinned by a test.
- **Export `SkillsTab` / `MemoryTab`** from `agent-detail.tsx` so URL-state tests render the real browsers; `agent-detail-tabs.test.tsx` deliberately stubs tab bodies out and its key-agnostic `useQueryState` mock becomes key-aware to assert the clears.
- **Imports stay on `@makinbakin/sdk/hooks`** (compat re-export) — migrating the team plugin to `@makinbakin/sdk/navigation` is a separate sweep; the existing tests mock the compat path.
- **No UI change**: NavList / SegmentedControl / MarkdownEditor keep their contracts; only the state source moves → `ui:conformance --quick` per commit, no story work, no `styles.css` change.

## Dependency graph

```
[T1 skills+memory → ?skill= / ?file= + tab-switch clears]   (independent)
[T2 diagnostics → ?activity_window=]                        (independent)
[T3 team-detail → ?mode=]                                    (independent)
        └──────────────┬──────────────┘
                       ▼
[T4 docs: team-plugin.md, url-state-deep-linking.md row, spec Phase 1 SHIPPED #829 + Phase 2 row]
```

T1–T3 touch disjoint files and could land in any order; T1 first because it is the largest and carries the
shared test harness pattern for the other two.

## Task list

### Task 1: skill + memory-file selection ride the URL (commit 1)

**Description:** `SkillsTab` reads `useQueryState('skill', '')`, `MemoryTab` reads `useQueryState('file', '')`;
selection is derived (param if known, else first). `NavList.onSelect` writes the param (replace). `AgentDetail`
clears both params when the tab changes. Export the two tab components.

**Acceptance criteria:**
- [ ] `/team/pixel?tab=skills&skill=b` renders skill `b` as `aria-current` and fetches `/skills/b`; no param → first skill, zero navigations; unknown id → first skill, zero navigations; selecting `b` → exactly one replace navigation with `skill=b` (and existing `tab=skills` preserved).
- [ ] Same four cases for `?tab=memory&file=2026-09-17.md` against `/memory/<file>`.
- [ ] Switching tab in `AgentDetail` writes `tab` and clears `skill` + `file` (key-aware mock asserts all three setters).

**Verification:**
- [ ] `bun test tests/plugins/team/agent-detail-url-state.test.tsx tests/plugins/team/agent-detail-tabs.test.tsx --isolate`
- [ ] `bun run lint && bun run typecheck && bun run ui:conformance --quick`
- [ ] Headless Playwright on an isolated 3799 boot with a seeded agent that has ≥2 skills + memory files (mock runtime) — or, if seeding is impractical, the RTL cases stand as the evidence and the PR body says so.

**Dependencies:** None. **Files:** `plugins/team/components/agent-detail.tsx`, `tests/plugins/team/agent-detail-url-state.test.tsx` (NEW), `tests/plugins/team/agent-detail-tabs.test.tsx`. **Scope:** M.

**Commit:** `feat(team): skill and memory-file selection ride ?skill= / ?file=`

---

### Task 2: activity-timeline window rides `?activity_window=` (commit 2)

**Description:** `TimelinePanel` replaces `useState<'24h'|'7d'>` with `useQueryState('activity_window', '24h')`
(validated: anything other than `7d` reads as `24h`); the SegmentedControl handler sets the window and resets
`activityPage` in the same tick.

**Acceptance criteria:**
- [ ] `?tab=diagnostics&activity_window=7d` → "7 days" pressed and the timeline fetch carries `window=7d`; `?activity_window=nope` → 24h, no navigation.
- [ ] From `?activity_window=7d&activityPage=3`, choosing "24 hours" emits ONE replace navigation whose search has neither param (both are defaults).
- [ ] From the default, choosing "7 days" emits one navigation with `activity_window=7d` and no `activityPage`.

**Verification:**
- [ ] `bun test tests/plugins/team/diagnostics-tab.test.tsx --isolate` (file gains a per-file spy-navigate router mock + `setURL`)
- [ ] lint, typecheck, `ui:conformance --quick`

**Dependencies:** None. **Files:** `plugins/team/components/diagnostics-tab.tsx`, `tests/plugins/team/diagnostics-tab.test.tsx`. **Scope:** S.

**Commit:** `feat(team): activity timeline window rides ?activity_window=`

---

### Task 3: shared-context Edit/Preview rides `?mode=` (commit 3)

**Description:** `TeamDetail` replaces `useState<MarkdownEditorMode>('edit')` with `useQueryState('mode', 'edit')`
(validated: only `preview` is non-default). Applies to both the global context page and per-team pages (same
component).

**Acceptance criteria:**
- [ ] `/team/teams/media?mode=preview` renders the editor in preview with "Preview" pressed; choosing "Edit" emits one replace navigation with `mode` removed; from default, choosing "Preview" emits one with `mode=preview`.
- [ ] With unsaved edits, toggling mode does not open the unsaved-changes dialog (same pathname).

**Verification:**
- [ ] `bun test tests/plugins/team/team-detail.test.tsx --isolate` (its private router mock gains a seedable `searchStr` + spy navigate)
- [ ] lint, typecheck, `ui:conformance --quick`

**Dependencies:** None. **Files:** `plugins/team/components/team-detail.tsx`, `tests/plugins/team/team-detail.test.tsx`. **Scope:** S.

**Commit:** `feat(team): shared-context editor mode rides ?mode=`

---

### Task 4: docs + spec bookkeeping (commit 4)

**Acceptance criteria:**
- [ ] `.claude/knowledge/team-plugin.md`: URL-state section listing `tab`, `skill`, `file`, `activity_window`, `activityPage`, `lessonId`, `mode` with defaults and clear-on-tab-switch behavior.
- [ ] `.claude/knowledge/url-state-deep-linking.md`: Team row in the status table (`skill`, `file`, `activity_window`, `mode`); `skill` / `file` / `activity_window` rows in the param table (`mode` row extended with `preview`).
- [ ] Spec: Phase 1 status → SHIPPED (PR #829, merged 2026-09-18); Phase 2 table rows 1–3 get this PR's branch/number; "no URL rewrite for stale noun params" recorded under the rules.
- [ ] `bun run docs:validate` green (docs-site team page checked for a natural place; add a one-liner only if the page already documents URLs).

**Dependencies:** T1–T3. **Scope:** S.

**Commit:** `docs(team): URL state for skills, memory files, timeline window, editor mode`

## Checkpoints

- **A (after T1):** focused tests + full `bun run test`, lint, typecheck, `ui:conformance --quick`; commit 1.
- **B (after T2–T3):** full `bun run test`, lint, typecheck, `ui:conformance --quick`; commits 2–3.
- **C (merge-ready):** `check:cycles`, `ui:conformance --full` (visual stage needs Docker — CI covers it if the daemon is down), tree clean (no stamp files), `gh pr create` with the live checklist; NOT merged.

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `agent-detail-tabs.test.tsx`'s key-agnostic `useQueryState` mock returns the tab value for `skill`/`file` | Med — tab derivation breaks under test | Make the mock key-aware (`state[key] ?? default`) as part of T1 |
| `useQueryState` setters from a child tab and the parent's tab setter batch into one URL — the parent's clear of `skill` must not race a child's write | Low | Clears happen only in the tab-change handler; children write only on user select. Test both directions |
| Auto-select-first previously wrote state; now the default is derived — the "content" fetch effect must key on the derived id, not the param | Med — blank pane on first load | Effect deps use `selectedSkill` (derived); test asserts the first skill's content fetch fires with no param |
| Health links to `?tab=diagnostics` (5 producers) keep working | None | Untouched params; test file already covers tab routing |
| Live verification needs seeded skills/memory | Low | RTL through the shim is the primary evidence; live check listed for Mark on 3737 |

## Open questions

None blocking. Recorded, not scheduled: migrate team-plugin imports from `@makinbakin/sdk/hooks` to
`@makinbakin/sdk/navigation` (separate sweep, touches test mocks across the plugin).
