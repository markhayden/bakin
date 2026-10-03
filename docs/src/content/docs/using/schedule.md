---
title: Schedule
description: "Cron-driven jobs that fire tasks, agents, and workflows on a cadence. Run history, pause/resume, failure cooldown."
---

Cron for normal humans. Visible, debuggable, paused with a click. Each scheduled job spawns a real task, hands it to an agent, optionally walks them through a workflow. Set it up and get on with your day. History shows you what fired, what worked, and what didn't.

## The schedule view

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-schedule--list-view.webp" alt="The schedule view in list mode, with today/week/month calendar toggles in the header." loading="lazy">
</figure>

As close to telling the future as it gets. Four view modes from the header: **List**, **Today**, **Week**, **Month**. List is the dense table; the calendar grids lay out every job your team is about to fire. Filter by agent, search by name. Click a row to open the detail drawer (sidecar fields, run history, last failure).

## Job Management

### Create

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-schedule--job-form.webp" alt="The job form with cron expression, agent picker, task title and prompt, and optional workflow." loading="lazy">
</figure>

`+ New Job` opens a side drawer. Type the cadence in plain English ("every day at 9am", "weekdays at noon", "first of the month") and Bakin translates it into cron. Or drop in a raw cron expression if you've got one. Pick the agent who runs it — or a team, in which case Bakin routes each occurrence to the best-suited member at fire time (see [Tasks → Assign to a team](/docs/using/tasks/#assign-to-a-team)) — give the task a title and a prompt, optionally attach a workflow.

### The prompt has to be a task

