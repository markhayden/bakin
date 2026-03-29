# Phase 5: Audit — Tasks Plugin

**Applies:** `05-audit-template.md` checklist

## Current Inventory

- **Routes (7):** `/create`, `/move`, `/delete`, `/assign`, `/log`, `/block`, `/update`
- **Exec tools:** None (core MCP tools handle task ops directly in mcp-server.ts)
- **Nav items:** Tasks (order 10), Team (order 60)
- **Client components:** 10 (kanban-board, task-card, task-detail-dialog, task-filters, task-log-table, task-metrics, etc.)
- **Cross-plugin deps:** imports `task-service` from `src/core/`

## Plugin-Specific Focus Areas

### Route Standardization
- Current routes are action-based (`/create`, `/move`) — need to add resource routes
- Add `GET /{taskId}` for individual task detail (deep linking)
- Consider `GET /list` or `GET /` for filtered task listing via API (currently tasks are parsed from TASKBOARD.md client-side)

### Exec Tools Gap
Tasks is the only core plugin with NO exec tools — all task operations are hardcoded in `mcp-server.ts` as core MCP tools (`beacon_create_task`, `beacon_move_task`, etc.). These should either:
- Stay as core tools (they're fundamental) but follow naming convention
- Be migrated to plugin-registered exec tools for consistency

Recommendation: Keep as core MCP tools since they're foundational, but rename to `bakin_*` prefix during Phase 0.

### Deep Linking
- `/tasks` page shows kanban board — clicking a task opens a dialog
- Need: `/tasks/{taskId}` route that opens directly to that task's detail view
- Task detail should be a full page (or at minimum, the dialog opens automatically from URL params)

### Drag-and-Drop
- Uses `@dnd-kit/core` and `@dnd-kit/sortable`
- Audit for: smooth animations, mobile touch support, accessibility (keyboard drag)

### Hook Provider Role
Tasks plugin is the **primary hook provider** — it defines the core hooks other plugins depend on:
- `task:create`, `task:created`, `task:completed`, `task:moved`, `task:blocked`
- Must emit these hooks from all mutation paths (routes + core MCP tools)

### Team Nav Item
Tasks plugin currently registers the Team nav item (order 60). This may belong in a separate agents/team plugin or in core navigation.

## Settings Schema
```typescript
settingsSchema: {
  autoArchiveDays: { type: 'number', default: 30, label: 'Auto-archive after (days)', description: 'Move completed tasks to archive after this many days' },
  maxInProgress: { type: 'number', default: 5, label: 'Max in-progress tasks', description: 'Warn when more than this many tasks are in progress' },
}
```
