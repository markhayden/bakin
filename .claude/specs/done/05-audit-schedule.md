# Phase 5: Audit — Schedule Plugin

**Applies:** `05-audit-template.md` checklist
**Status:** Pending

## Current Inventory

| Surface | Count | Details |
|---------|-------|---------|
| HTTP routes | 9 | `GET /jobs`, `POST /jobs`, `PUT /jobs/update`, `POST /jobs/delete`, `POST /jobs/pause`, `POST /jobs/run-now`, `GET /runs`, `POST /parse-schedule`, `POST /bridge` |
| MCP exec tools | 6 | schedule_list, schedule_create, schedule_update, schedule_pause, schedule_delete, schedule_briefing |
| Hooks registered | 0 | |
| Components | 12 | cron UI, calendar views, job cards, run history, agent badge, etc. |
| Settings schema | none | |
| Lifecycle hooks | none | |
| Tests | 0 | |

## Phase 5A Items

### Settings Schema
```typescript
settingsSchema: {
  maxConcurrentJobs: { type: 'number', default: 3, label: 'Max concurrent jobs', description: 'Maximum jobs that can run at the same time' },
  failureCooldownMs: { type: 'number', default: 300000, label: 'Failure cooldown (ms)', description: 'Wait time after failure before retrying' },
  maxFailures: { type: 'number', default: 3, label: 'Max consecutive failures', description: 'Pause job after this many consecutive failures' },
  bridgeEnabled: { type: 'boolean', default: true, label: 'Bridge enabled', description: 'Allow cron jobs to create tasks via the bridge' },
}
```

### Activity & Audit
- Replace raw `appendAudit()` call with `ctx.activity.audit()`
- Replace any `globalThis.__bakinBroadcast` with `ctx.activity.log()`
- Add audit to: create, update, delete, pause, run-now, bridge fire

### Manifest
Dependencies: `["tasks"]` — correct. Permissions: correct.

### Lifecycle Hooks
- `onReady()` — verify cron jobs are valid, log job count

## Phase 5B Items

### Route Surface Parity

| Operation | HTTP API Route | MCP Exec Tool | Agent Use Case |
|-----------|---------------|---------------|----------------|
| List jobs | `GET /jobs` | `bakin_exec_schedule_list` | Exists |
| Get job | `GET /jobs/{jobId}` | `bakin_exec_schedule_get` | **New** — agent checks specific job |
| Create job | `POST /jobs` | `bakin_exec_schedule_create` | Exists |
| Update job | `PUT /jobs/{jobId}` | `bakin_exec_schedule_update` | Exists — standardize path |
| Delete job | `DELETE /jobs/{jobId}` | `bakin_exec_schedule_delete` | Exists — standardize method |
| Pause/resume | `POST /jobs/{jobId}/pause` | `bakin_exec_schedule_pause` | Exists — standardize path |
| Run now | `POST /jobs/{jobId}/run` | `bakin_exec_schedule_run_now` | **New** — agent triggers immediate run |
| Get runs | `GET /jobs/{jobId}/runs` | — | UI query only |
| Briefing | — | `bakin_exec_schedule_briefing` | Exists (agent-only, no HTTP equivalent needed) |
| Parse schedule | `POST /parse-schedule` | — | Utility, UI-only |
| Bridge webhook | `POST /bridge` | — | Internal webhook from OpenClaw |

### Route Standardization
- `PUT /jobs/update` → `PUT /jobs/{jobId}`
- `POST /jobs/delete` → `DELETE /jobs/{jobId}`
- `POST /jobs/pause` → `POST /jobs/{jobId}/pause`
- `POST /jobs/run-now` → `POST /jobs/{jobId}/run`
- `GET /runs` → `GET /jobs/{jobId}/runs` (scope to job)

### Hook Registration
Schedule registers 0 hooks. Add:
- `schedule.listJobs` — so other plugins can query schedule state
- `schedule.getJob` — so other plugins can check specific job

### Hook Events (Notification Hooks)
- `schedule.jobFired` — `{ jobId, taskId }`
- `schedule.jobFailed` — `{ jobId, error }`

### Deep Linking
Add `src/app/schedule/[id]/page.tsx` for direct job detail + run history.