A schedule fires a real task, so its prompt must be something an agent can act on. The one rule: the prompt is not empty and has more than one word. `Post the daily recipe to #kitchen` is a task prompt; `heartbeat`, `__openclaw_memory_core_short_term_promotion_dream__` and a blank field are not — those are the kind of internal marker a runtime schedules for itself, and a Bakin task built from one fails on every fire. The form refuses to submit without a task prompt, every create / update / adopt path rejects one, and the `schedule-prompts` health check catches any that slipped in earlier (see [Health checks](#health-checks)). A legitimate one-word prompt just needs a second word.

### Pause, run now, duplicate

Each row's menu has the day-to-day controls:

- `Pause` to stop a job without losing its config. Resume from the same menu when you're ready.
- `Run now` to fire the job immediately, ignoring schedule. Good for testing or backfilling.
- `Skip next` to drop just the next firing without pausing the rest.
- `Duplicate` to clone a job with all its settings, then tweak the copy.
- `Delete` when you don't need it anymore.

Same menu lives in the detail drawer for jobs you've already opened.

### Inspect run history

The detail drawer's `History` tab lists past fires with timestamps, success/failure, and the task that resulted. Useful when scheduled work looks stale or duplicated.

### Cron tool allowlists

Runtime-native cron jobs may also show a `Cron tools` field. That comes from the runtime adapter's cron allowlist, such as OpenClaw's `--tools` / `payload.toolsAllow` policy for isolated agent-turn cron jobs.

If a runtime-native or legacy cron job has no allowlist, Schedule flags it as missing cron tools. Treat that as an audit prompt, not an automatic fix: choose the smallest tool set the native job needs before changing the runtime cron.

Bakin-owned schedules are different. Bakin fires them itself and creates Bakin tasks; runtime cron is not involved. The eventual agent task's MCP permissions are not controlled by cron `toolsAllow`; that belongs to Bakin MCP tool scoping.

## How it works

Bakin owns its schedules end to end. Nothing about a Bakin schedule depends on which runtime is active.

- **Bakin owns the schedule.** The cron expression (or one-shot instant), timezone, enabled state, agent or team, task title and prompt, workflow link, and pause/failure state all live in `~/.bakin/schedule/sidecar.json`.
- **Bakin fires it.** A scheduler tick (every 30 seconds by default) computes which occurrences are due, claims each one in the execution ledger, and on a fresh claim creates the task, optionally starts the workflow, and dispatches to the assigned agent. The ledger claim is what makes every occurrence fire exactly once, through restarts and across runtime switches.
- **Downtime is handled honestly.** After an outage, the single most recent missed occurrence per job fires normally if it falls inside the missed-fire safety window; an older one lands in Blocked for you to triage, labeled by the date it should have run.

The crons a runtime or its agents create for themselves (OpenClaw's native cron, for example) show up in the same list, read-only. Pausing, editing or deleting one from Bakin is refused until you **adopt** it — adoption copies its cadence into a Bakin schedule and removes the native cron so it has exactly one fire path. `Restore native` puts it back.

## Migrating between runtimes

Bakin schedules survive a runtime switch untouched: the sidecar and the ledger belong to Bakin, so `bakin runtime use pi` (or back to OpenClaw) changes nothing about when or whether they fire.

Native cron jobs are a different story — they belong to the runtime you are leaving. Pass `--adopt-cron` to `bakin runtime use` (or tick the option on the Runtime page) and Bakin turns each native job into a Bakin schedule before the old runtime is torn down. The switch report prints one line per source job:

```
✓ adopt  Daily recipe (native-daily)
○ skip   Weekly digest (sch_…) — already a Bakin schedule
✗ refuse heartbeat — not a task prompt; stays native (command: heartbeat)
✗ refuse dream — not a task prompt; stays native (command: __openclaw_memory_core_short_term_promotion_dream__)
```

A native job whose command is not a task prompt is **refused**, not adopted: it is the runtime's own internal marker, and a Bakin task built from it would fail every time. Refused jobs stay native. `--dry-run` shows the same per-job listing without writing anything, so you can see what a switch would adopt and refuse before committing to it.

Switching back to OpenClaw runs the cutover automatically: any adopted schedule whose native cron still exists has that native cron removed, so the job keeps firing once, from Bakin.

## Failure handling

Each job tracks consecutive failures. Past `maxFailures`, the job auto-pauses with a cooldown so a broken job doesn't fire indefinitely. Resume from the row menu once you've fixed the underlying issue.

## Health checks

Schedule contributes three checks to [Health](/docs/using/health/):

- **Bakin schedules cut over from runtime cron** (`schedule-cutover`) flags a Bakin schedule that still has a duplicate native cron fire path. Its repair completes the cutover.
- **Runtime cron jobs tracked in Bakin sidecar** (`schedule-sync`) flags native crons with a real task prompt that Bakin does not know about, and offers to track them for triage. The runtime's own marker jobs are reported as runtime-internal and left alone.
- **Bakin schedules carry a runnable prompt** (`schedule-prompts`) raises one action-required incident per Bakin schedule whose prompt is not a task prompt. Its **Remove job** repair is destructive, so it arrives as an approval task on the board: the task names exactly the jobs it will remove, and approving it removes those jobs and nothing else.

## Where jobs live

```
~/.bakin/schedule/
  sidecar.json           # every Bakin schedule: cadence, tz, owner, prompt, state
~/.bakin/bakin.db        # execution ledger: one row per fired occurrence (run history)
```

Native runtime crons live in the runtime home. Bakin reads them; the runtime writes them.

## Settings

<!-- docs:settings schedule -->
<div class="settings-table">

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| Max consecutive failures | `number` | `3` | Pause job after this many consecutive failures |
| Scheduler tick interval (seconds) | `number` | `30` | How often the scheduler checks for due schedules. Floor-clamped to 5s. |
| Missed-fire safety window (minutes) | `number` | `60` | After downtime, a missed run fires normally if within this window; older runs land in Blocked for you to triage. Larger = more tolerant. |

</div>
<!-- /docs:settings -->

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 11 12 5 17"/><line x1="13" y1="17" x2="19" y2="17"/></svg>From the CLI

Same surface from the terminal:

<!-- docs:cli-commands schedule -->
| Command | Purpose |
| --- | --- |
| `bakin schedule [list\|add\|pause\|resume\|remove\|run\|runs] ...` | Manage scheduled jobs. |
<!-- /docs:cli-commands -->

Full surface in the [CLI reference](/docs/reference/generated/cli/).

HTTP API surface for this plugin: see the [API reference](/docs/reference/generated/api/#schedule).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents can list, create, pause, run, and parse cron through MCP exec tools.

<!-- docs:exec-tools schedule -->
- `bakin_exec_schedule_briefing`: Today's schedule summary — which jobs fire, assigned agents, alerts. Designed for orchestrator daily briefing.
- `bakin_exec_schedule_create`: Create a new scheduled job that creates tasks on the board
- `bakin_exec_schedule_delete`: Delete a scheduled job
- `bakin_exec_schedule_get`: Get details for a single scheduled job
- `bakin_exec_schedule_list`: List all scheduled jobs (merged runtime cron + Bakin view)
- `bakin_exec_schedule_parse`: Parse a natural language or raw cron schedule expression
- `bakin_exec_schedule_pause`: Pause, resume, or skip runs for a scheduled job
- `bakin_exec_schedule_run_now`: Trigger an immediate run of a scheduled job
- `bakin_exec_schedule_runs`: Get run history for a scheduled job
- `bakin_exec_schedule_update`: Update an existing scheduled job
<!-- /docs:exec-tools -->

Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Tasks](/docs/using/tasks/): every fired job creates a task here
- [Workflows](/docs/using/workflows/): optional workflow attached to a job
- [Team](/docs/using/team/): the agent picker pulls from here
