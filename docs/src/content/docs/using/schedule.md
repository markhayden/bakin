---
title: Schedule
description: "Cron-driven jobs that fire tasks, agents, and workflows on a cadence. Run history, pause/resume, failure cooldown."
---

Schedule is how recurring work gets created in Bakin. Cron expressions or "every N minutes" intervals fire jobs that spawn real tasks, optionally start workflows, and assign them to agents. Pause anything that's wrong without deleting it. Watch history to spot drift.

## The schedule view

<figure class="screenshot-frame">
  <figcaption>The schedule view in list mode, with today/week/month calendar toggles in the header.</figcaption>
</figure>

Four view modes from the header: **List**, **Today**, **Week**, **Month**. List is the dense table; the others are calendar grids. Filter by agent, search by name. Click a row to open the detail drawer (sidecar fields, run history, last failure).

## Common actions

### Create a job

<figure class="screenshot-frame">
  <figcaption>The job form with cron expression, agent picker, task title and prompt, and optional workflow.</figcaption>
</figure>

`+ New Job` opens a side drawer. Required: cron expression (or `every`/`at` shorthand), an agent, a task title, and the task prompt. Optional: attach a workflow that fires when the bridge fires.

### Pause, resume, run now, skip next

Each row has a menu for pause/resume, run-now, skip-next, duplicate, and delete. Same actions live in the detail drawer.

### Inspect run history

The detail drawer's **History** tab lists past fires with timestamps, success/failure, and the task that resulted. Useful when scheduled work looks stale or duplicated.

## How it works

Schedule splits ownership cleanly between OpenClaw and Bakin.

- **OpenClaw owns the cron itself.** The actual cron daemon, expressions, and run logs live in the OpenClaw home directory. Bakin shells out to `openclaw cron add/edit/remove/run` to change them.
- **Bakin owns sidecar metadata.** Display name, owner, agent assignment, task title and prompt, workflow link, owner, and pause/failure state live in `~/.bakin/schedule/sidecar.json`.

When a cron fires, OpenClaw POSTs the **bridge endpoint** (`/api/plugins/schedule/bridge`) with an HMAC-signed payload. Bakin verifies the signature, creates a real task, optionally starts a workflow, and dispatches the work to the assigned agent. The bridge secret auto-generates on first use.

## Failure handling

Each job tracks consecutive failures. Past `maxFailures`, the job auto-pauses with a cooldown so a broken job doesn't fire indefinitely. Resume from the row menu once you've fixed the underlying issue.

## Where jobs live

```
~/.bakin/schedule/
  sidecar.json           # per-job display + ownership metadata
```

Cron expressions and run logs are in the OpenClaw home. Bakin reads them; OpenClaw writes them.

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 11 12 5 17"/><line x1="13" y1="17" x2="19" y2="17"/></svg>From the CLI

Same surface from the terminal:

<!-- docs:cli-commands schedule -->
| Command | Purpose |
| --- | --- |
| `bakin schedule [list|add|pause|resume|remove|run|runs] ...` | Manage scheduled jobs. |
<!-- /docs:cli-commands -->

Full surface in the [CLI reference](/docs/reference/generated/cli/).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents can list, create, pause, run, and parse cron through MCP exec tools.

<!-- docs:exec-tools schedule -->
- `bakin_exec_schedule_briefing`: Today
- `bakin_exec_schedule_create`: Create a new scheduled job that creates tasks on the board
- `bakin_exec_schedule_delete`: Delete a scheduled job
- `bakin_exec_schedule_get`: Get details for a single scheduled job
- `bakin_exec_schedule_list`: List all scheduled jobs (merged OpenClaw + Bakin view)
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
