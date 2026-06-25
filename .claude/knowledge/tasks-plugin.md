# Tasks Plugin — Deep Reference

## Overview

The Tasks plugin provides a kanban-style task management system backed by Bakin's file task store under `~/.bakin/tasks/`. Tasks are organized into 7 columns with enforced state transitions, assigned to agents, and tracked with timestamped log entries. The plugin integrates with workflows (gated multi-step pipelines), generic task extension hooks for installed plugins, and the dispatch engine (auto-assignment to agents).

**Plugin ID:** `tasks`
**Dependencies:** none (other plugins depend on it)
**Permissions:** `storage.read`, `storage.write`, `events.emit`
**Storage:** JSON task documents under `getBakinPaths().tasks`

## Data Model

### Persistence Layer — Bakin Task Store

Tasks are stored by `packages/core/src/tasks/store.ts` as one JSON document per task:

```
~/.bakin/tasks/{YYYY-MM}/task-{id}.json
```

`src/core/task-store.ts` is the shared task service used by routes, workflows, dispatch, and tests. It delegates to `createFileBakinTaskStore(getBakinPaths().tasks)` and is owned by Bakin core, not by the tasks plugin or runtime execution adapter.

Scheduled task fields are task-native. Plugins should create real board tasks
with `availableAt` instead of registering private cron/sweep loops when the work
belongs on the board. `availableAt` gates dispatcher eligibility; it does not
move the task to a different column. `dueAt` is display/deadline metadata.

### Task JSON Shape

```typescript
interface BakinTaskState {
  title: string
  agent?: string           // assigned agent ID
  description?: string     // multi-line task description
  column: 'backlog' | 'todo' | 'inProgress' | 'review' | 'blocked' | 'done' | 'archived'
  dependsOn?: string       // task ID this task depends on
  parentId?: string        // parent task ID for sub-tasks
  createdBy?: string       // agent that created the task
  workflowId?: string      // linked workflow definition ID
  projectId?: string       // linked project ID
  scheduleJobId?: string   // linked schedule job ID
  availableAt?: string     // earliest dispatcher pickup timestamp
  dueAt?: string           // deadline/expectation timestamp
  source?: {               // plugin/domain provenance for repair and UI links
    pluginId: string
    entityType?: string
    entityId?: string
    purpose?: string
  }
  date?: string            // YYYY-MM-DD, set when entering inProgress/review/done/archived
  log?: TaskLogEntry[]     // timestamped progress entries
  comments?: TaskComment[] // human comments
  blockedBy?: string[]     // dependency/task blockers
  blocking?: string[]      // tasks blocked by this task
  pendingDelete?: boolean
  execution?: {
    flowId: string | null
    state?: string
    currentStep?: string | null
    blockingReason?: string | null
    retryCount?: number
    startedAt?: string | null
    endedAt?: string | null
    lastSyncedAt?: string | null
  }
  order?: number           // zero-indexed order within the current column
  createdAt: string
  updatedAt: string
}
```

### Task (UI type)

