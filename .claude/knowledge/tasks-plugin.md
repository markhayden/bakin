# Tasks Plugin — Deep Reference

## Overview

The Tasks plugin provides a kanban-style task management system backed by OpenClaw's `flow_runs` SQLite table. Tasks are organized into 7 columns with enforced state transitions, assigned to agents, and tracked with timestamped log entries. The plugin integrates with workflows (gated multi-step pipelines), projects (checklist auto-check), and the dispatch engine (auto-assignment to agents).

**Plugin ID:** `tasks`
**Dependencies:** none (other plugins depend on it)
**Permissions:** `storage.read`, `storage.write`, `events.emit`
**Storage:** SQLite — `{OPENCLAW_HOME}/flows/registry.sqlite` (shared with OpenClaw, resolved via `getOpenClawPath()`)

## Data Model

### Persistence Layer — `flow_runs` Table

Tasks are stored as rows in OpenClaw's `flow_runs` table, filtered by `owner_key LIKE 'bakin:task:%'`. Each task maps to one `flow_run` row:

| flow_runs column | Bakin usage |
|---|---|
| `flow_id` | Task ID (8-char hex) |
| `owner_key` | `bakin:task:{flow_id}` |
| `status` | Maps to Bakin columns (see mapping below) |
| `goal` | Task title (denormalized from state_json) |
| `state_json` | All Bakin metadata: title, agent, description, log[], dependsOn, etc. |
| `wait_json` | Gate approval data (`{ type: 'gate_approval', requestedAt }`) for review column |
| `blocked_task_id` | Sentinel `'blocked'` for blocked column (distinguishes from review) |
| `blocked_summary` | Blocked reason string |
| `created_at` / `updated_at` | Unix ms timestamps |
| `ended_at` | Set when task reaches done/confirmed |

### Column ↔ Status Mapping

| Bakin Column | flow_runs.status | Disambiguation |
|---|---|---|
| backlog | `queued` | `state_json.column = 'backlog'` |
| todo | `queued` | `state_json.column = 'todo'` (default) |
| inProgress | `running` | — |
| review | `waiting` | `blocked_task_id IS NULL` |
| blocked | `waiting` | `blocked_task_id = 'blocked'` |
| done | `succeeded` | `state_json.confirmed` falsy |
| confirmed | `succeeded` | `state_json.confirmed = true` |

Failed/cancelled flows map to `done` column.

### state_json Shape

```typescript
interface BakinTaskState {
  title: string
  agent?: string           // assigned agent ID
  description?: string     // multi-line task description
  column?: 'backlog' | 'todo'  // disambiguation for queued status
  dependsOn?: string       // task ID this task depends on
  parentId?: string        // parent task ID for sub-tasks
  createdBy?: string       // agent that created the task
  workflowId?: string      // linked workflow definition ID
  projectId?: string       // linked project ID
  scheduleJobId?: string   // linked schedule job ID
  confirmed?: boolean      // true for confirmed column
  date?: string            // YYYY-MM-DD, set when entering inProgress/review/done/confirmed
  log?: TaskLogEntry[]     // timestamped progress entries
}
```

### Task (UI type)

```typescript
interface Task {
  id: string              // 8-char hex (e.g., "a1b2c3d4") or compound "parentId--stepId"
  title: string
  agent?: string
  createdBy?: string
  checked: boolean         // true when in done or confirmed columns
  date?: string            // YYYY-MM-DD
  blockedReason?: string
  description?: string
  log?: TaskLogEntry[]
  dependsOn?: string
  parentId?: string
  workflowId?: string
  scheduleJobId?: string
  projectId?: string
}
```

### Task ID Generation

IDs are 8-character hex strings generated from 4 random bytes via `crypto.getRandomValues()` (with `Math.random()` fallback). Compound IDs use the format `parentId--stepId` for workflow child tasks.

**File:** `plugins/tasks/lib/ids.ts`

## Column System

### 7 Columns

