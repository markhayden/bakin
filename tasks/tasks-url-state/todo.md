# TODO — Tasks plugin URL state (Phase 2, PR 2)

Branch: `feat/tasks-url-state`. Plan: `tasks/tasks-url-state/plan.md`. Spec: `.claude/specs/settings-url-state.md` (Phase 2 rules).

## Task 1 — `?taskId=` drawer (commit `feat(tasks): task drawer rides ?taskId= (push to open, Back closes)`)
- [x] `openTask(task, columnId)` → `pushTaskId(task.id)`; `closeTask()` → `setTaskIdParam('')`; delete/duplicate-close paths call `closeTask`
- [x] Snapshot effect keyed on `[taskIdParam, boardLoaded, boardData.columns]`, same-id guard, clears on empty param
- [x] `taskNotFound` → `Alert tone="danger"` + Dismiss in the `feedback=` slot (no toast)
- [x] Card click + table `onTaskOpen` share `openTask`; `editing` stays local
- [x] NEW `tests/plugins/tasks/kanban-task-deep-link.test.tsx` (shim + spy navigate + board fetch fixture; stubbed column/dialog expose the callbacks): cold-load, push on open, replace on close, delete clears, not-found alert + dismiss, same-id refresh stability
- [x] Existing kanban tests still green (`kanban-search-signal`, `kanban-dnd`)
- [x] Focused tests, full `bun run test` (9347 pass; the 4 `build-sdk-package` failures were Bits-checkout drift on a clean main — fixed by putting ../bakin-bits-official on the pinned ref, then 6/0), lint, typecheck, `ui:conformance --quick` (228/0 once Bits was on the pinned ref)
- [x] **Checkpoint A** → commit 1

## Task 2 — workflows notification link (commit `fix(workflows): gate notification deep-links to /tasks?taskId= (the / redirect drops search)`)
- [x] `notifications.ts:362` → `/tasks?taskId=`
- [x] `notifications.test.ts` asserts the task link
- [x] **Checkpoint B** (full suite, lint, typecheck) → commit 2

## Task 3 — docs (commit `docs(tasks): ?taskId= drawer semantics`)
- [x] `tasks-plugin.md` URL-state paragraph
- [x] `url-state-deep-linking.md`: Tasks row + `taskId` param row
- [x] Spec: row 4 implemented; follow-up recorded (`/` redirect search forwarding)
- [x] `docs:validate` (49 pages)
- [x] commit 3

## Checkpoint C — merge-ready
- [x] `check:cycles` (12 pinned, 0 new); `ui:conformance --full` result posted on the PR; clean tree
- [x] `gh pr create` with live checklist; NOT merged; CI watched
