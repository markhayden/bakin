# TODO — Tasks plugin URL state (Phase 2, PR 2)

Branch: `feat/tasks-url-state`. Plan: `tasks/tasks-url-state/plan.md`. Spec: `.claude/specs/settings-url-state.md` (Phase 2 rules).

## Task 1 — `?taskId=` drawer (commit `feat(tasks): task drawer rides ?taskId= (push to open, Back closes)`)
- [ ] `openTask(task, columnId)` → `pushTaskId(task.id)`; `closeTask()` → `setTaskIdParam('')`; delete/duplicate-close paths call `closeTask`
- [ ] Snapshot effect keyed on `[taskIdParam, boardLoaded, boardData.columns]`, same-id guard, clears on empty param
- [ ] `taskNotFound` → `Alert tone="danger"` + Dismiss in the `feedback=` slot (no toast)
- [ ] Card click + table `onTaskOpen` share `openTask`; `editing` stays local
- [ ] NEW `tests/plugins/tasks/kanban-task-deep-link.test.tsx` (shim + spy navigate + board fetch fixture; stubbed column/dialog expose the callbacks): cold-load, push on open, replace on close, delete clears, not-found alert + dismiss, same-id refresh stability
- [ ] Existing kanban tests still green (`kanban-search-signal`, `kanban-dnd`)
- [ ] Focused tests, full `bun run test`, lint, typecheck, `ui:conformance --quick`
- [ ] **Checkpoint A** → commit 1

## Task 2 — workflows notification link (commit `fix(workflows): gate notification deep-links to /tasks?taskId= (the / redirect drops search)`)
- [ ] `notifications.ts:362` → `/tasks?taskId=`
- [ ] `notifications.test.ts` asserts the task link
- [ ] **Checkpoint B** (full suite, lint, typecheck) → commit 2

## Task 3 — docs (commit `docs(tasks): ?taskId= drawer semantics`)
- [ ] `tasks-plugin.md` URL-state paragraph
- [ ] `url-state-deep-linking.md`: Tasks row + `taskId` param row
- [ ] Spec: row 4 implemented; follow-up recorded (`/` redirect search forwarding)
- [ ] `docs:validate` → commit 3

## Checkpoint C — merge-ready
- [ ] `check:cycles`, `ui:conformance --full` (Docker stage → CI), clean tree
- [ ] `gh pr create` with live checklist; NOT merged; watch CI
