# Tasks Plugin — Deep Reference

## Overview

The Tasks plugin provides a kanban-style task management system backed by a single markdown file (`~/.bakin/TASKBOARD.md`). Tasks are organized into 7 columns with enforced state transitions, assigned to agents, and tracked with timestamped log entries. The plugin integrates with workflows (gated multi-step pipelines), projects (checklist auto-check), and the dispatch engine (auto-assignment to agents).

**Plugin ID:** `tasks`
**Dependencies:** none (other plugins depend on it)
**Permissions:** `storage.read`, `storage.write`, `events.emit`
**Content files:** `TASKBOARD.md`

## Data Model

### Task

```typescript
interface Task {
  id: string              // 8-char hex (e.g., "a1b2c3d4") or compound "parentId--stepId"
  title: string
  agent?: string           // assigned agent ID (e.g., "pixel", "rolo")
  createdBy?: string       // agent that created the task
  checked: boolean         // true when in done or confirmed columns
  date?: string            // YYYY-MM-DD, set when entering inProgress/review/done/confirmed
  blockedReason?: string   // reason string when in blocked column
  description?: string     // multi-line task description
  log?: TaskLogEntry[]     // timestamped progress entries
  dependsOn?: string       // task ID this task depends on
  parentId?: string        // parent task ID for sub-tasks
  workflowId?: string      // linked workflow definition ID
  scheduleJobId?: string   // linked schedule job ID
  projectId?: string       // linked project ID
}
```

### TaskLogEntry

```typescript
interface TaskLogEntry {
  timestamp: string  // ISO 8601 (e.g., "2026-03-30T14:30:00.000Z")
  author: string     // agent ID or "system"
  message: string    // progress message
}
```

### Task ID Generation

IDs are 8-character hex strings generated from 4 random bytes via `crypto.getRandomValues()` (with `Math.random()` fallback). Compound IDs use the format `parentId--stepId` for workflow child tasks.

**File:** `plugins/tasks/ids.ts`

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

### Concurrency Control

All taskboard mutations are serialized through an async mutex (`withTaskboardLock`). This prevents concurrent read-modify-write races on `TASKBOARD.md`. The lock is a simple promise chain — each mutation waits for the previous one to complete.

## Markdown Format

`TASKBOARD.md` is the single source of truth. Format:

```markdown
# Task Board
_Last updated: 03/30/2026, 14:30 MDT_

## 📦 Backlog
- [ ] [a1b2c3d4] Task title @agent — 2026-03-30
  createdBy: roscoe
  dependsOn: e5f6g7h8
  workflow: content-pipeline
  projectId: proj-abc
  Description line 1
  Description line 2
  [2026-03-30T14:00:00.000Z pixel] Started research
  [2026-03-30T14:30:00.000Z pixel] Completed draft

## 🔵 In Progress
...

## 📋 Todo
...

## 🔍 Review
...

## ✅ Done
- [x] [e5f6g7h8] Completed task @rolo — 2026-03-29

## 🟣 Confirmed
...

## 🔴 Blocked
- [ ] [i9j0k1l2] Blocked task @basil — BLOCKED: Waiting for API access
```

**Parser:** `plugins/tasks/parser.ts` — Pure function, no fs/node dependencies, safe for client components. Handles all metadata lines (createdBy, dependsOn, workflow, projectId), log entries, and description text.

**Serializer:** `plugins/tasks/taskboard.ts:serializeTaskboard()` — Writes columns in fixed order: backlog, inProgress, todo, review, done, confirmed, blocked. Updates the "Last updated" timestamp on every write.

## Architecture

### Server-Side Files

| File | Purpose |
|------|---------|
| `plugins/tasks/index.ts` | Plugin entry: registers 7 API routes + 9 hooks + file watcher |
| `plugins/tasks/taskboard.ts` | Core mutations: create, move, block, update, delete, assign, dependencies, reorder |
| `plugins/tasks/parser.ts` | Markdown → TaskBoard parser (pure, client-safe) |
| `plugins/tasks/ids.ts` | Task ID generation (crypto-safe) |
| `plugins/tasks/types.ts` | TypeScript interfaces (Task, TaskColumns, TaskBoard, ColumnId) |
| `plugins/tasks/constants.ts` | Column config, header maps, status dot colors, badge styles |
| `src/core/task-service.ts` | Service layer: wraps mutations with side effects (audit, SSE, workflow guards, continuation) |
| `src/core/dispatch.ts` | Task dispatch engine (auto-assigns todo tasks to agents) |
| `src/core/continuation.ts` | Dependent task unblocking when a task completes |

### Client-Side Files

