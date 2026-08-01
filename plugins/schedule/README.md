# Schedule Plugin

Cron job visibility and Bakin task scheduling through the active runtime adapter. The schedule page shows all runtime cron jobs, but only Bakin-owned or explicitly adopted jobs create Bakin tasks when they fire.

This README is maintainer-facing implementation notes for the first-party
Schedule plugin. User docs live at
[makinbakin.com/docs/using/schedule](https://makinbakin.com/docs/using/schedule/);
generated API, CLI, settings, and exec-tool references live under
[Reference](https://makinbakin.com/docs/reference/generated/).

## How It Works

**Bakin owns scheduling for Bakin schedules** (post-#473 — see
`.claude/knowledge/bakin-owned-scheduler.md`). Runtime cron is never in the
fire path; native runtime crons are surfaced read-only alongside.

1. **Bakin sidecar** (`~/.bakin/schedule/sidecar.json`) is the source of
   truth: the Bakin-owned `schedule` definition (`{ kind: 'cron' | 'at',
   expr }`), ownership, agent/team assignment, task prompts, pause state,
   failure tracking, and reversible native-cron snapshots.
2. **The tick scheduler** (`lib/scheduler-loop.ts`) computes due occurrences
   via the kind-aware eval in `lib/cron-eval.ts`, claims each occurrence in
   the execution ledger (`cron_fires` — the (job_id, run_id) PK is the
   exactly-once lock), and runs the shared post-claim path (pause/skip/
   overlap/failure checks → task creation).
3. **Startup catch-up** fires the single most-recent missed occurrence per
   job: within the catch-up window into `todo`, older into `blocked` triage.
4. **One-shot schedules** (`kind: 'at'`, an ISO instant) fire once through
   the same machinery, then auto-disable with `completedAt` set — the
   "Completed" state. Past instants are rejected at creation; editing a
   completed one-shot's schedule re-arms it.

```
Tick (every ~30s)  →  due occurrences (cron exprs + one-shot instants)
                       ├── ledger claim (job_id, run_id)  — exactly-once
                       ├── pause / skip-N / overlap / auto-pause checks (skips are audited)
                       ├── create task on board (via task-service)
                       └── update sidecar (lastTaskId, failure count, one-shot completedAt)
```

### Runtime vs Bakin Ownership

Schedule jobs have three user-visible states:

| State | Meaning |
|-------|---------|
| Runtime cron | Native runtime cron. Bakin lists it and can run/enable/disable/delete it, but it does not create Bakin tasks. |
| Bakin schedule | Created by Bakin. Runtime cron is the timer; Bakin creates tasks when successful runs appear. |
| Adopted | Originally native runtime cron, converted into a Bakin schedule. The original runtime cron snapshot is preserved so it can be restored. |

Adopting a runtime cron is explicit. The UI opens a conversion form, captures the original raw runtime cron, writes Bakin sidecar metadata, and updates future runtime runs to a Bakin sentinel event. Restoring native behavior writes the preserved raw cron snapshot back to the runtime and marks the job as runtime-only again.

### Bridge Authentication

The `/bridge` endpoint is gated on two things:

1. **`bridgeEnabled` setting** — set to `false` to kill-switch the bridge without deleting crons. Rejects with `503`.
2. **Shared secret** — a 32-byte hex token stored in plugin settings as `bridgeSecret`, passed as a `?secret=...` query param. Compared with `timingSafeEqual`. Rejects with `401`.

The secret is auto-generated on first access (`getOrCreateBridgeSecret`) and persisted to `~/.bakin/plugin-settings/schedule.json`. `bridgeSecret` is intentionally absent from `settingsSchema` so the settings UI doesn't expose it.

## Data Model

### Merged Job

The UI always works with "merged jobs" — a combination of runtime cron data and Bakin sidecar metadata. Key fields:

| Source | Fields |
|--------|--------|
| Runtime cron | `id`, `name`, `schedule` (type/value/tz), `enabled` |
| Runtime cron policy | `toolsAllow`, `toolsAllowMissing` |
| Sidecar | `source`, `agentId`, `owner`, `taskPrompt`, `taskTitle`, `workflowId`, `paused`, `pauseUntil`, `pauseReason`, `allowOverlap`, `maxFailures`, `consecutiveFailures`, `processedRunIds`, `originalRuntimeCron`, `createdAt` |
| Computed | `humanSchedule`, `nextRun`, `lastRun` |

### Schedule Sidecar

Stored at `~/.bakin/schedule/sidecar.json`. Maps job IDs to `BakinJobMeta` records. Only Bakin-created or adopted jobs have `isBakinJob: true` — runtime-only jobs appear in the list but do not create tasks.

### Run History

The runtime cron adapter exposes run history. Each entry records `runId`, `timestamp`, `status` (success/failure/skipped), `duration`, and optionally the Bakin `taskId` created.

## UI Components

### Views

The schedule page (`schedule-page.tsx`) offers three calendar views plus a list:

| View | Component | Description |
|------|-----------|-------------|
| Today | `calendar-today.tsx` | 24-hour timeline of today's jobs |
| Week | `calendar-weekly.tsx` | 7-day, 24-hour grid with job cards |
| Month | `calendar-monthly.tsx` | Monthly grid with agent dot indicators |
| List | `job-list.tsx` / `job-row.tsx` | Table with status, schedule, agent, actions |

Calendar views respect each job's `createdAt` date — jobs don't render on days before they existed. Past occurrences are visually muted (`opacity-35 saturate-[0.3]`).

### Drawers

- **Job detail** (`job-drawer.tsx`): Shows job config, run history, pause controls. Actions menu (duplicate, delete) via `Drawer` actions prop.
- **Job form** (`job-form.tsx`): Create/edit/duplicate form with schedule input, agent select, advanced options (workflow, title template, overlap, max failures).

Native or legacy runtime cron jobs can carry a runtime tool allowlist. When the runtime adapter reports `toolsAllow`, Schedule shows it in the detail drawer. When a non-Bakin runtime timer has no allowlist, Schedule marks it with a missing cron-tools warning so the operator can decide whether to repair the native cron policy.

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
| POST | `/:jobId/adopt` | Adopt a native runtime cron into Bakin task scheduling |
| POST | `/:jobId/restore-native` | Restore an adopted job to its original native runtime cron behavior |
| DELETE | `/:jobId` | Delete a job |
| POST | `/:jobId/pause` | Pause, resume, or skip runs |
| POST | `/:jobId/run` | Trigger immediate run |
| GET | `/:jobId/runs` | Get run history for a job |
| POST | `/parse` | Parse NL/cron schedule expression |
| POST | `/bridge?secret=<hex>` | Private webhook endpoint. Requires `bridgeEnabled=true` and a matching `bridgeSecret`. See [Bridge Authentication](#bridge-authentication). |

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

When the reconciler or bridge processes a successful runtime run, the shared task-creation path runs these checks in order:

1. **Is Bakin job?** — Skip if not managed by Bakin
2. **Already processed?** — Skip if this run ID is already recorded in `processedRunIds`
3. **Paused?** — Check manual pause + `pauseUntil` auto-resume
4. **Skip count?** — Decrement `skipNextN` if active
5. **Failure limit?** — Auto-pause if `consecutiveFailures >= maxFailures`
6. **Overlap?** — If `allowOverlap: false`, skip if the previous task is still active (todo/inProgress/review/blocked)
7. **Track outcomes** — Check if last task succeeded (done/archived) or failed (blocked) to update failure counter
8. **Create task** — Title from template, assign agent (unless `requireTriage`), attach workflow

## Runtime Cron Tool Allowlists

OpenClaw supports per-cron tool policy on native isolated agent-turn jobs through `payload.toolsAllow` (`openclaw cron add/edit --tools`). The OpenClaw runtime adapter maps that field to `CronJob.toolsAllow` so Schedule can display and audit it without shelling out to the provider CLI.

Bakin-owned schedules are different: they have no backing runtime cron at all (the Bakin tick fires them), so cron `toolsAllow` does not apply to them. Hard scoping of `bakin_exec_*` MCP tools is a separate Bakin routing-layer concern tracked outside this plugin.

Common native cron examples:

| Job shape | Typical allowlist |
|-----------|-------------------|
| Posting-only reminder | `message` |
| Script runner | `exec` |
| Content/image job | `message,image_generate` when both are required |

## Settings

Configurable via `/settings` page:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `maxConcurrentJobs` | number | 3 | Max jobs running simultaneously |
| `failureCooldownMs` | number | 300000 | Wait time after failure before retry |
| `maxFailures` | number | 3 | Consecutive failures before auto-pause |
| `bridgeEnabled` | boolean | true | Allow bridge to create tasks |
| `reconcileLookbackHours` | number | 24 | On startup, create missed scheduled tasks only for successful runtime cron runs newer than this many hours. Set to 0 to disable startup backfill. |

## Dependencies

- Bakin task store — Shared schedule run processing creates tasks via `task-service` and checks task status via the shared task-store service
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
