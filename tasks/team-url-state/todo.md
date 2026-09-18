# TODO — Team plugin URL state (Phase 2, PR 1)

Branch: `feat/team-url-state`. Plan: `tasks/team-url-state/plan.md`. Spec: `.claude/specs/settings-url-state.md` (Phase 2 rules).

## Task 1 — `?skill=` / `?file=` (commit `feat(team): skill and memory-file selection ride ?skill= / ?file=`)
- [ ] `SkillsTab`: `useQueryState('skill', '')`, derived selection (param if known else first), `onSelect` → setter (replace)
- [ ] `MemoryTab`: same with `useQueryState('file', '')`
- [ ] Content-fetch effects key on the derived id
- [ ] `AgentDetail` tab change clears `skill` + `file` in the same tick as `tab`
- [ ] Export `SkillsTab` / `MemoryTab`
- [ ] NEW `tests/plugins/team/agent-detail-url-state.test.tsx` (shim + spy navigate + setURL): 4 skill cases + 4 file cases
- [ ] `agent-detail-tabs.test.tsx`: key-aware `useQueryState` mock; assert tab switch clears both nouns
- [ ] Focused tests, full `bun run test`, lint, typecheck, `ui:conformance --quick`
- [ ] **Checkpoint A** → commit 1

## Task 2 — `?activity_window=` (commit `feat(team): activity timeline window rides ?activity_window=`)
- [ ] `TimelinePanel`: `useQueryState('activity_window', '24h')`, validated to `'24h' | '7d'`
- [ ] Segmented handler sets window + resets `activityPage` (one navigation)
- [ ] `diagnostics-tab.test.tsx`: per-file spy-navigate router mock + `setURL`; 3 cases
- [ ] lint, typecheck, `ui:conformance --quick` → commit 2

## Task 3 — `?mode=` (commit `feat(team): shared-context editor mode rides ?mode=`)
- [ ] `TeamDetail`: `useQueryState('mode', 'edit')`, validated to `MarkdownEditorMode`
- [ ] `team-detail.test.tsx`: seedable `searchStr` + spy navigate; 3 cases incl. dirty toggle without dialog
- [ ] lint, typecheck, `ui:conformance --quick`
- [ ] **Checkpoint B** (full `bun run test`) → commit 3

## Task 4 — docs (commit `docs(team): URL state for skills, memory files, timeline window, editor mode`)
- [ ] `team-plugin.md` URL-state section
- [ ] `url-state-deep-linking.md`: Team status row + `skill` / `file` / `activity_window` param rows; `mode` row += `preview`
- [ ] Spec: Phase 1 → SHIPPED #829; Phase 2 rows 1–3 → this PR; stale-noun-param rule recorded
- [ ] `bun run docs:validate` → commit 4

## Checkpoint C — merge-ready
- [ ] `check:cycles`, `ui:conformance --full` (Docker stage → CI if daemon down), full `bun run test`, lint, typecheck
- [ ] Tree clean, no stamp files
- [ ] `gh pr create` with live checklist; NOT merged; watch CI
