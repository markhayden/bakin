# TODO — Health plugin URL state (Phase 2, PR 6)

Branch: `feat/health-url-state`. Plan: `tasks/health-url-state/plan.md`.

## Task 1 — `?agents_metric=` (commit `feat(health): usage chart metric rides ?agents_metric=`)
- [x] `AgentsUsageChart`: `useQueryState('agents_metric', 'tokens')` via `@makinbakin/sdk/hooks` (matches agents-tab + its test mock); validated to `tokens | cost`
- [x] `agents-tab.test.tsx` (mock gains a seed map + write spy): `queryKeys` includes `agents_metric`; cost cold-load; both write directions
- [x] Focused tests (34/0), lint (0 errors), typecheck, `ui:conformance --quick` (228/0); full suite — see commit → commit 1

## Task 2 — docs (commit `docs(health): ?agents_metric= beside ?agents_window=`)
- [x] `url-state-deep-linking.md` Health row + param row; `agent-health-diagnostics.md` note; spec row 8 + status; `docs:validate` → commit 2

## Checkpoint C
- [x] `check:cycles` (12 pinned, 0 new); `ui:conformance --full` posted on the PR; clean tree; `gh pr create`; NOT merged; CI watched