| File | Purpose |
|------|---------|
| `plugins/tasks/client.tsx` | Nav items export (Tasks + Team) |
| `plugins/tasks/components/kanban-board.tsx` | Main kanban view with columns, drag-and-drop, metrics, filters |
| `plugins/tasks/components/kanban-column.tsx` | Single column rendering with task cards and footer |
| `plugins/tasks/components/task-card.tsx` | Individual task card (avatar, title, status badge, log count) |
| `plugins/tasks/components/task-detail-dialog.tsx` | Slide-out drawer for viewing/editing task details |
| `plugins/tasks/components/new-task-dialog.tsx` | Dialog for creating new tasks |
| `plugins/tasks/components/delete-task-dialog.tsx` | Confirmation dialog for task deletion |
| `plugins/tasks/components/task-filters.tsx` | Agent avatar filter bar + status facet filter |
| `plugins/tasks/components/task-metrics.tsx` | Summary metrics row (counts by column) |
| `plugins/tasks/components/task-log-table.tsx` | Table view of tasks (alternative to kanban) |

## API Routes

All routes are registered at `/api/plugins/tasks/{path}` via the plugin route system.

### POST /api/plugins/tasks/create

Create a new task.

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `title` | string | yes | — |
| `description` | string | no | — |
| `column` | string | no | `"todo"` |
| `assignee` | string | no | — |
| `workflowId` | string | no | — |
| `createdBy` | string | no | — |

**Response:** `{ ok: true, id: "a1b2c3d4" }`

### POST /api/plugins/tasks/move

Move a task between columns. Uses `moveTaskWithEffects` which includes workflow done-guard, audit logging, continuation triggers, and Antfly indexing.

| Field | Type | Required |
|-------|------|----------|
| `id` or `title` | string | yes (one of) |
| `to` | string | yes |
| `from` | string | no |
| `agent` | string | yes |

**Errors:** 403 if workflow task moved to done directly. 500 for invalid transitions.

### POST /api/plugins/tasks/delete

Delete a task. Also cancels any active workflow instances.

| Field | Type | Required |
|-------|------|----------|
| `id` or `title` | string | yes (one of) |

### POST /api/plugins/tasks/assign

Assign or unassign an agent.

| Field | Type | Required |
|-------|------|----------|
| `id` or `title` | string | yes (one of) |
| `agent` | string | no (empty string unassigns) |

### POST /api/plugins/tasks/log

Add a progress log entry. Uses `logProgress` from task-service which broadcasts to SSE first, then persists.

| Field | Type | Required |
|-------|------|----------|
| `id` or `title` | string | yes (one of) |
| `message` | string | yes |
| `author` | string | no | defaults to `"system"` |

### POST /api/plugins/tasks/block

Block a task with a reason. Uses `blockTaskWithEffects` which propagates blocks to parent tasks for child workflow tasks.

| Field | Type | Required |
|-------|------|----------|
| `id` or `title` | string | yes (one of) |
| `reason` | string | yes |
| `agent` | string | no |

### POST /api/plugins/tasks/update

Update task fields (title, description, agent, column, workflowId). Column changes go through transition validation.

| Field | Type | Required |
|-------|------|----------|
| `id` or `originalTitle` | string | yes (one of) |
| `title` | string | no |
| `description` | string | no |
| `agent` | string | no |
| `column` | ColumnId | no |
| `workflowId` | string | no |

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

`src/core/task-service.ts` wraps raw taskboard mutations with side effects. Both REST routes and MCP tool handlers call these functions to ensure consistent behavior:

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

## Integration Points

### Workflows Plugin
- Tasks with `workflowId` are managed by the workflow engine
- Workflow tasks cannot be moved to Done directly (done-guard in `moveTaskWithEffects`)
- Child workflow tasks use compound IDs: `parentId--stepId`
- Blocking a child task propagates the block to the parent
- Unblocking a child auto-unblocks the parent if it was blocked by that child
- Workflow completion moves the task to Done via `moveTaskWithEffects` with `skipDoneGuard: true`

### Projects Plugin
- Tasks can be linked to projects via `projectId`
- When a task moves to done or confirmed, `projects.autoCheckLinkedItem` hook is invoked to check off the corresponding project checklist item

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

### SSE Real-Time Updates
- All task mutations broadcast to connected browsers via SSE
- Activity feed shows live progress messages from agents
- File watcher on `TASKBOARD.md` triggers UI refresh on external changes

## Date Handling

- `localDateString()` returns `YYYY-MM-DD` using the server's local timezone (not UTC)
- This prevents the date appearing as "yesterday" when the server is behind UTC at midnight
- Dates are set when tasks enter: `inProgress`, `review`, `done`, `confirmed`
- Dates are cleared when tasks enter: `blocked`
- No date is set for: `backlog`, `todo`

## Testing

Test files:
- `tests/plugins/tasks/taskboard.test.ts` — 34 tests covering transitions, mutations, date handling, serialization
- `tests/plugins/tasks/parser.test.ts` — 12 tests covering markdown parsing, metadata extraction, edge cases

Run: `npx vitest run tests/plugins/tasks/`
