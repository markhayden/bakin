---
title: Tasks
description: Track agent work on a kanban board with assignment, dependencies, and activity logs.
lastUpdated: 2026-04-25
---

:::note[Most of this happens on its own]
This page walks through the manual controls. In practice, runtime agents handle most of it: creating tasks, moving them through columns, logging progress, linking dependencies, completing work. You're here to set the rules and step in when something needs a human.
:::

Tasks are Bakin's work unit. Each one records what needs to happen, who owns it, what column it's in, and the full activity log behind it. Everything worth seeing, auditing, or handing off to a teammate lives here.

## Bakin Board

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-tasks--board.webp" alt="The Bakin Board with seven columns: Backlog, Todo, Blocked, In Progress, Review, Done, Archived." loading="lazy">
</figure>

The board is the home view. Each column is a state, each card is a task. Drag cards between columns to move work forward. Click a card to open its detail panel and see the full history.

## Task Management

### Create a task

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-tasks--new-task-dialog.webp" alt="New-task dialog with title, owner, and optional workflow fields." loading="lazy">
</figure>

Hit `+ New Task` in the top right of the board. Give it a title, pick an owner (an agent or yourself), and optionally attach a workflow. Workflows tell the assigned agent what kind of work this is.

### Assign to a team

The assignee picker also lists your teams (from the Team page). Assign a task to a team and Bakin picks the best-suited member at dispatch time: a small routing model reads the task against each member's role and profile and records its pick — and why — in the task's activity log. The card shows a team chip until the pick lands, then the chosen agent's avatar alongside it.

The routing call runs through your agent runtime — no separate API key needed. Pick its model with the `team-routing` row under Models → Routing; with no route set it uses your main agent's default model. If routing can't complete (the team no longer exists, has no members on the roster, or the runtime has no usable credentials), team tasks move to `Blocked` with a clear reason instead of guessing — the doctor's `team.routing` check will point at it. Re-assigning a resolved task to a different agent or team resets the routing; scheduled jobs can also target a team, and each occurrence is routed fresh. Workflow steps can target a team too — pick one in the step's agent dropdown and the step routes the same way at dispatch, keeping its pick across retries.

### Edit task details

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-tasks--task-detail.webp" alt="Task detail panel showing fields, dependencies, and the activity log." loading="lazy">
</figure>

Click any card to open the detail panel. From here you can change the title, owner, column, dependencies, and append to the activity log. The log captures every state change and any progress notes from agents. It's the audit trail that survives outside chat history.

### Move tasks between columns

Drag a card to a new column, or use the column dropdown in the detail panel. Tasks can only move along allowed transitions. See [Columns and transitions](#columns-and-transitions) below.

### Block and unblock

When a task can't progress because it needs human input or another dependency, move it to `Blocked` and add a reason. Unblocking moves it back to its previous column.

### Add dependencies

A task can depend on another task. The dependent task can't leave `Backlog` or `Todo` until its dependencies hit `Done`. Set this from the detail panel under `Depends on`.

### Complete and archive

Move to `Done` and add a one-line summary. The summary is what shows up in memory search later, so make it useful. `Done` tasks can be moved to `Archived` to clear them off the active board without losing history.

### Delete a task

Use the trash icon in the detail panel. Task deletes remove the task from the board; `bakin trash` is only for asset recovery.

## Filtering and searching

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-tasks--filters.webp" alt="Filter chips for column, owner, tag, and workflow." loading="lazy">
</figure>

The filter bar above the board narrows by column, owner, tag, or attached workflow. Filters are URL-synced, so you can bookmark or share a specific view.

## Columns and transitions

The seven columns and what they mean:

<div class="table-light-fit table-label">

| Column | Meaning |
| --- | --- |
| Backlog | Captured but not yet approved or scheduled |
| Todo | Approved and queued for work |
| Blocked | Can't progress, needs input or dependency resolution |
| In Progress | Actively being worked |
| Review | Work done, waiting for human approval |
| Done | Approved and complete |
| Archived | Cleared off the active board, history preserved |

</div>

<p class="gap-top">Tasks move along a fixed state machine. Allowed transitions:</p>

<div class="table-light-fit table-label">

| From | To |
| --- | --- |
| Backlog | Todo |
| Todo | In Progress, Blocked, Done, Backlog |
| In Progress | Review, Done, Blocked, Todo |
| Blocked | Todo, In Progress, Backlog |
| Review | Done, In Progress, Todo |
| Done | Archived, Todo, In Progress |
| Archived | Done, Todo |

</div>

CLI moves and agent calls go through the same state machine.

## Settings

<!-- docs:settings tasks -->
<div class="settings-table">

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| Default column | `select` | `todo` | Which column new tasks are created in |
| Show completed tasks | `boolean` | `true` | Show tasks in the Done and Archived columns by default |
| Auto-archive after (days) | `number` | `0` | Move completed tasks to archive after this many days. 0 to disable. |
| Max in-progress tasks | `number` | `5` | Warn when more than this many tasks are in progress |

</div>
<!-- /docs:settings -->

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 11 12 5 17"/><line x1="13" y1="17" x2="19" y2="17"/></svg>From the CLI

Same operations are available from the terminal when you'd rather not click:

<!-- docs:cli-commands tasks -->
| Command | Purpose |
| --- | --- |
| `bakin tasks list [--column=<column>]` | List tasks. |
| `bakin tasks get <id>` | Get task details. |
| `bakin tasks create <title> [agent] [--workflow=<id>] [--no-workflow=<reason>]` | Create a task. |
| `bakin tasks move <id> <column>` | Move a task. |
| `bakin tasks log <id> <message>` | Log task progress. |
| `bakin tasks block <id> <reason>` | Block a task. |
| `bakin tasks depend <id> <dependsOn>` | Register a task dependency. |
| `bakin tasks complete <id> <summary>` | Complete a task. |
<!-- /docs:cli-commands -->

Full surface in the [CLI reference](/docs/reference/generated/cli/).

HTTP API surface for this plugin: see the [API reference](/docs/reference/generated/api/#tasks).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents drive tasks through MCP exec tools. The full set:

<!-- docs:exec-tools tasks -->
- `bakin_exec_tasks_assign`: Assign a task to an agent.
- `bakin_exec_tasks_block`: Mark a task as blocked with a reason. Use when you cannot proceed.
- `bakin_exec_tasks_complete`: Report that your task is complete. Moves the task to Done and notifies the orchestrator.
- `bakin_exec_tasks_create`: Create a new task on the task board. Workflows are auto-matched by title when workflowId is not provided. Provide workflowId to force a specific workflow, or skipWorkflowReason to explicitly skip.
- `bakin_exec_tasks_delete`: Delete a task from the board.
- `bakin_exec_tasks_get`: Get details about a task — title, description, current column, logs, dependencies, project context.
- `bakin_exec_tasks_list`: List all tasks on the board. Optionally filter by column or agent.
- `bakin_exec_tasks_log_progress`: Log a human-readable progress update to the live activity feed. Call this at every significant step.
- `bakin_exec_tasks_move`: Move a task to a different column on the task board.
- `bakin_exec_tasks_set_dependency`: Register a dependency between tasks. Your task will be auto-re-dispatched when the dependency completes. After registering, exit — do not wait.
- `bakin_exec_tasks_update`: Update a task on the board — change title, description, or assigned agent.
<!-- /docs:exec-tools -->

Full schemas and arguments in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Workflows](/docs/using/workflows/): multi-step work that tasks can attach to
- [Memory](/docs/using/memory/): search across completed tasks
- [Schedule](/docs/using/schedule/): recurring task creation
