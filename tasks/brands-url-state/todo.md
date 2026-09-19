# TODO — Brands plugin URL state (Phase 2, PR 5)

Branch: `feat/brands-url-state` (after the previous Phase 2 PR merges). Plan: `tasks/brands-url-state/plan.md`.

## Task 1 — `?mode=` (commit `feat(brands): doc editor mode rides ?mode=`)
- [x] `useQueryState('mode', 'edit')` (from `@makinbakin/sdk/navigation`); `mode` validated; control writes the param
- [x] `brand-doc-editor.test.tsx`: the file's `@/hooks/use-query-state` mock is what bun hands the SDK's `useQueryState` too — made key-aware over `routeSearch` with a per-key write spy; cases: preview cold-load, both write directions (edits survive), no dialog when dirty
- [x] Focused tests (14/0), lint (0 errors), typecheck, `ui:conformance --quick` (228/0); full suite — see commit → commit 1

## Task 2 — docs (commit `docs(brands): ?mode= doc editor semantics`)
- [x] `brands-plugin.md` note; `url-state-deep-linking.md` Brands row; spec row 7 + status; `docs:validate` → commit 2

## Checkpoint C
- [x] `check:cycles` (12 pinned, 0 new); `ui:conformance --full` posted on the PR; clean tree; `gh pr create`; NOT merged; CI watched
