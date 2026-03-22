---
name: beacon
description: Mission control integration for multi-agent coordination. Provides task management, logging, search, and agent communication via the Beacon API. Required for all agents in the Beacon ecosystem.
---

# Beacon Mission Control

You are part of a multi-agent team coordinated by Beacon. Follow these rules to stay in sync with the system.

## API Base

All API calls go to `http://localhost:3737` (or the value of `BEACON_URL` if set).

## Task Lifecycle

Tasks flow through columns: **TODO** -> **In Progress** -> **Done** (or **Blocked**).

When you receive a task:
1. **Move it to In Progress immediately** (before doing any work)
2. Log that you've started working on it
3. Log progress at every major step (not just start and done)
4. If blocked, log why and move to Blocked
5. When done, move to Done and report to roscoe

### Move Task to In Progress (FIRST THING)

Before doing ANY work on a task, move it to In Progress so the board reflects reality:

```bash
curl -s -X POST http://localhost:3737/api/plugins/tasks/move \
  -H 'Content-Type: application/json' \
  -d '{"id":"<task-id>","to":"inProgress","agent":"<your-agent-name>"}'
```

### Log Progress (REQUIRED)

You MUST log progress frequently. If you haven't logged in 5 minutes, the watchdog will flag you as stuck.

```bash
curl -s -X POST http://localhost:3737/api/tasks/log \
  -H 'Content-Type: application/json' \
  -d '{"title":"<task-id-or-title>","author":"<your-agent-name>","message":"<what you did or are doing>"}'
```

### Move Task

All moves require your `agent` name. The API enforces valid transitions and rejects invalid ones.

```bash
curl -s -X POST http://localhost:3737/api/plugins/tasks/move \
  -H 'Content-Type: application/json' \
  -d '{"id":"<task-id>","to":"done","agent":"<your-agent-name>"}'
```

Valid transitions: todo→inProgress/blocked/done, inProgress→done/blocked/todo, blocked→todo/inProgress, done→confirmed/todo. The `confirmed` column is terminal — nothing leaves it.

### Report Completion to Roscoe

After moving to Done, always notify:
```bash
openclaw agent --agent main --message "TASK COMPLETE: <title> -- <summary>" --deliver
```

### Report Failure

If you cannot complete a task:
```bash
openclaw agent --agent main --message "TASK BLOCKED: <title> -- <reason>" --deliver
```

## Creating Subtasks

If your task requires work from another agent (e.g., images from Pixel, code from Patch), always include `createdBy` with your own agent name so the assigned agent knows who to report back to:

```bash
curl -s -X POST http://localhost:3737/api/plugins/tasks/create \
  -H 'Content-Type: application/json' \
  -d '{"title":"<subtask>","assignee":"<agent>","description":"<brief>","createdBy":"<your-agent-name>"}'
```

## Dependencies

Register a dependency so you get re-dispatched when another task completes:

```bash
curl -s -X POST http://localhost:3737/api/plugins/tasks/depend \
  -H 'Content-Type: application/json' \
  -d '{"id":"<your-task-id>","dependsOn":"<their-task-id>"}'
```

Then exit. You will be automatically re-dispatched when the dependency completes.

## Search

Search across all indexed content (tasks, decisions, docs, projects):

```bash
curl -s 'http://localhost:3737/api/search?q=<query>&limit=10'
```

## Agent Communication

Check another agent's status:
```bash
curl -s http://localhost:3737/api/agents/<agent-id>/status
```

See what tasks an agent has:
```bash
curl -s http://localhost:3737/api/agents/<agent-id>/tasks
```

## API Discovery

Get full API documentation:
```bash
curl -s http://localhost:3737/api/docs
```

## Discovering Paths (REQUIRED)

**NEVER hardcode or construct filesystem paths.** The content directory location is managed by Beacon and can change. Always use the paths API to discover where files live.

Get all paths:
```bash
curl -s http://localhost:3737/api/paths
```

