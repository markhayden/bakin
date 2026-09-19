# PLAN — Tasks plugin URL state (Phase 2, PR 2 of `.claude/specs/settings-url-state.md`)

Branch `feat/tasks-url-state` from `main` (post-#830). Same shape as the settings and team plans: vertical slices,
one commit each, commit boundaries are rollback points. Reference implementation to copy: the schedule page's
`?jobId=` drawer (`plugins/schedule/components/schedule-page.tsx:73-197`) and memory's `use-record-deep-link.ts`.

## Overview

`/tasks` already reads `?taskId=` — but only once: the kanban board consumes the param on first load, opens the
drawer from a snapshot, and immediately clears the param (`kanban-board.tsx:433-453`). Clicking a card never writes
the URL, so a task drawer cannot be bookmarked, refreshed, or closed with Back. The audit rated this the second
highest-value gap. Two producer defects ride along: the workflows notification builds `/?taskId=` (the `/` route
redirects to `/tasks` and DROPS the search string), and a stale `?taskId=` surfaces as a toast instead of the
schedule-style page feedback.

| Surface | Today | After |
|---|---|---|
| Task drawer open | `useState` snapshot; `?taskId=` consumed once and cleared | `?taskId=<id>` is the open state: card click **pushes** it (Back closes), close **replaces** it away, refresh reopens |
| Stale `?taskId=` | toast "Task not found" + param cleared | page-feedback `Alert` "Task not found" with Dismiss (schedule pattern); param left alone until dismissed |
| Workflows gate notification link | `${base}/?taskId=` (search lost on the `/` redirect) | `${base}/tasks?taskId=` |
| Create-new drawer (`editing && !task`) | local state | unchanged — form/create state is component-level by design (knowledge doc, Tasks row) |

## Architecture decisions

- **Snapshot once per id, not derived per render.** `useTaskDetail`'s form-init effect depends on `task` identity
  (`use-task-detail.ts:173`); a task object re-derived from `boardData.columns` on every SSE refresh would reset the
  edit form mid-edit. So: `detailTask` stays `useState`, and ONE effect keyed on `[taskIdParam, boardLoaded,
  boardData.columns]` resolves the param against the UNFILTERED board (filters must not hide a deep link) and
  snapshots `{task, columnId}` — guarded by `if (detailTask?.task.id === taskIdParam) return` so a board refresh
  never re-snapshots, and clearing the param clears the snapshot. Board-refresh parity with today (drawer content
  is a snapshot) is preserved; the only behavior change is that the URL now holds the open state.
- **History by presentation (Phase 2 rule 2):** open = `pushTaskId(id)` (third tuple item) so Back closes the
  drawer; close/delete/duplicate-close = `setTaskIdParam('')` (replace). Table view (`TaskLogTable.onTaskOpen`)
  and kanban cards share one `openTask(task)` handler.
- **Not-found is page feedback, not a toast.** `taskNotFound = !!taskIdParam && boardLoaded && !boardFailed && !match`
  renders an `Alert tone="danger"` with a Dismiss button (`closeTask`) in the existing `feedback=` slot
  (`kanban-board.tsx:654`) next to the search feedback — the schedule page's exact composition. The param stays
  until dismissed (a link that pointed at a deleted task stays honest in the address bar).
- **Producer fix:** `plugins/workflows/lib/notifications.ts:362` → `/tasks?taskId=`. The `/` → `/tasks` redirect
  dropping search is recorded as a follow-up (forwarding search there is a one-liner but a routing-contract change
  outside this PR's scope).
- **Create drawer stays local.** `openNewTask` sets `editing` without a task; not URL state (would need `mode=create`
  and dirty-guard work — out of scope, documented).
- **Tests** get a NEW file modeled on `kanban-search-signal.test.tsx`'s mock block (dnd-kit, columns, dialog stubbed)
  but WITHOUT the navigation-module mock: the real `@makinbakin/sdk/navigation` runs over the router shim with a
  stable spy navigate, and the stubbed `KanbanColumn` exposes `onTaskClick` while the stubbed `TaskDetailDrawer`
  renders `open` + `task.id` and exposes `onClose`/`onDelete`.

## Dependency graph

```
[T1 URL-backed drawer + not-found feedback + tests]   (independent)
[T2 workflows notification producer + test]           (independent)
        └──────────────┬──────────────┘
                       ▼
[T3 docs: tasks-plugin.md, url-state row, spec row 4]
```

## Task list

### Task 1: `?taskId=` is the drawer's open state (commit 1)

**Acceptance criteria:**
- [ ] `/tasks?taskId=t2` cold-loads with the drawer open on `t2` after the board fetch; zero navigations; filters active (`?agent=x`) do not hide it.
- [ ] Clicking a card emits ONE push navigation carrying `taskId=<id>` (other params preserved); closing emits ONE replace navigation without `taskId`; deleting from the drawer clears the param before the delete dialog opens.
- [ ] `?taskId=nope` renders the "Task not found" alert in the feedback slot, no toast, no navigation; Dismiss emits one replace navigation without `taskId`.
- [ ] A board refresh with the same `taskId` does not re-snapshot (drawer task identity unchanged); clearing the param closes the drawer.

**Verification:** `bun test tests/plugins/tasks/kanban-task-deep-link.test.tsx tests/plugins/tasks/kanban-search-signal.test.tsx tests/components/kanban-dnd.test.tsx --isolate`; lint, typecheck, `ui:conformance --quick`.

**Files:** `plugins/tasks/components/kanban-board.tsx`, `tests/plugins/tasks/kanban-task-deep-link.test.tsx` (NEW). **Scope:** M.

**Commit:** `feat(tasks): task drawer rides ?taskId= (push to open, Back closes)`

### Task 2: workflows notification links to `/tasks?taskId=` (commit 2)

**Acceptance criteria:**
- [ ] `notifications.ts` builds `${base}/tasks?taskId=<id>`; `tests/plugins/workflows/notifications.test.ts` asserts the task link shape (add to the existing body assertion at `:377`).

**Verification:** `bun test tests/plugins/workflows/notifications.test.ts --isolate`; lint, typecheck.

**Files:** `plugins/workflows/lib/notifications.ts`, `tests/plugins/workflows/notifications.test.ts`. **Scope:** XS.

**Commit:** `fix(workflows): gate notification deep-links to /tasks?taskId= (the / redirect drops search)`

### Task 3: docs + spec (commit 3)

- [ ] `.claude/knowledge/tasks-plugin.md`: URL-state paragraph (`taskId` push/replace semantics, not-found feedback, create drawer local by design).
- [ ] `.claude/knowledge/url-state-deep-linking.md`: Tasks row — `taskId` is now inbound AND outbound; `taskId` param row notes push/Back-closes.
- [ ] Spec: Phase 2 row 4 → implemented; follow-up: `/` redirect should forward search.
- [ ] `bun run docs:validate`.

**Commit:** `docs(tasks): ?taskId= drawer semantics`

## Checkpoints

- **A (after T1):** focused tests + full `bun run test`, lint, typecheck, `ui:conformance --quick`; commit 1.
- **B (after T2):** full suite, lint, typecheck; commit 2.
- **C (merge-ready, after T3):** `check:cycles`, `ui:conformance --full` (Docker stage → CI), clean tree, `gh pr create`; NOT merged.

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Re-snapshot on board refresh resets the edit form | High — lost edits | Same-id guard in the effect; test pins identity stability across a refresh |
| Consuming the param before the first board fetch eats deep links (the bug the old `boardLoaded` gate fixed) | High | Effect still gates on `boardLoaded`; test cold-loads with the board arriving after mount |
| Push on every card click floods history | Low — by design (drawer = overlay = push; Back closes); matches memory + schedule | Documented; close uses replace so Back after close skips the drawer |
| ⌘K hit renderer / scheduled-events / brands / workflows attention already build `/tasks?taskId=` | None — they now open the drawer AND keep the URL | Untouched |
| Existing kanban tests mock `useQueryState` with `useState`, so `pushTaskId` (third tuple item) is `undefined` there | Med — TypeError on click | Those tests stub `KanbanColumn` (no clicks) — verify; if a click path exists, extend the mock tuple |

## Open questions

None blocking. Follow-ups: `/` redirect forwarding search; `mode=create` for the new-task drawer (not requested).
