---
name: bakin
description: Mission control integration for multi-agent coordination through Bakin MCP tools via mcporter.
---

# Bakin Mission Control

Use Bakin for task-board work, workflow routing, team coordination, assets, schedules, and channel posting.

Bakin is the local task, project, agent, workflow, asset, schedule, and observability system for this OpenClaw runtime.

Your MCP server is `bakin-<agent>`. The main operator uses `bakin-main`.

The local Bakin server normally runs at `http://localhost:3737`. Prefer Bakin MCP tools when they are available. Use the CLI only when MCP is unavailable or when the user asks for a shell command.

The CLI is usually `bakin`. If the runtime shell cannot find it, try `$HOME/.local/bin/bakin` or `/usr/local/bin/bakin`.

## Live Tool Discovery

The live MCP server is authoritative. If a tool name or argument is uncertain, run:

```bash
mcporter list bakin-<agent> --schema
```

Runtime shells are intentionally minimal. Do not assume `rg`, `jq`, GNU-only flags, or stdin JSON helpers exist. If you need to filter schema output, use portable tools such as `grep`, `sed`, `awk`, and `head`:

```bash
mcporter list bakin-main --schema | grep -n -E 'bakin_exec_projects_apply_plan|bakin_exec_projects_get'
```

Call tools with valid `mcporter` argument syntax. Use `--args '<json object>'` as one shell argument, or simple `key=value` arguments when the schema is obvious. Do not use `--args @-`, heredocs, process substitution, or stdin-fed JSON with `mcporter call`; this mcporter version does not parse them.

```bash
mcporter call bakin-main.bakin_exec_projects_get --args '{"projectId":"proj_123"}'
```

For larger or multiline payloads, generate compact JSON first and pass it as a quoted variable:

```bash
ARGS=$(node -e 'process.stdout.write(JSON.stringify({projectId:"proj_123",body:"Updated plan\n\nNext step"}))')
mcporter call bakin-main.bakin_exec_projects_apply_plan --args "$ARGS"
```

Do not rely on old non-exec tool names such as `bakin_create_task`, `bakin_report_complete`, `bakin_get_task`, or `bakin_post_discord`. Current task-board and plugin tools use the `bakin_exec_*` namespace.

<!-- bakin:exec-tools:start -->
<!--
  The exec-tools block is rendered at sync time. Keep it compact; agents can
  use live discovery for full schemas when a less-common tool is needed.
-->
<!-- bakin:exec-tools:end -->

## Core Calls

Use these current tool names for the common paths:

- Create task: `bakin_exec_tasks_create`
- List/get task: `bakin_exec_tasks_list`, `bakin_exec_tasks_get`
- Move task: `bakin_exec_tasks_move`
- Log progress: `bakin_exec_tasks_log_progress` or `bakin_exec_log`
- Complete task: `bakin_exec_tasks_complete`
- Block task: `bakin_exec_tasks_block`
- Assign/update/delete task: `bakin_exec_tasks_assign`, `bakin_exec_tasks_update`, `bakin_exec_tasks_delete`
- Set dependency: `bakin_exec_tasks_set_dependency`
- Workflows: `bakin_exec_workflows_list`, `bakin_exec_workflows_get_definition`, `bakin_exec_workflows_start`, `bakin_exec_get_step`, `bakin_exec_submit_step`, `bakin_exec_check_gates`
- Team: `bakin_exec_team_list`, `bakin_exec_team_profile`, `bakin_exec_team_status`, `bakin_exec_team_message`
- Assets: `bakin_exec_assets_save`, `bakin_exec_assets_list`, `bakin_exec_assets_get`
- Channels: `bakin_exec_post_channel`
- Paths: `bakin_exec_get_paths`
- Health: `bakin_exec_health_status`, `bakin_exec_health_doctor`
- Schedule: `bakin_exec_schedule_list`, `bakin_exec_schedule_create`, `bakin_exec_schedule_get`, `bakin_exec_schedule_run_now`

## Task Creation Discipline

When the operator or main asks to assign work to another agent, create a Bakin task first. Do not directly spawn or message OpenClaw agents unless Bakin is unavailable and the user explicitly wants a fallback.

Before `bakin_exec_tasks_create`:

1. Call `bakin_exec_workflows_list` when the request could map to a workflow.
2. Choose the matching `workflowId`, or set `skipWorkflowReason` for a one-off request.
3. Include `parentId` when this is a subtask of an existing task.
4. Include enough brief/context for the assigned agent to act without asking for the original chat.

Example shape:

```bash
mcporter call bakin-main.bakin_exec_tasks_create --args '{"title":"Write todays story","assignee":"trainer","description":"Write a short story and post the result back to #general.","skipWorkflowReason":"one-off chat request"}'
```

## Task Lifecycle

Tasks flow through backlog, todo, inProgress, blocked, done, and archived. Start assigned work by moving the task to `inProgress` and logging progress. Before marking a task done, log what changed. If blocked, use `bakin_exec_tasks_block` with the concrete reason.

Workflow step assignments are different: submit step output with `bakin_exec_submit_step`. Do not move workflow tasks to done directly.

## Error Handling

If a Bakin MCP call fails, report the exact tool and error. Do not silently fall back to direct OpenClaw dispatch for task-board work. A fallback is acceptable only when the user has asked for best-effort delivery despite Bakin being down.

## Path Discipline

Use `bakin_exec_get_paths` before reading or writing Bakin content paths. Do not hardcode `~/.bakin` in normal agent work.
