# TODO — Workflows plugin URL state (Phase 2, PR 3)

Branch: `feat/workflows-url-state` (create AFTER #839 merges). Plan: `tasks/workflows-url-state/plan.md`.

## Task 1 — `?step=` drawer (commit `feat(workflows): step drawer rides ?step= (push to open, Back closes)`)
- [x] `useQueryState('step', '')` from `@makinbakin/sdk/navigation`; `selectedStep` derived via `findStepByNodeId`; `drawerOpen = selectedStep !== null`
- [x] `handleNodeClick` → `pushStep(nodeId)` (trigger ids still ignored); `onOpenChange(false)` → `setStepParam('')`
- [x] NEW `tests/plugins/workflows/workflow-detail-url-state.test.tsx` (shim + spy navigate + setURL; canvas/drawer stubs capture props): cold-load, push on click, replace on close, stale id closed
- [x] Existing `workflow-detail` + `map-step-ui` tests green
- [x] Focused tests (14/0 across 3 files), lint (0 errors), typecheck, `ui:conformance --quick` (228/0); full `bun run test` — see commit
- [x] **Checkpoint A** → commit 1

## Task 2 — docs (commit `docs(workflows): ?step= drawer semantics`)
- [x] `workflows-plugin.md` URL-state note
- [x] `url-state-deep-linking.md`: Workflows row + `step` param row
- [x] Spec: status + row 5 implemented
- [x] `docs:validate` (49 pages) → commit 2

## Checkpoint C — merge-ready
- [x] `check:cycles` (12 pinned, 0 new); `ui:conformance --full` result posted on the PR; clean tree
- [x] `gh pr create` with live checklist; NOT merged; CI watched