| Column | Header | Emoji | `checked` | `date` set? |
|--------|--------|-------|-----------|-------------|
| backlog | 📦 Backlog | 📦 | false | no |
| todo | 📋 Todo | 📋 | false | no |
| blocked | 🔴 Blocked | 🔴 | false | no (cleared) |
| inProgress | 🔵 In Progress | 🔵 | false | yes |
| review | 🔍 Review | 🔍 | false | yes |
| done | ✅ Done | ✅ | true | yes |
| confirmed | 🟣 Confirmed | 🟣 | true | yes |

### Valid State Transitions

```
backlog    → todo
todo       → inProgress, blocked, done, backlog
inProgress → review, done, blocked, todo
blocked    → todo, inProgress, backlog
review     → done, inProgress, todo
done       → confirmed, todo, inProgress
confirmed  → done, todo
```

**Key constraints:**
- `backlog` can only move to `todo` (must be triaged first)
- `todo` cannot go directly to `review` (must pass through `inProgress`)
- `review` cannot go to `blocked` (send back to `inProgress` or `todo` first)
- Moving to `done` requires at least one log entry (agents must document their work)
- Workflow tasks cannot be moved to `done` directly — the workflow engine manages completion via `bakin_submit_step`

## Architecture

### Server-Side Files

| File | Purpose |
|------|---------|
| `plugins/tasks/index.ts` | Plugin entry: registers 12 API routes + 11 exec tools + 9 hooks + archival |
| `plugins/tasks/lib/flow-store.ts` | SQLite adapter: CRUD, transitions, reorder, archive |
| `plugins/tasks/lib/ids.ts` | Task ID generation (crypto-safe) |
| `plugins/tasks/types.ts` | TypeScript interfaces (Task, TaskColumns, TaskBoard, ColumnId) |
| `plugins/tasks/constants.ts` | Column config, header maps, status dot colors, badge styles |
| `src/lib/taskboard.ts` | Re-export shim (delegates to flow-store) |
| `src/core/task-service.ts` | Service layer: wraps mutations with side effects (audit, SSE, workflow guards, continuation) |
| `src/core/dispatch.ts` | Task dispatch engine (auto-assigns todo tasks to agents) |
| `src/core/continuation.ts` | Dependent task unblocking when a task completes |

### Client-Side Files

| File | Purpose |
|------|---------|
| `plugins/tasks/client.tsx` | Nav items export |
| `plugins/tasks/components/kanban-board.tsx` | Main kanban view — fetches from `/api/plugins/tasks/`, subscribes to SSE via `taskboardVersion` |
| `plugins/tasks/components/kanban-column.tsx` | Single column rendering with task cards and footer |
| `plugins/tasks/components/task-card.tsx` | Individual task card (avatar, title, status badge, log count) |
| `plugins/tasks/components/task-detail-dialog.tsx` | Slide-out drawer for viewing/editing task details |
| `plugins/tasks/components/delete-task-dialog.tsx` | Confirmation dialog for task deletion |
| `plugins/tasks/components/task-filters.tsx` | Agent avatar filter bar + status facet filter |
| `plugins/tasks/components/task-metrics.tsx` | Summary metrics row (counts by column) |
| `plugins/tasks/components/task-log-table.tsx` | Table view of tasks (alternative to kanban) |

### Drag-and-Drop (dnd-kit)

The kanban board uses `@dnd-kit/core` v6 + `@dnd-kit/sortable` v10 for drag-and-drop:

- **Sortable IDs** are plain `task.id` (not composite), so dnd-kit tracks items across containers.
- **`useSortable` data** includes custom `{ task, columnId }` plus dnd-kit's internal `sortable: { containerId, index, items }`.
- **Collision detection** uses `pointerWithin` + `closestCenter` fallback for reliable multi-container detection.
- **`handleDragOver`** moves items between columns in optimistic state (via `setOptimistic`) so dnd-kit shows displacement in the target column during drag.
- **`handleDragCancel`** restores the drag-start column snapshot.

