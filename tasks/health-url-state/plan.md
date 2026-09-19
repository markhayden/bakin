# PLAN — Health plugin URL state (Phase 2, PR 6)

Branch `feat/health-url-state` from `main` after the previous Phase 2 PR merges. Two commits.

## Overview

On `/health?tab=agents` the usage chart's metric toggle (tokens vs cost) is `useState` (`agents-usage-chart.tsx:149`,
control at `:185-189`) while the window it sits beside is URL state (`agents_window`, `agents-tab.tsx:24`). Move the
metric to `?agents_metric=` so the two controls share one convention.

| Surface | Today | After |
|---|---|---|
| Agents usage chart metric | `useState<UsageMetric>('tokens')` | `?agents_metric=` (default `tokens`, omitted; only `cost` appears); replace-mode |

## Architecture decisions

- Read the param in `AgentsUsageChart` itself (the component that owns the control) via `useQueryState('agents_metric',
  'tokens')` from `@makinbakin/sdk/hooks` — the SAME path `agents-tab.tsx` uses, because `agents-tab.test.tsx` mocks
  `@makinbakin/sdk/hooks` with a state-backed `useQueryState` and records `queryKeys` (it asserts `agents_window` is
  among them; the new key joins that assertion). Validate: anything but `cost` reads as `tokens`.
- No UI change.

## Task list

### Task 1: `?agents_metric=` (commit 1)

**Acceptance criteria:**
- [ ] The Usage metric tablist reflects `?agents_metric=cost` on load; choosing Tokens writes the default (param dropped); choosing Cost writes `cost`; an unknown value reads as tokens without a write.
- [ ] `agents-tab.test.tsx`'s recorded query keys include `agents_metric` alongside `agents_window`.

**Verification:** `bun test tests/plugins/health/agents-tab.test.tsx --isolate` (cases added there); lint, typecheck, `ui:conformance --quick`; full `bun run test`.

**Files:** `plugins/health/components/agents-usage-chart.tsx`, `tests/plugins/health/agents-tab.test.tsx`. **Scope:** XS.

**Commit:** `feat(health): usage chart metric rides ?agents_metric=`

### Task 2: docs + spec (commit 2)

- [ ] `agent-health-diagnostics.md` (or `url-state-deep-linking.md` Health row): `agents_metric` beside `agents_window`; param row.
- [ ] Spec: status; row 8 implemented. `docs:validate`.

**Commit:** `docs(health): ?agents_metric= beside ?agents_window=`