```typescript
interface TaskSource {
  pluginId: string
  entityType?: string
  entityId?: string
  purpose?: string
}

interface Task {
  id: string              // 8-char hex (e.g., "a1b2c3d4") or compound "parentId--stepId"
  title: string
  agent?: string
  createdBy?: string
  checked: boolean         // true when in done or archived columns
  date?: string            // YYYY-MM-DD
  blockedReason?: string
  description?: string
  availableAt?: string
  dueAt?: string
  source?: TaskSource
  log?: TaskLogEntry[]
  dependsOn?: string
  parentId?: string
  workflowId?: string
  scheduleJobId?: string
  projectId?: string
  order?: number
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
| archived | 📦 Archived | 📦 | true | yes |

### Valid State Transitions

```
backlog    → todo
todo       → inProgress, blocked, done, backlog
inProgress → review, done, blocked, todo
blocked    → todo, inProgress, backlog
review     → done, inProgress, todo
done       → archived, todo, inProgress
archived   → done, todo
```

**Key constraints:**
- `backlog` can only move to `todo` (must be triaged first)
- `todo` cannot go directly to `review` (must pass through `inProgress`)
- `review` cannot go to `blocked` (send back to `inProgress` or `todo` first)
- Moving to `done` requires at least one log entry (agents must document their work)
- Workflow tasks cannot be moved to `done` directly — the workflow engine manages completion via `bakin_exec_submit_step`

## Architecture

### Server-Side Files

| File | Purpose |
|------|---------|
| `plugins/tasks/index.ts` | Plugin entry: registers 12 API routes + 11 exec tools + 9 hooks + archival |
| `src/core/task-store.ts` | Core task service layer: CRUD, transitions, reorder, archive |
| `packages/core/src/tasks/store.ts` | Bakin-owned task metadata store |
| `plugins/tasks/lib/ids.ts` | Task ID generation (crypto-safe) |
| `plugins/tasks/types.ts` | TypeScript interfaces (Task, TaskColumns, TaskBoard, ColumnId) |
| `plugins/tasks/constants.ts` | Column config, header maps, status dot colors, badge styles |
| `src/lib/taskboard.ts` | Re-export shim (delegates to task-store) |
| `src/core/task-service.ts` | Service layer: wraps mutations with side effects (audit, SSE, workflow guards, continuation) |
| `src/core/dispatch.ts` | Task dispatch engine (auto-assigns todo tasks to agents) |
| `src/core/continuation.ts` | Dependent task unblocking when a task completes |

### Client-Side Files

| File | Purpose |
|------|---------|
| `plugins/tasks/client.tsx` | Client entry — calls `registerPlugin({ id: 'tasks', navItems, slots: { 'page:/tasks': KanbanBoard } })` |
| `plugins/tasks/components/kanban-board.tsx` | Main kanban view — fetches from `/api/plugins/tasks/`, re-fetches on `usePluginEvent('taskboard', …)` |
| `plugins/tasks/components/kanban-column.tsx` | Single column rendering with task cards and footer |
| `plugins/tasks/components/task-card.tsx` | Individual task card (avatar, title, status badge, log count) |
| `plugins/tasks/components/task-detail-dialog.tsx` | Slide-out drawer for viewing/editing task details |
| `plugins/tasks/components/delete-task-dialog.tsx` | Confirmation dialog for task deletion |
| `plugins/tasks/components/task-filters.tsx` | Agent avatar filter bar + status facet filter |
| `plugins/tasks/components/task-metrics.tsx` | Summary metrics row (counts by column) |
| `plugins/tasks/components/task-log-table.tsx` | Table view of tasks (alternative to kanban) |

### Drag-and-Drop (dnd-kit)

The kanban board uses the newer `@dnd-kit/react` stack:

- `@dnd-kit/react`
- `@dnd-kit/react/sortable`
- `@dnd-kit/dom`
- `@dnd-kit/helpers`

The board follows the official multi-list pattern:

- **Sortable IDs** are plain `task.id` (not composite), so tasks can move across columns.
- **Columns are droppable only.** Columns themselves are not sortable.
- **Task cards** use `useSortable({ id, group: columnId, type: 'item', feedback: 'clone' })`.
- **`handleDragOver`** applies `move(items, event)` into optimistic board state so what you see during drag is the order that will be persisted.
- **`handleDragEnd`** persists that optimistic order. Same-column drops call `/reorder`; cross-column drops call `/move` and then `/reorder` for source and target columns.

**Critical: stale-ref pitfall.** The drag source column cannot be trusted from the live drag payload at drop time because sortable data can reflect the target column after optimistic re-render. The source column is captured at drag start (`dragFromColRef`) and used during persistence.

**Filtered board caveat.** When search/agent filters are active, drag reorder operates on the visible subset first and then merges that visible order back into the full column order so hidden tasks keep their relative positions.

**Ordering.** Tasks are ordered explicitly by `task.order` (zero-indexed, contiguous within each column). Reads sort by `order ASC, updatedAt DESC`. New tasks and cross-column moves append with `order = count`; `/reorder` writes the final zero-indexed order snapshot.

**Scheduled grouping.** Tasks with future `availableAt` stay in their real
column but render at the bottom under a Scheduled divider. The board has a
Scheduled toggle that hides/shows future scheduled work without mutating task
state. Once `availableAt <= now`, the task naturally renders in the normal group.

### Real-Time Updates (SSE)

1. Every write operation in `task-store.ts` updates the Bakin task store, whose subscription calls `broadcastChange()` and fires `globalThis.__bakinBroadcast({ type: 'taskboard' })`
2. The SSE server sends this as a `type: 'taskboard'` event to all connected clients
3. The global `use-sse.ts` hook receives the `type: 'taskboard'` frame and re-emits it through the client fan-out as `emitPluginEvent({ event: 'taskboard' })` (see plugin-system.md § Client SSE fan-out)
4. `kanban-board.tsx` (and the nav-badge `use-task-summary` hook) subscribe via `usePluginEvent('taskboard', …)` and re-fetch from `/api/plugins/tasks/` on each event
5. No file watcher involved — the content watcher explicitly ignores `tasks/` (#434); task-store writes trigger SSE broadcasts directly and are the single broadcast source. The store keeps an in-memory id→path + column-bucket index (self-healing, no content cached) so `getSync`/`appendLogSync`/column counts don't walk the monthly shards.

### Store Access Pattern

```typescript
const store = createFileBakinTaskStore(getBakinPaths().tasks)
store.createSync({ title, column: 'todo', order })
store.updateSync(task.id, { column: 'inProgress', agent })
```

The core store is synchronous and file-backed. The plugin service functions keep async return types for callers that already chain `.then()` (workflow runtime, dispatch). Errors are caught and returned as `Promise.reject()` to ensure proper promise rejection.

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

## Task Store Boundary

Task metadata is owned by Bakin core, not the plugin hook registry. The shared
store lives in `src/core/task-store.ts`; the old
`plugins/tasks/lib/flow-store.ts` compatibility shim is deleted and must not be
reintroduced. Core, workflows, installed official plugins, schedule, dispatch, and task-service
call the task store directly instead of invoking `tasks.*` hooks.

Main store operations: `readTaskboard`, `createTask`, `moveTask`, `blockTask`,
`addTaskLog`, `updateTask`, `deleteTask`, `setDependency`, `clearDependency`,
`assignTask`, and `reorderTasks`.

**Note:** task identifiers accept either task ID or title where the store API
documents that fallback; ID is preferred.

## Task Service Layer

`src/core/task-service.ts` wraps task mutations with side effects. Both REST routes and MCP tool handlers call these functions to ensure consistent behavior:

| Function | Side effects |
|----------|-------------|
| `logProgress` | Workflow owner authorization → SSE broadcast → persist log entry |
| `moveTaskWithEffects` | Workflow done-guard → reopen-delete when leaving done (`reopenIfLeavingDone`) → move → completion gate → audit → Antfly index → continuation trigger → project auto-check → parent unblock |
| `blockTaskWithEffects` | Workflow owner authorization → completion guard (completed task ⇒ `{ alreadyComplete: true }`, no effects; move route maps to 409, MCP block to soft payload, #482) → block task → audit → propagate to parent (system-strict — never human-bypassed, so a done parent is skipped) |
| `syncLedgerForStoreMove` | The workflow engine's ledger-aware store move: reopen-delete on leaving done → store move → insert-if-missing completion row on landing on done |
| `backfillMissingCompletionRows` | Boot heal: synthetic completion rows for done-column tasks without one; idempotent, audited `task.completion_backfilled` |
| `createTaskWithEffects` | Auto-match workflow → create → start workflow instance → audit |
| `reportComplete` | Workflow active-task authorization → log → move to done → notify orchestrator |
| `setDependencyWithEffects` | Set dependency → audit |
| `getTaskDetails` | Read board → find task by ID |
| `triggerDispatch` | Fire-and-forget POST to `/api/dispatch` |

## Plugin Settings

Configurable via `/settings` page:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `defaultColumn` | select | `"todo"` | Which column new tasks are created in |
| `showCompleted` | boolean | `true` | Show Done and Archived columns by default |
| `autoArchiveDays` | number | `0` | Auto-archive completed tasks after N days (0 = disabled) |
| `maxInProgress` | number | `5` | Warn when too many tasks are in progress |

### Auto-Archival

When `autoArchiveDays > 0`, the plugin moves old Done tasks to Archived. `archiveOldTasks()` can permanently remove Done/Archived task JSON older than a cutoff. Runs on plugin activation and every 6 hours via `setInterval`.

## Integration Points

### Workflows Plugin
- Tasks with `workflowId` are managed by the workflow engine
- Workflow tasks cannot be moved to Done directly (done-guard in `moveTaskWithEffects`)
- Workflow progress logs and block calls are only accepted from the current workflow step owner
- Child workflow tasks use compound IDs: `parentId--stepId`
- Blocking a child task propagates the block to the parent
- Workflow completion moves the task to Done via `moveTaskWithEffects` with `skipDoneGuard: true`

### Projects Plugin
- Tasks can carry plugin-owned metadata such as `projectId`
- When a task status changes, core emits `tasks.statusChanged`; installed plugins can react to it without Bakin core naming that plugin

### Dispatch Engine
- `src/core/dispatch.ts` reads todo tasks through `src/core/task-store.ts` and assigns them to available runtime agents
- `moveTaskToInProgress` moves assigned tasks from todo to inProgress
- Agents pick up tasks via MCP tools, report progress via `logProgress`, and complete via `reportComplete`

### Schedule Plugin
- Tasks can be linked to cron jobs via `scheduleJobId`
- Scheduled jobs can auto-create tasks on their cron schedule

### Continuation System
- Tasks can declare `dependsOn: {taskId}`
- When a dependency completes (moves to done), `checkAndContinueDependents` finds and unblocks/dispatches dependent tasks

### Antfly Search

Tasks are indexed in Antfly via `ctx.search` for hybrid (semantic + full-text) search. All task statuses are indexed, not just completed ones.

**Table:** `bakin_tasks`

**Schema:**

| Field | Type | Notes |
|-------|------|-------|
| `title` | text | Task title |
| `description` | text | Task description |
| `agent` | keyword | Assigned agent |
| `created_by` | keyword | Who created the task |
| `status` | keyword | Current column (todo, inProgress, done, etc.) |
| `project_id` | keyword | Linked project ID |
| `workflow_id` | keyword | Workflow ID if workflow task |
| `log_text` | text | Concatenated log entries |
| `blocked_reason` | text | Block reason (if blocked) |
| `updated_at` | datetime | Last update timestamp |

**Indexing triggers** (all in `plugins/tasks/index.ts`):
- `ctx.search.index(id)` after: create, update, move, block, complete (both REST and MCP)
- `ctx.search.remove(id)` after: delete (both REST and MCP)
- `ctx.search.transform(id, [{op: '$set', field: 'agent', value}])` after: assign (metadata-only, skips re-embedding)

**Chunker:** enabled (`targetTokens: 200, overlapTokens: 25`) — splits long `log_text` fields.

**Reindex:** `reindex()` generator reads all tasks from all columns via `readTaskboard()`.

**Note:** the old core `indexCompletedTask()` hook is gone. All search indexing is now handled by the tasks plugin via `ctx.search`.

## Date Handling

- `localDateString()` returns `YYYY-MM-DD` using the server's local timezone (not UTC)
- Dates are set when tasks enter: `inProgress`, `review`, `done`, `archived`
- Dates are cleared when tasks enter: `blocked`
- No date is set for: `backlog`, `todo`

## Testing

Test files:
- `tests/core/task-store.test.ts` — Unit tests for the core task store service: CRUD, transitions, ordering, archival
- `tests/plugins/tasks/routes.test.ts` — Integration tests for REST API routes and MCP exec tools

Run: `bun test --isolate tests/core/task-store.test.ts tests/plugins/tasks/`