**Critical: stale-ref pitfall.** `active.data.current.columnId` is a live ref that `useSortable` updates when the component re-renders in a new column (after `handleDragOver`). In `handleDragEnd`, it reflects the *target* column, not the source. The source column must be captured in a ref at drag start (`dragFromColRef`). Similarly, target column must be read from `over.data.current` / `over.id`, not from optimistic state (which may be stale in the `useCallback` closure).

**Ordering.** Tasks within columns are ordered by `updated_at DESC`. The `/reorder` endpoint stamps `updated_at` values (now-0, now-1, ...) to encode position. Cross-column moves call `/move` then `/reorder` to persist drop position.

### Real-Time Updates (SSE)

1. Every write operation in `flow-store.ts` calls `broadcastChange()` which fires `globalThis.__bakinBroadcast({ type: 'taskboard' })`
2. The SSE server sends this as a `type: 'taskboard'` event to all connected clients
3. The global `use-sse.ts` hook receives the event and calls `bumpTaskboard()` on the Zustand store
4. `kanban-board.tsx` subscribes to `taskboardVersion` and re-fetches from `/api/plugins/tasks/` on change
5. No file watcher needed — SQLite writes trigger SSE broadcasts directly

### Database Access Pattern

```typescript
// better-sqlite3 sync API with open/close per operation
function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = openDb()  // WAL mode, 5s busy_timeout
  try { return fn(db) }
  finally { db.close() }
}
```

All read operations are synchronous. All write operations return `Promise<T>` for backward compatibility with callers that chain `.then()` (workflow runtime, dispatch). Errors are caught and returned as `Promise.reject()` to ensure proper promise rejection.

## API Routes

All routes are registered at `/api/plugins/tasks/{path}` via the plugin route system. 12 RESTful routes:

| Method | Path | Handler |
|--------|------|---------|
| GET | `/` | List all tasks (taskboard) |
| GET | `/:taskId` | Get single task details |
| POST | `/` | Create task |
| PUT | `/:taskId` | Update task |
| DELETE | `/:taskId` | Delete task |
| POST | `/:taskId/move` | Move to column |
| POST | `/:taskId/assign` | Assign to agent |
| POST | `/:taskId/log` | Log progress |
| POST | `/:taskId/block` | Block with reason |
| POST | `/:taskId/dependency` | Set dependency |
| POST | `/:taskId/complete` | Report complete |
| POST | `/reorder` | Reorder within column |

## Exec Tools

11 MCP exec tools registered via `ctx.registerExecTool()`, naming: `bakin_exec_tasks_{action}`:

| Tool | Action |
|------|--------|
| `bakin_exec_tasks_list` | List all tasks |
| `bakin_exec_tasks_get` | Get single task details |
| `bakin_exec_tasks_create` | Create task |
| `bakin_exec_tasks_move` | Move to column |
| `bakin_exec_tasks_block` | Block with reason |
| `bakin_exec_tasks_complete` | Report complete |
| `bakin_exec_tasks_log_progress` | Log progress |
| `bakin_exec_tasks_set_dependency` | Set dependency |
| `bakin_exec_tasks_update` | Update task fields |
| `bakin_exec_tasks_delete` | Delete task |
| `bakin_exec_tasks_assign` | Assign to agent |

## Hook Registry

The tasks plugin registers 9 hooks for cross-plugin communication:

| Hook | Parameters | Returns | Used by |
|------|-----------|---------|---------|
| `tasks.readTaskboard` | `{}` | `TaskBoard` | workflows, projects, dispatch, task-service |
| `tasks.createTask` | `{ title, column?, assignee?, description?, workflowId?, createdBy?, id?, parentId?, projectId? }` | `Task` | task-service, workflows |
| `tasks.moveTask` | `{ identifier, to, from? }` | `void` | task-service |
| `tasks.blockTask` | `{ identifier, reason, agent? }` | `void` | task-service |
| `tasks.addTaskLog` | `{ identifier, author, message }` | `void` | task-service |
| `tasks.updateTask` | `{ identifier, updates }` | `void` | task-service, workflows |
| `tasks.deleteTask` | `{ identifier }` | `void` | task-service |
| `tasks.setDependency` | `{ taskId, dependsOnId }` | `void` | task-service |
| `tasks.clearDependency` | `{ taskId }` | `void` | task-service |

