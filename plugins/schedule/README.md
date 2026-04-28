# Schedule Plugin

Cron job scheduling through the active runtime adapter with automatic task creation. Manages recurring jobs that create tasks on the Bakin task board when they fire.

## How It Works

The schedule plugin sits between the **runtime cron adapter** and **Bakin's task board**:

1. **Runtime cron** manages timing and fires webhooks when jobs trigger
2. **Bakin sidecar** (`~/.bakin/schedule/sidecar.json`) stores metadata that the runtime cron adapter doesn't own — agent assignment, task prompts, pause state, failure tracking
3. **Bridge endpoint** receives the webhook, checks pause/skip/overlap rules, and creates a task on the board

```
Runtime cron fires   →  POST /api/plugins/schedule/bridge?secret=<hex>
                         ├── Auth: bridgeEnabled setting + shared-secret gate
                         ├── Check: paused? skip? overlap? failure limit?
                         ├── Create task on board (via task-service)
                         └── Update sidecar (lastTaskId, failure count, etc.)
```

### Bridge Authentication

The `/bridge` endpoint is gated on two things:

1. **`bridgeEnabled` setting** — set to `false` to kill-switch the bridge without deleting crons. Rejects with `503`.
2. **Shared secret** — a 32-byte hex token stored in plugin settings as `bridgeSecret`, passed as a `?secret=...` query param. Compared with `timingSafeEqual`. Rejects with `401`.

The secret is auto-generated on first access (`getOrCreateBridgeSecret`) and persisted to `~/.bakin/plugin-settings/schedule.json`. Every cron registered via `bakin_exec_schedule_create` or `POST /api/plugins/schedule/` builds its webhook URL through `buildBridgeWebhookUrl()`, which embeds the current secret — agents and UI code never see or handle it directly. `bridgeSecret` is intentionally absent from `settingsSchema` so the settings UI doesn't expose it.

## Data Model

### Merged Job

The UI always works with "merged jobs" — a combination of runtime cron data and Bakin sidecar metadata. Key fields:

| Source | Fields |
|--------|--------|
| Runtime cron | `id`, `name`, `schedule` (type/value/tz), `enabled` |
| Sidecar | `agentId`, `owner`, `taskPrompt`, `taskTitle`, `workflowId`, `paused`, `pauseUntil`, `pauseReason`, `allowOverlap`, `maxFailures`, `consecutiveFailures`, `createdAt` |
| Computed | `humanSchedule`, `nextRun`, `lastRun` |

### Schedule Sidecar

Stored at `~/.bakin/schedule/sidecar.json`. Maps job IDs to `BakinJobMeta` records. Only Bakin-created jobs have `isBakinJob: true` — runtime-only jobs appear in the list but lack Bakin metadata.

### Run History

The runtime cron adapter exposes run history. Each entry records `runId`, `timestamp`, `status` (success/failure/skipped), `duration`, and optionally the Bakin `taskId` created.

## UI Components

### Views

The schedule page (`schedule-page.tsx`) offers three calendar views plus a list:

| View | Component | Description |
|------|-----------|-------------|
| Today | `calendar-today.tsx` | Timeline of today's jobs by hour |
| Week | `calendar-weekly.tsx` | 7-day grid (6am-10pm) with job cards |
| Month | `calendar-monthly.tsx` | Monthly grid with agent dot indicators |
| List | `job-list.tsx` / `job-row.tsx` | Table with status, schedule, agent, actions |

Calendar views respect each job's `createdAt` date — jobs don't render on days before they existed. Past occurrences are visually muted (`opacity-35 saturate-[0.3]`).

### Drawers

- **Job detail** (`job-drawer.tsx`): Shows job config, run history, pause controls. Actions menu (duplicate, delete) via `BakinDrawer` actions prop.
- **Job form** (`job-form.tsx`): Create/edit/duplicate form with schedule input, agent select, advanced options (workflow, title template, overlap, max failures).

### Schedule Input

`schedule-input.tsx` accepts natural language ("every day at 9am") or raw cron ("0 9 * * *"). Debounced API call to `/api/plugins/schedule/parse-schedule` returns the parsed cron expression, human-readable description, and next 5 run times.

### Agent Badge

`agent-badge.tsx` renders agent avatars on job cards. Jobs without an agent show a system badge (shell/claw icon) instead of the agent's avatar.

## URL State

