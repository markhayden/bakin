# Phase 5: Audit — Schedule Plugin

**Applies:** `05-audit-template.md` checklist

## Current Inventory

- **Routes (9):** `GET /jobs`, `POST /jobs`, `PUT /jobs/update`, `POST /jobs/delete`, `POST /jobs/pause`, `POST /jobs/run-now`, `GET /runs`, `POST /parse-schedule`, `POST /bridge`
- **Exec tools (6):** `beacon_exec_schedule_list`, `_create`, `_update`, `_pause`, `_delete`, `_briefing`
- **Nav items:** Schedule (AlarmClock, order 22)
- **Client components:** 12 (cron UI, calendar views, job cards, run history, agent badge, etc.)
- **Cross-plugin deps:** `task-service` (createTaskWithEffects), `audit` (appendAudit), `content-dir`, dynamic imports of `tasks/taskboard`

## Plugin-Specific Focus Areas

### Route Standardization
- `GET /jobs` → fine
- `PUT /jobs/update` → `PUT /jobs/{jobId}`
- `POST /jobs/delete` → `DELETE /jobs/{jobId}`
- `POST /jobs/pause` → `POST /jobs/{jobId}/pause`
- `POST /jobs/run-now` → `POST /jobs/{jobId}/run`
- `GET /runs` → `GET /jobs/{jobId}/runs` (scoped to job)

### Deep Linking
- `/schedule` shows job list — need `/schedule/{jobId}` for direct job detail
- Run history for a specific job: `/schedule/{jobId}/runs`

### Bridge Pattern (Key Architecture)
The `/bridge` route is the OpenClaw webhook handler — cron fires → webhook → bridge creates task. This is the **primary example of cross-plugin interaction** and needs to migrate from direct imports to hooks:
- Replace `import { createTaskWithEffects }` → `ctx.hooks.call('task:create', { ... })`
- Replace `import { readTaskboard }` → `ctx.hooks.call('task:query', { ... })` or keep as read-only import

### Job History UI
- `GET /runs` returns run history — needs better UI
- Show: timestamp, status (success/fail/skipped), task created (link), duration
- Filter by job, date range, status
- Failure alerting: highlight failed runs, show error details

### Failure Handling
Schedule already has failure counting and cooldown — audit for:
- Clear display of failure count per job
- Alert when failure threshold reached
- Easy retry mechanism
- Overlap prevention (don't fire if previous run still active)

### Hook Integration
- **Provides:** `schedule:job:fired`, `schedule:job:failed`
- **Consumes:** `task:completed` (to record run success), `task:blocked` (to record run issues)
- Major migration: bridge function must use hooks instead of direct task-service import

### Activity Reporting
Schedule currently broadcasts directly via `globalThis.__beaconBroadcast`. Replace with `ctx.activity.log()` and `ctx.activity.audit()`.

## Settings Schema
```typescript
settingsSchema: {
  maxConcurrentJobs: { type: 'number', default: 3, label: 'Max concurrent jobs', description: 'Maximum jobs that can run at the same time' },
  failureCooldownMs: { type: 'number', default: 300000, label: 'Failure cooldown (ms)', description: 'Wait time after failure before retrying' },
  maxFailures: { type: 'number', default: 3, label: 'Max consecutive failures', description: 'Pause job after this many consecutive failures' },
  bridgeEnabled: { type: 'boolean', default: true, label: 'Bridge enabled', description: 'Allow cron jobs to create tasks via the bridge' },
}
```