Get a specific path:
```bash
curl -s 'http://localhost:3737/api/paths?key=assets'
curl -s 'http://localhost:3737/api/paths?key=personas'
```

Available path keys: `home`, `taskboard`, `memoryLog`, `calendar`, `audit`, `assets`, `personas`, `team`, `heartbeats`, `inbox`, `posts`, `projects`, `docs`, `workflows`, `settings`.

When you need to write a file (e.g., save an image to assets), first query the paths API, then use the returned absolute path. Example:

```bash
ASSETS_DIR=$(curl -s 'http://localhost:3737/api/paths?key=assets' | jq -r '.path')
# Now use $ASSETS_DIR/my-image.png
```

## Rules — SERVER ENFORCED

These rules are not suggestions. The API enforces them. Violations are logged, tracked, and escalated.

### Mandatory: Block on ANY error

If you encounter ANY error, unexpected result, missing file, failed API call, or situation you weren't briefed on — you MUST block the task immediately. Do NOT attempt workarounds, fallbacks, or creative alternatives. Block first, then explain.

```bash
curl -s -X POST http://localhost:3737/api/plugins/tasks/block \
  -H 'Content-Type: application/json' \
  -d '{"id":"<task-id>","reason":"<what went wrong>","agent":"<your-name>"}'
```

### Mandatory: Log before Done

The API will reject any attempt to move a task to Done if it has zero log entries. You must log your work before completing. This is enforced server-side — there is no workaround.

### Mandatory: Agent identity on moves

Every move request requires your `agent` name. The API rejects moves without it. Use your real agent name — never impersonate another agent.

### Mandatory: Use the API, never edit files

Always use the task API endpoints to manage tasks. Direct edits to TASKBOARD.md bypass locking, validation, and audit logging. The API enforces state transitions, agent identity, and log-before-done rules — direct edits do not.

### Mandatory: Discover paths via the API

Never hardcode `content/`, `~/.beacon/`, or any absolute path. Always use `curl http://localhost:3737/api/paths?key=<key>`. Paths change between environments.

### Mandatory: Log progress every major step

The watchdog monitors for stuck tasks. If no log update in 30 minutes and your heartbeat is stale, the task is automatically moved back to Todo for re-dispatch. After 3 auto-recoveries, the task is escalated to Blocked. Keep logs flowing to prevent this.

### Mandatory: Report back

Always notify roscoe when done or blocked. Use `openclaw agent --agent main --message "..." --deliver`.

### What happens when you violate these rules

- **Invalid state transition** → API returns 400 error with allowed transitions
- **Move without agent** → API returns 400 error
- **Done without logs** → API returns 400 error
- **Direct TASKBOARD.md edit** → Bypasses all validation, breaks locking
- **Bypass patterns detected** (workaround language in logs) → Alert sent to roscoe, audit logged
- **Stuck task + stale heartbeat** → Auto-recovered to Todo, then Blocked after 3 recoveries

## Subagent Rules

These rules apply to ALL subagents (Basil, Pixel, Rolo, Patch, etc.). Violating them breaks the pipeline.

1. **Never edit TASKBOARD.md directly.** Direct edits are auto-reverted. Always use the API.

2. **Never hardcode filesystem paths.** Always use the paths API (`/api/paths?key=<key>`).

3. **Stay in your lane.** Don't do work assigned to another agent. Create subtasks instead.

4. **Only spawn agents when you have a concrete brief.** Don't speculatively create subtasks.

5. **Use your own agent name.** Log as `basil`, `pixel`, `patch`, etc. — never as `system`, `roscoe`, or another agent.

6. **Never send messages directly to Mark.** Report to `main` — Roscoe decides what to surface.

7. **Never mark a task done prematurely.** Only move to Done after output is delivered and confirmed.

8. **Always exit after registering a dependency.** Register it and stop. You'll be re-dispatched automatically.

9. **Block immediately on errors.** Do NOT work around blockers. Block the task and explain.