All view/filter/selection state is URL-backed for deep linking and browser navigation:

| Param | Values | Purpose |
|-------|--------|---------|
| `view` | `today`, `week`, `month`, `list` | Active calendar view |
| `q` | text | Search filter |
| `agent` | agent ID or `all` | Agent filter |
| `jobId` | job ID | Open detail drawer |
| `mode` | `create`, `edit`, `duplicate` | Open form drawer |

Transitions that open something use `router.push()` (creates history entry). Closing uses `router.replace()` (no entry — back button skips it).

## API Routes

All routes are prefixed with `/api/plugins/schedule/`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List all merged jobs |
| POST | `/` | Create a new job |
| GET | `/:jobId` | Get single job details |
| PUT | `/:jobId` | Update job fields |
| DELETE | `/:jobId` | Delete a job |
| POST | `/:jobId/pause` | Pause, resume, or skip runs |
| POST | `/:jobId/run` | Trigger immediate run |
| GET | `/:jobId/runs` | Get run history for a job |
| POST | `/parse` | Parse NL/cron schedule expression |
| POST | `/bridge?secret=<hex>` | Webhook endpoint (called by runtime cron). Requires `bridgeEnabled=true` and a matching `bridgeSecret`. See [Bridge Authentication](#bridge-authentication). |

## Exec Tools (Agent-Facing)

| Tool | Description |
|------|-------------|
| `bakin_exec_schedule_list` | List jobs, optionally filtered by agent or type |
| `bakin_exec_schedule_create` | Create a new scheduled job |
| `bakin_exec_schedule_update` | Update an existing job |
| `bakin_exec_schedule_pause` | Pause, resume, or skip runs |
| `bakin_exec_schedule_delete` | Delete a job |
| `bakin_exec_schedule_briefing` | Daily schedule summary for orchestrator briefing |

## Bridge Logic

When runtime cron fires a job, the bridge endpoint runs these checks in order:

1. **Is Bakin job?** — Skip if not managed by Bakin
2. **Paused?** — Check manual pause + `pauseUntil` auto-resume
3. **Skip count?** — Decrement `skipNextN` if active
4. **Failure limit?** — Auto-pause if `consecutiveFailures >= maxFailures`
5. **Overlap?** — If `allowOverlap: false`, skip if the previous task is still active (todo/inProgress/review/blocked)
6. **Track outcomes** — Check if last task succeeded (done/archived) or failed (blocked) to update failure counter
7. **Create task** — Title from template, assign agent (unless `requireTriage`), attach workflow

## Settings

Configurable via `/settings` page:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `maxConcurrentJobs` | number | 3 | Max jobs running simultaneously |
| `failureCooldownMs` | number | 300000 | Wait time after failure before retry |
| `maxFailures` | number | 3 | Consecutive failures before auto-pause |
| `bridgeEnabled` | boolean | true | Allow bridge to create tasks |

## Dependencies

- Bakin task store — Bridge creates tasks via `task-service` and checks task status via the shared task-store service
- **runtime cron adapter** — Provides cron CRUD, immediate runs, and run history

## File Structure

```
plugins/schedule/
  bakin-plugin.json          — Plugin manifest
  index.ts                   — Server entry (routes, exec tools, bridge)
  client.tsx                 — Client entry (nav items)
  types.ts                   — Type definitions (sidecar, runtime cron, merged, runs)
  lib/
    cron-parser.ts           — NL and raw cron parsing
    jobs-reader.ts           — Merges runtime cron jobs + sidecar metadata
    runs-reader.ts           — Reads run history from the runtime cron adapter
    sidecar.ts               — Sidecar CRUD, pause/skip/failure logic
  components/
    schedule-page.tsx         — Main page orchestrator (URL state, filters, drawers)
    calendar-today.tsx        — Today timeline view
    calendar-weekly.tsx       — Weekly grid view + JobCard + shared utilities
    calendar-monthly.tsx      — Monthly grid view
    job-list.tsx              — List/table view container
    job-row.tsx               — Single job row with inline actions
    job-drawer.tsx            — Job detail drawer
    job-form.tsx              — Create/edit/duplicate form
    schedule-input.tsx        — NL schedule parser input
    pause-controls.tsx        — Pause/resume/skip UI
    run-history.tsx           — Run history table
    agent-badge.tsx           — Agent avatar with system fallback
```
