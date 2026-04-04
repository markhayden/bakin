# Spec 08: Migrate Task Persistence to OpenClaw Task Flow

**Issues:** [#4](https://github.com/madeinwyo/bakin/issues/4), [#29](https://github.com/madeinwyo/bakin/issues/29)
**Status:** Draft
**Created:** 2026-04-03

## Summary

Replace TASKBOARD.md (markdown file parsed/serialized on every mutation) with OpenClaw's `flow_runs` SQLite table as the persistence layer for all Bakin tasks. This simultaneously solves task archival (#4) and adopts OpenClaw Task Flow (#29) in a single effort.

TASKBOARD.md is deleted entirely — not kept as a projection. The kanban UI reads from SQLite. Agents interact via MCP tools that write to SQLite. Audit trail and search (audit.jsonl, Antfly) remain unchanged.

## Why flow_runs, Not task_runs

OpenClaw has two persistence systems:

| | `task_runs` | `flow_runs` |
|---|---|---|
| Purpose | Activity ledger — records detached background work | Orchestration substrate — durable multi-step state machine |
| Created by | Automatic (cron, CLI, subagent, ACP) | Explicit (plugins / orchestrators) |
| Statuses | 3: running, succeeded, failed | 8: queued, running, waiting, succeeded, failed, timed_out, cancelled, lost |
| Custom state | No — fixed fields only | Yes — `state_json`, `wait_json` (arbitrary JSON) |
| Revision tracking | No | Yes — monotonic `revision` field |
| Lifecycle | 7-day auto-prune via `cleanup_after` | Indefinite — no auto-cleanup |
| Relationship | Child (leaf work unit) | Parent (orchestrates children via `parent_flow_id`) |

A Bakin kanban card is orchestrated work with multi-step state, gates, and dependencies. That's a flow, not a task. The agent work that happens when dispatched creates `task_run` records automatically — those are the children.

## Validated Assumptions

Tested via direct SQLite writes on 2026-04-03:

| Test | Result |
|---|---|
| Insert flow_run directly | OpenClaw sees it immediately via `openclaw tasks flow list` |
| Update status/state_json | Changes reflected instantly |
| `waiting` + `wait_json` for gates | Works — clean gate data storage |
| `waiting` + `blocked_task_id` for blocks | Works — OpenClaw audits the reference integrity |
| `openclaw tasks audit` on Bakin flows | Detects dangling references (e.g., `blocked_task_missing`) |
| Delete flow_run | Clean removal, no side effects |

## Architecture

```
┌──────────────────────────────────────┐
│  Bakin UI (kanban, detail, activity) │
│  Reads via /api/plugins/tasks/*      │
├──────────────────────────────────────┤
│  Bakin Core (task-service.ts)        │
│  Transition guards, dependencies,    │
│  continuation, audit, SSE, Antfly    │
│  Programs against TaskStore interface│
├──────────────────────────────────────┤
│  TaskStore Interface                 │
│  getAllTasks, createTask, moveTask,  │
│  addTaskLog, blockTask, archive...   │
├──────────┬───────────────────────────┤
│ OpenClaw │  (future)  │  (future)   │
│ Adapter  │  Hermes    │  Local/Test │
│ flow_runs│  Adapter   │  Adapter    │
│ SQLite   │            │             │
└──────────┴────────────┴─────────────┘
```

### Adapter Boundary

The task store is a set of functions (not a class) that encapsulate all persistence concerns. Bakin core never imports SQLite, never knows about `flow_runs`, never constructs SQL. It calls the store interface and gets `Task` objects back.

The OpenClaw adapter owns:
- How tasks are persisted (flow_runs SQLite)
- How Bakin columns map to OpenClaw's status + state_json model
- How IDs are generated and namespaced (`bakin:task:` owner_key prefix)
- How archival works (DELETE old rows)

Bakin core owns:
- Transition guards (`VALID_TRANSITIONS` state machine)
- Business logic (dependencies, continuation, workflow coupling)
- SSE broadcasting after mutations
- Audit logging (audit.jsonl + Antfly)
- MCP tool interface (agent-facing contract)

**For now, we implement only the OpenClaw adapter.** The interface is implicit in the function signatures — not a TypeScript `interface` with multiple implementations. When a second adapter is needed, extract the interface then. The function boundary makes this a mechanical refactor.

### What Goes Away
- `TASKBOARD.md` — deleted entirely
- `plugins/tasks/lib/parser.ts` — markdown parsing
- `plugins/tasks/lib/taskboard.ts` — markdown serialization, async mutex
- File watcher on TASKBOARD.md for SSE triggers
- `readContentFile('TASKBOARD.md')` / `writeContentFile('TASKBOARD.md')` calls

### What Changes
- `task-service.ts` — rewired to call TaskStore functions
- `plugins/tasks/` routes — query TaskStore instead of parsing markdown
- MCP exec tools — write via TaskStore instead of TASKBOARD.md
- SSE broadcast — triggered after each store mutation (no file watcher needed)
- Schedule bridge — creates tasks via TaskStore

### What Stays the Same
- Kanban UI components (columns, cards, drag-and-drop)
- Transition guard logic (VALID_TRANSITIONS state machine)
- Audit logging (audit.jsonl + SSE broadcast)
- Antfly indexing on task completion
- Workflow integration (workflow instances still in JSON files)
- Dependency continuation system
- Gate approval UI and logic

## Column ↔ flow_runs Mapping

### Status Mapping

| Bakin Column | `status` | Distinguishing Field |
|---|---|---|
| backlog | `queued` | `state_json.column = "backlog"` |
| todo | `queued` | `state_json.column = "todo"` |
| inProgress | `running` | — |
| review | `waiting` | `wait_json.type = "gate_approval"` |
| blocked | `waiting` | `blocked_task_id IS NOT NULL` |
| done | `succeeded` | `state_json.confirmed` is absent or false |
| confirmed | `succeeded` | `state_json.confirmed = true` |

### Reading Column from flow_run

```typescript
function getColumn(flow: FlowRunRow): TaskColumn {
  switch (flow.status) {
    case 'queued':
      return flow.stateJson.column === 'backlog' ? 'backlog' : 'todo'
    case 'running':
      return 'inProgress'
    case 'waiting':
      return flow.blockedTaskId ? 'blocked' : 'review'
    case 'succeeded':
      return flow.stateJson.confirmed ? 'confirmed' : 'done'
    case 'failed':
      return 'done' // failed tasks surface in done with error indicator
    case 'cancelled':
      return 'done' // cancelled tasks surface in done
    default:
      return 'backlog'
  }
}
```

### Writing Column to flow_run

| Move To | Set `status` | Set Other Fields |
|---|---|---|
| backlog | `queued` | `state_json.column = "backlog"`, clear `blocked_*`, `wait_json` |
| todo | `queued` | `state_json.column = "todo"`, clear `blocked_*`, `wait_json` |
| inProgress | `running` | clear `blocked_*`, `wait_json`, set `started_at` if null |
| review | `waiting` | `wait_json = { type: "gate_approval", ... }` |
| blocked | `waiting` | `blocked_task_id`, `blocked_summary` |
| done | `succeeded` | `ended_at = now`, clear `blocked_*`, `wait_json` |
| confirmed | `succeeded` | `state_json.confirmed = true` |

## state_json Schema

All Bakin-specific task metadata lives in `state_json`:

```typescript
interface BakinTaskState {
  // Identity
  title: string
  agent?: string
  description?: string
  column?: 'backlog' | 'todo'  // only meaningful when status = 'queued'

  // Relationships
  dependsOn?: string           // flow_id of dependency
  parentId?: string            // flow_id of parent (for workflow subtasks)
  createdBy?: string           // agent who created this task
  workflowId?: string          // linked workflow definition ID
  projectId?: string           // linked project ID

  // State
  confirmed?: boolean          // true when in confirmed column
  date?: string                // date entered active column (YYYY-MM-DD)

  // Log
  log?: Array<{
    timestamp: string          // ISO format
    author: string
    message: string
  }>
}
```

### wait_json Schema (for review/gate states)

```typescript
interface BakinGateWait {
  type: 'gate_approval'
  step: string                 // workflow step ID
  workflowId?: string
  approver?: string
  requestedAt: string          // ISO timestamp
}
```

## flow_run Field Usage

| flow_runs Column | Bakin Usage |
|---|---|
| `flow_id` | Task ID (8-char hex, e.g., `"fe84ac51"`) |
| `shape` | `null` |
| `sync_mode` | `'managed'` (OpenClaw default; overrides our writes) |
| `owner_key` | `'bakin:task:{flow_id}'` — namespaced for filtering |
| `requester_origin_json` | `null` |
| `controller_id` | `'bakin/tasks'` |
| `revision` | Monotonic increment on every mutation |
| `status` | Mapped from Bakin column (see table above) |
| `notify_policy` | `'silent'` (Bakin handles notifications via SSE) |
| `goal` | Task title (visible in `openclaw tasks flow list`) |
| `current_step` | Current workflow step ID if workflow-linked, else `null` |
| `blocked_task_id` | flow_id of blocking task/dependency |
| `blocked_summary` | Human-readable block reason |
| `state_json` | Full `BakinTaskState` JSON |
| `wait_json` | Gate approval data when in review, else `null` |
| `cancel_requested_at` | Set when task cancellation is initiated |
| `created_at` | Task creation timestamp (epoch ms) |
| `updated_at` | Last mutation timestamp (epoch ms) |
| `ended_at` | Set when task reaches done/confirmed/failed/cancelled |

## TaskStore Module

New module: `plugins/tasks/lib/flow-store.ts`

Replaces `taskboard.ts`. Same logical operations, backed by SQLite:

```typescript
// Core read operations
export function getAllTasks(): TaskBoard
export function getTask(flowId: string): Task | null
export function getTasksByColumn(column: TaskColumn): Task[]
export function getTasksByAgent(agent: string): Task[]

// Core write operations
export function createTask(opts: CreateTaskOpts): Task
export function moveTask(flowId: string, to: TaskColumn, from?: TaskColumn): Task
export function updateTask(flowId: string, updates: Partial<BakinTaskState>): Task
export function deleteTask(flowId: string): void
export function addTaskLog(flowId: string, entry: TaskLogEntry): Task
export function blockTask(flowId: string, reason: string, blockingTaskId?: string): Task
export function assignTask(flowId: string, agent?: string): Task
export function setDependency(flowId: string, dependsOnId: string): Task

// Archival
export function archiveOldTasks(olderThanDays: number): number
export function getArchivedCount(): number
```

These functions are synchronous (better-sqlite3's sync API). No async mutex needed — SQLite WAL mode handles concurrency.

### SQLite Access Pattern

```typescript
import Database from 'better-sqlite3'
import { join } from 'path'
import { homedir } from 'os'

const BAKIN_OWNER_PREFIX = 'bakin:task:'

function openDb(): Database.Database {
  const dbPath = join(homedir(), '.openclaw', 'flows', 'registry.sqlite')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  return db
}
```

### Archival

```typescript
export function archiveOldTasks(olderThanDays: number): number {
  const db = openDb()
  const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000)
  const result = db.prepare(`
    DELETE FROM flow_runs
    WHERE owner_key LIKE 'bakin:task:%'
    AND status IN ('succeeded', 'failed', 'cancelled')
    AND ended_at IS NOT NULL
    AND ended_at < ?
  `).run(cutoff)
  db.close()
  return result.changes
}
```

Archival is a DELETE. Historical data lives in audit.jsonl and Antfly permanently. No archive files, no archive format, no archive browser.

## SSE Integration

Today: file watcher on TASKBOARD.md triggers SSE broadcast on change.

New: explicit broadcast after every store mutation.

```typescript
// After every write operation:
broadcast({
  type: 'taskboard',
  event: 'change',
  timestamp: new Date().toISOString(),
})
```

The UI's existing SSE handler for taskboard changes continues to work — it triggers a re-fetch. The trigger source changes from file watcher to explicit call.

Remove TASKBOARD.md from the chokidar watch list in `src/core/watcher.ts`.

## Transition Guards

The `VALID_TRANSITIONS` state machine stays identical, enforced in task-service.ts before calling the store:

```typescript
const VALID_TRANSITIONS: Record<TaskColumn, TaskColumn[]> = {
  backlog:    ['todo'],
  todo:       ['inProgress', 'blocked', 'done', 'backlog'],
  inProgress: ['review', 'done', 'blocked', 'todo'],
  review:     ['done', 'inProgress', 'todo'],
  done:       ['confirmed', 'todo', 'inProgress'],
  confirmed:  ['done', 'todo'],
  blocked:    ['todo', 'inProgress', 'backlog'],
}
```

The "done requires log entries" guard also stays — checked against `state_json.log`.

## Task Plugin Settings

```typescript
settingsSchema: {
  defaultColumn:    { type: 'select', options: ['todo', 'backlog'], default: 'todo' },
  showCompleted:    { type: 'boolean', default: true },
  autoArchiveDays:  { type: 'number', default: 7, label: 'Auto-archive after (days)',
                      description: 'Delete done/confirmed tasks older than this. 0 = disabled.' },
  maxInProgress:    { type: 'number', default: 5 },
}
```

`autoArchiveDays` triggers `archiveOldTasks()` on server startup + on a 6-hour interval via `setInterval` in the tasks plugin `activate()`.

## Dependency Queries

Instead of scanning all tasks in memory, use SQLite's `json_extract`:

```sql
SELECT * FROM flow_runs
WHERE owner_key LIKE 'bakin:task:%'
AND json_extract(state_json, '$.dependsOn') = ?
AND status IN ('queued', 'running', 'waiting')
```

## Migration Plan

Single-user, single-machine deployment. Clean cutover, no shims.

### Phase 1: SQLite Adapter
1. Add `better-sqlite3` dependency
2. Create `plugins/tasks/lib/flow-store.ts`
3. Rewrite task plugin API routes to use flow-store
4. Rewrite MCP exec tools to use flow-store
5. Rewire `task-service.ts` to use flow-store
6. Add explicit SSE broadcasts after mutations
7. Remove TASKBOARD.md file watcher from `src/core/watcher.ts`
8. Add archival on startup + 6-hour interval

### Phase 2: Cleanup
1. Delete `plugins/tasks/lib/parser.ts`
2. Delete `plugins/tasks/lib/taskboard.ts`
3. Delete `~/.bakin/TASKBOARD.md`
4. Remove `contentFiles: ["TASKBOARD.md"]` from tasks plugin manifest
5. Update `getBakinPaths()` to remove TASKBOARD.md reference
6. Remove any `readContentFile` / `writeContentFile` calls for TASKBOARD

### Phase 3: Validation
1. Verify kanban UI renders from SQLite data
2. Verify MCP tools create/move/log tasks
3. Verify schedule bridge creates tasks
4. Verify workflow gates move tasks to review
5. Verify dependency continuation works
6. Verify `openclaw tasks flow list` shows Bakin tasks
7. Verify `openclaw tasks audit` reports clean
8. Verify archival deletes old tasks on schedule

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| OpenClaw upgrade changes flow_runs schema | `owner_key LIKE 'bakin:task:%'` filter isolates Bakin rows. Schema additions won't break reads. |
| OpenClaw maintenance prunes Bakin flows | No `cleanup_after` on flow_runs — maintenance doesn't auto-delete flows. Bakin owns archival. |
| SQLite contention with OpenClaw gateway | WAL mode + `busy_timeout` handles concurrent access. Tested successfully. |
| `sync_mode` override | OpenClaw overrides `mirrored` to `managed`. No functional impact — Bakin writes freely regardless. |
| `json_extract` performance | Archival keeps active set small. `owner_key` index already exists. |
| ID collision | Bakin: 8-char hex + `bakin:task:` prefix. OpenClaw: UUIDs. No collision. |

## Future Adapter Work

When a second orchestration backend is needed (e.g., Hermes), the adapter extraction is mechanical:

1. Extract `TaskStore` interface from `flow-store.ts` function signatures
2. Rename `flow-store.ts` → `openclaw-store.ts` (implements TaskStore)
3. Create `hermes-store.ts` (implements TaskStore)
4. Add adapter selection in task plugin settings or Bakin config
5. Bakin core, routes, MCP tools — zero changes (they already only call the interface)

The function-boundary design makes this a straightforward refactor without premature abstraction today.

## Open Questions

1. **Should Bakin use the `api.runtime.taskFlow` plugin seam instead of direct SQLite?** Cleaner architecturally but requires Bakin to emulate an OpenClaw plugin. Direct SQLite is pragmatic and tested. Could adopt later if OpenClaw adds REST flow CRUD.

2. **Should workflow instances also move into flow_runs?** Natural evolution (task flow spawns workflow step flows) but adds complexity. Recommend deferring.

3. **Should `failed` and `cancelled` flows get a visual treatment?** Currently map to `done` column. A red border / error icon on the card might be more useful than a separate column.
