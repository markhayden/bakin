# Phase 5: Audit — Workflows Plugin

**Applies:** `05-audit-template.md` checklist
**Status:** Complete

## Current Inventory

| Surface | Count | Details |
|---------|-------|---------|
| HTTP routes | 11 | `/list`, `/definition`, `/step`, `/step/complete`, `/approve`, `/reject`, `/instances`, `/instance`, `/pending-gates`, `/gate-status`, `/start` |
| MCP exec tools | 0 | Step tools are core MCP tools in `mcp-server.ts` (bakin_get_current_step, bakin_complete_step) |
| Hooks registered | 15 | loadInstance, saveInstance, createInstance, listInstances, getCurrentStep, completeStep, approveGate, rejectGate, matchWorkflow, listDefinitions, loadDefinition, getActiveAgents, isGateNotified, markGateNotified, validateStepOutput |
| Components | 9 | xyflow canvas, step nodes, gate approval UI, etc. |
| Settings schema | none | |
| Lifecycle hooks | none | |
| Tests | 0 | |

## Phase 5A Items

### Settings Schema
```typescript
settingsSchema: {
  gateTimeout: { type: 'number', default: 24, label: 'Gate timeout (hours)', description: 'Auto-reject gates not approved within this time' },
  maxConcurrentSteps: { type: 'number', default: 3, label: 'Max concurrent steps', description: 'Maximum steps running in parallel per workflow' },
  notifyOnGate: { type: 'boolean', default: true, label: 'Notify on gate', description: 'Send notification when a gate needs approval' },
}
```

### Activity & Audit
Add `ctx.activity.audit()` to: step/complete, approve, reject, start. Add `ctx.activity.log()` for SSE feed on step transitions.

### Manifest
Fix dependencies: currently `["ajv"]` which is an npm dep. Change to `["tasks"]` — workflows invoke task hooks (getCurrentStep uses taskId, completeStep creates follow-up tasks).

### Lifecycle Hooks
- `onReady()` — log count of active workflow instances, check for stale/abandoned instances
- `onShutdown()` — log active instance count at shutdown

## Phase 5B Items

### Route Surface Parity

**Three surfaces — all must be consistent:**

| Operation | HTTP API Route | MCP Exec Tool | Agent Use Case |
|-----------|---------------|---------------|----------------|
| List definitions | `GET /definitions` | `bakin_exec_workflows_list` | Agent discovers available workflows |
| Get definition | `GET /definitions/{name}` | `bakin_exec_workflows_get_definition` | Agent reads workflow spec before starting |
| Start workflow | `POST /instances` | `bakin_exec_workflows_start` | Agent kicks off a workflow for a task |
| List instances | `GET /instances` | `bakin_exec_workflows_list_instances` | Agent checks running workflows |
| Get instance | `GET /instances/{taskId}` | `bakin_exec_workflows_get_instance` | Agent checks specific workflow state |
| Get current step | `GET /steps/{taskId}` | `bakin_exec_workflows_get_step` | **Critical** — agent needs to know what to do next |
| Complete step | `POST /steps/{taskId}/complete` | `bakin_exec_workflows_complete_step` | **Critical** — agent reports step completion |
| Approve gate | `POST /gates/{taskId}/approve` | (human-only) | Gates are human approval points |
| Reject gate | `POST /gates/{taskId}/reject` | (human-only) | Gates are human approval points |
| Pending gates | `GET /gates/pending` | — | UI query only |
| Gate status | `GET /gates/status?taskIds=...` | — | UI query only |

**MCP migration:** Core MCP tools `bakin_get_current_step` and `bakin_complete_step` in `mcp-server.ts` should migrate to plugin-registered exec tools. Additionally, agents currently have no way to:
- Discover what workflows exist (`list`)
- Start a workflow (`start`)
- Check workflow status (`get_instance`)

These are critical agent capabilities that are missing today.

### Route Standardization
- `/definition?name=X` → `GET /definitions/{name}`
- `/step?taskId=X` → `GET /steps/{taskId}`
- `/step/complete` → `POST /steps/{taskId}/complete`
- `/instance?taskId=X` → `GET /instances/{taskId}`
- `/approve` + `/reject` → `POST /gates/{taskId}/approve` / `reject`
- `/pending-gates` → `GET /gates/pending`
- `/gate-status?taskIds=...` → `GET /gates/status?taskIds=...` (keep query param, it's a batch query)

### Hook Events (Notification Hooks)
- `workflows.stepCompleted` — `{ taskId, stepName, agentId }`
- `workflows.gateReached` — `{ taskId, gateName, workflowName }`
- `workflows.completed` — `{ taskId, workflowName, success }`

### Deep Linking
- `src/app/workflows/[id]/page.tsx` — direct navigation to running workflow instance
- Gate approval deep link: `/workflows/{instanceId}?gate={gateName}` (useful for notification links)

### Canvas Components
Audit 9 xyflow components for:
- Consistent node styling (step status colors)
- Real-time updates via SSE (step transitions should animate)
- Zoom/pan/fit controls
