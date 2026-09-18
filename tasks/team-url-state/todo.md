# TODO — Team plugin URL state (Phase 2, PR 1)

Branch: `feat/team-url-state`. Plan: `tasks/team-url-state/plan.md`. Spec: `.claude/specs/settings-url-state.md` (Phase 2 rules).

## Task 1 — `?skill=` / `?file=` (commit `feat(team): skill and memory-file selection ride ?skill= / ?file=`)
- [x] `SkillsTab`: `useQueryState('skill', '')`, derived selection (param if known else first), `onSelect` → setter (replace)
- [x] `MemoryTab`: same with `useQueryState('file', '')`
- [x] Content-fetch effects key on the derived id
- [x] `AgentDetail` tab change clears `skill` + `file` in the same tick as `tab`
- [x] Export `SkillsTab` / `MemoryTab`
- [x] NEW `tests/plugins/team/agent-detail-url-state.test.tsx` (shim + spy navigate + setURL): 4 skill cases + 4 file cases
- [x] `agent-detail-tabs.test.tsx`: key-aware `useQueryState` mock; assert tab switch clears both nouns
- [x] Focused tests, full `bun run test`, lint, typecheck, `ui:conformance --quick`
- [x] **Checkpoint A** → commit 1

## Task 2 — `?activity_window=` (commit `feat(team): activity timeline window rides ?activity_window=`)
- [x] `TimelinePanel`: `useQueryState('activity_window', '24h')`, validated to `'24h' | '7d'`
- [x] Segmented handler sets window + resets `activityPage` (one navigation)
- [x] `diagnostics-tab.test.tsx`: per-file spy-navigate router mock + `setURL`; 3 cases
- [x] lint, typecheck, `ui:conformance --quick` → commit 2

## Task 3 — `?mode=` (commit `feat(team): shared-context editor mode rides ?mode=`)
- [x] `TeamDetail`: `useQueryState('mode', 'edit')`, validated to `MarkdownEditorMode`
- [x] `team-detail.test.tsx`: seedable `searchStr` + spy navigate; 3 cases incl. dirty toggle without dialog
- [x] lint, typecheck, `ui:conformance --quick`
- [ ] **Checkpoint B** (full `bun run test`) → commit 3

## Task 4 — docs (commit `docs(team): URL state for skills, memory files, timeline window, editor mode`)
- [x] `team-plugin.md` URL-state section
- [x] `url-state-deep-linking.md`: Team status row + `skill` / `file` / `activity_window` param rows; `mode` row += `preview`
- [x] Spec: Phase 1 → SHIPPED #829; Phase 2 rows 1–3 → this PR; stale-noun-param rule recorded
- [x] `bun run docs:validate` (49 pages)
- [ ] commit 4

## Checkpoint C — merge-ready
- [ ] `check:cycles`, `ui:conformance --full` (Docker stage → CI if daemon down), full `bun run test`, lint, typecheck
- [ ] Tree clean, no stamp files
- [ ] `gh pr create` with live checklist; NOT merged; watch CI