**Note:** `identifier` accepts either task ID or title (ID preferred, title fallback).

## Task Service Layer

`src/core/task-service.ts` wraps raw flow-store mutations with side effects. Both REST routes and MCP tool handlers call these functions to ensure consistent behavior:

| Function | Side effects |
|----------|-------------|
| `logProgress` | SSE broadcast → persist log entry |
| `moveTaskWithEffects` | Workflow done-guard → move → audit → Antfly index → continuation trigger → project auto-check → parent unblock |
| `blockTaskWithEffects` | Block task → audit → propagate to parent (for child workflow tasks) |
| `createTaskWithEffects` | Auto-match workflow → create → start workflow instance → audit |
| `reportComplete` | Reject workflow tasks → log → move to done → notify orchestrator |
| `setDependencyWithEffects` | Set dependency → audit |
| `getTaskDetails` | Read board → find task by ID |
| `triggerDispatch` | Fire-and-forget POST to `/api/dispatch` |

## Plugin Settings

Configurable via `/settings` page:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `defaultColumn` | select | `"todo"` | Which column new tasks are created in |
| `showCompleted` | boolean | `true` | Show Done and Confirmed columns by default |
| `autoArchiveDays` | number | `0` | Auto-archive completed tasks after N days (0 = disabled) |
| `maxInProgress` | number | `5` | Warn when too many tasks are in progress |

### Auto-Archival

When `autoArchiveDays > 0`, the plugin deletes `flow_runs` rows with `status IN ('succeeded', 'failed', 'cancelled')` and `ended_at` older than the configured threshold. Runs on plugin activation and every 6 hours via `setInterval`.

## Integration Points

### Workflows Plugin
- Tasks with `workflowId` are managed by the workflow engine
- Workflow tasks cannot be moved to Done directly (done-guard in `moveTaskWithEffects`)
- Child workflow tasks use compound IDs: `parentId--stepId`
- Blocking a child task propagates the block to the parent
- Workflow completion moves the task to Done via `moveTaskWithEffects` with `skipDoneGuard: true`

### Projects Plugin
- Tasks can be linked to projects via `projectId`
- When a task moves to done or confirmed, `projects.autoCheckLinkedItem` hook is invoked

### Dispatch Engine
- `src/core/dispatch.ts` reads todo tasks and assigns them to available agents
- `moveTaskToInProgress` moves assigned tasks from todo to inProgress
- Agents pick up tasks via MCP tools, report progress via `logProgress`, and complete via `reportComplete`

### Schedule Plugin
- Tasks can be linked to cron jobs via `scheduleJobId`
- Scheduled jobs can auto-create tasks on their cron schedule

### Continuation System
- Tasks can declare `dependsOn: {taskId}`
- When a dependency completes (moves to done), `checkAndContinueDependents` finds and unblocks/dispatches dependent tasks

### Antfly Search
- Completed tasks are indexed in Antfly for full-text search via `indexCompletedTask`

## Date Handling

- `localDateString()` returns `YYYY-MM-DD` using the server's local timezone (not UTC)
- Dates are set when tasks enter: `inProgress`, `review`, `done`, `confirmed`
- Dates are cleared when tasks enter: `blocked`
- No date is set for: `backlog`, `todo`

## Testing

Test files:
- `tests/plugins/tasks/flow-store.test.ts` — Unit tests for SQLite adapter: CRUD, transitions, column mapping, archival
- `tests/plugins/tasks/routes.test.ts` — Integration tests for REST API routes and MCP exec tools

Run: `npx vitest run tests/plugins/tasks/`
