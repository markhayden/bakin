# Phase 5: Audit — Tasks Plugin

**Applies:** `05-audit-template.md` checklist
**Status:** Pending

## Current Inventory

| Surface | Count | Details |
|---------|-------|---------|
| HTTP routes | 7 | `/create`, `/move`, `/delete`, `/assign`, `/log`, `/block`, `/update` |
| MCP exec tools | 0 | All task ops are hardcoded in `mcp-server.ts` as core MCP tools |
| Hooks registered | 9 | readTaskboard, createTask, moveTask, blockTask, addTaskLog, updateTask, deleteTask, setDependency, clearDependency |
| Components | 9 | kanban-board, task-card, task-detail-dialog, task-filters, task-log-table, task-metrics, etc. |
| Settings schema | none | |
| Lifecycle hooks | none | |
| Tests | 0 | |

## Phase 5A Items

### Settings Schema
```typescript
settingsSchema: {
  autoArchiveDays: { type: 'number', default: 30, label: 'Auto-archive after (days)', description: 'Move completed tasks to archive after this many days' },
  maxInProgress: { type: 'number', default: 5, label: 'Max in-progress tasks', description: 'Warn when more than this many tasks are in progress' },
}
```

### Activity & Audit
Add `ctx.activity.audit()` to all 7 mutation routes (create, move, delete, assign, log, block, update).

### Manifest
Dependencies: none (tasks is foundational). Permissions: correct as-is.

## Phase 5B Items

### Route Surface Parity

**Current state:** Task operations exist in THREE places with inconsistent coverage:
1. Core MCP tools in `mcp-server.ts` (`beacon_create_task`, `beacon_move_task`, etc.) — used by agents
2. Plugin HTTP routes (7 action routes) — used by frontend
3. `task-service.ts` mutations — used by core modules

**Target state:**

| Operation | HTTP API Route | MCP Exec Tool | Notes |
|-----------|---------------|---------------|-------|
| List/read | `GET /` | `bakin_exec_tasks_list` | New. Return filtered task board |
| Get one | `GET /{taskId}` | `bakin_exec_tasks_get` | New. Single task detail |
| Create | `POST /` | `bakin_exec_tasks_create` | Existing core MCP tool → migrate to plugin exec tool |
| Move | `POST /{taskId}/move` | `bakin_exec_tasks_move` | Existing core MCP tool → migrate to plugin exec tool |
| Update | `PUT /{taskId}` | `bakin_exec_tasks_update` | Existing route, standardize path |
| Delete | `DELETE /{taskId}` | `bakin_exec_tasks_delete` | Existing route, standardize method |
| Assign | `POST /{taskId}/assign` | `bakin_exec_tasks_assign` | Existing route, standardize path |
| Block | `POST /{taskId}/block` | `bakin_exec_tasks_block` | Existing route, standardize path |
| Add log | `POST /{taskId}/log` | `bakin_exec_tasks_log` | Existing route, standardize path |
| Set dep | `POST /{taskId}/depend` | `bakin_exec_tasks_set_dependency` | New |
| Clear dep | `DELETE /{taskId}/depend` | `bakin_exec_tasks_clear_dependency` | New |

**MCP migration decision:** The core MCP tools (`beacon_create_task`, etc.) in `mcp-server.ts` should be migrated to plugin-registered exec tools. This is the natural completion of Phase 4's decoupling — task operations should be owned by the tasks plugin, not hardcoded in core.

### Hook Events (Notification Hooks)
Emit from mutation routes so other plugins can react:
- `tasks.created` — after task creation
- `tasks.moved` — after column change (include `{ taskId, from, to }`)
- `tasks.completed` — special case of moved to Done
- `tasks.blocked` — after task blocked
- `tasks.deleted` — after task deletion

### Team Nav Item
Tasks currently registers Team nav (order 60). Evaluate: should this stay here or move to core? Team/agents is a cross-cutting concern. Decision: keep for now, revisit if an agents plugin is created.

### Deep Linking
Add `src/app/tasks/[id]/page.tsx` that opens task detail view directly.
