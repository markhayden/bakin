# Phase 5: Audit — Workflows Plugin

**Applies:** `05-audit-template.md` checklist

## Current Inventory

- **Routes (11):** `/list`, `/definition`, `/step`, `/step/complete`, `/approve`, `/reject`, `/instances`, `/instance`, `/pending-gates`, `/gate-status`, `/start`
- **Exec tools:** None (step tools are core MCP tools in mcp-server.ts)
- **Nav items:** Workflows (order 15)
- **Client components:** 9 (workflow canvas using @xyflow/react, step nodes, gate approval UI, etc.)
- **Cross-plugin deps:** Dynamic imports of `tasks/taskboard`

## Plugin-Specific Focus Areas

### Route Standardization
- `/definition?name=<filename>` → `/definitions/{name}`
- `/step?taskId=<id>` → `/steps/{taskId}`
- `/instance?taskId=<id>` → `/instances/{taskId}`
- `/pending-gates` and `/gate-status?taskIds=...` are fine as query-based (they're queries, not resources)

### Deep Linking
- `/workflows` shows canvas/list — need `/workflows/{instanceId}` for direct navigation to a running instance
- Gate approval deep links: `/workflows/{instanceId}/gates/{gateName}` (useful for notification links)

### Canvas UX
- Uses `@xyflow/react` for workflow visualization
- Audit: node layout, connection rendering, zoom/pan, step status colors
- Ensure step status updates in real-time via SSE

### Step Execution Testing
Most complex plugin — needs thorough testing:
- Step execution with various skill types
- Gate checking (human approval flow)
- Parent-child context passing between steps
- Error handling when agent blocks on a step
- Workflow restart/retry after failure

### Hook Integration
- **Provides:** `workflow:step:completed`, `workflow:gate:reached`, `workflow:completed`
- **Consumes:** `task:completed` (to detect when agents finish steps)
- Replace dynamic taskboard import with hooks

### Notifications
`plugins/workflows/notifications.ts` uses the event bus — this is one of the few plugins that actually uses it. Good pattern to preserve and build on.

## Settings Schema
```typescript
settingsSchema: {
  gateTimeout: { type: 'number', default: 24, label: 'Gate timeout (hours)', description: 'Auto-reject gates not approved within this time' },
  maxConcurrentSteps: { type: 'number', default: 3, label: 'Max concurrent steps', description: 'Maximum steps running in parallel per workflow' },
  notifyOnGate: { type: 'boolean', default: true, label: 'Notify on gate', description: 'Send notification when a gate needs approval' },
}
```
