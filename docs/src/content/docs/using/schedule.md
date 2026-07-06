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

`+ New Job` opens a side drawer. Type the cadence in plain English ("every day at 9am", "weekdays at noon", "first of the month") and Bakin translates it into cron. Or drop in a raw cron expression if you've got one. Pick the agent who runs it — or a team, in which case Bakin routes each occurrence to the best-suited member at fire time (see [Tasks → Assign to a team](/using/tasks/#assign-to-a-team)) — give the task a title and a prompt, optionally attach a workflow.

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

Bakin-owned schedules are different. They use runtime cron as a timer, then create Bakin tasks. The eventual agent task's MCP permissions are not controlled by cron `toolsAllow`; that belongs to Bakin MCP tool scoping.

## How it works

Schedule splits ownership: the runtime owns the cron, Bakin owns everything around it.

- **The runtime owns the cron itself.** The actual cron daemon, expressions, and run logs live in the runtime home directory. Bakin asks the runtime adapter to add, edit, remove, or fire them.
- **Bakin owns sidecar metadata.** Display name, owner, agent assignment, task title and prompt, workflow link, and pause/failure state live in `~/.bakin/schedule/sidecar.json`.

When a cron fires, the runtime records a run. While Bakin is running, Schedule polls runtime run history, reconciles each new successful run, creates a real task, optionally starts a workflow, and dispatches the work to the assigned agent. The bridge endpoint still exists for runtimes that deliver signed webhook callbacks, but OpenClaw schedules use the reconciler path.

## Failure handling

Each job tracks consecutive failures. Past `maxFailures`, the job auto-pauses with a cooldown so a broken job doesn't fire indefinitely. Resume from the row menu once you've fixed the underlying issue.

## Where jobs live

```
~/.bakin/schedule/
  sidecar.json           # per-job display + ownership metadata
```

Cron expressions and run logs live in the runtime home. Bakin reads them; the runtime writes them.

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
