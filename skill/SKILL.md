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
1. Log that you've started working on it
2. Log progress at every major step (not just start and done)
3. If blocked, log why and move to Blocked
4. When done, move to Done and report to main-operator

### Log Progress (REQUIRED)

You MUST log progress frequently. If you haven't logged in 5 minutes, the watchdog will flag you as stuck.

```bash
curl -s -X POST http://localhost:3737/api/tasks/log \
  -H 'Content-Type: application/json' \
  -d '{"title":"<task-id-or-title>","author":"<your-agent-name>","message":"<what you did or are doing>"}'
```

### Move Task to Done

```bash
curl -s -X POST http://localhost:3737/api/plugins/tasks/move \
  -H 'Content-Type: application/json' \
  -d '{"id":"<task-id>","to":"done"}'
```

### Report Completion to Main Operator

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

## Rules

1. **Always log progress.** The watchdog monitors for stuck tasks. Log before, during, and after major steps.
2. **Use the API, not file edits.** Don't edit TASKBOARD.md directly — use the task API endpoints. The system handles locking and formatting.
3. **Discover paths via the API.** Never hardcode `content/`, `~/.beacon/`, or any absolute path. Always use `curl http://localhost:3737/api/paths?key=<key>` to find where to read or write files.
4. **Report back.** Always notify main-operator when done or blocked.
5. **Check API docs.** If you're unsure about an endpoint, `curl http://localhost:3737/api/docs`.

## Subagent Rules

These rules apply to ALL subagents (Chef, Pixel, Rolo, Patch, etc.). Violating them breaks the pipeline.

1. **Never edit TASKBOARD.md directly.** Always use the Beacon task API. The API handles locking and prevents conflicts.

2. **Never hardcode filesystem paths.** Always use the paths API (`/api/paths?key=<key>`) to discover content locations. Paths change between environments and after migrations. Constructing paths like `content/assets/` or `~/.beacon/assets/` will break.

3. **Stay in your lane.** Don't do work assigned to another agent inline. Chef doesn't generate images — she creates a task for Pixel. Pixel doesn't write copy — that's Chef's job.

4. **Only spawn agents when you have a concrete brief.** Don't speculatively create subtasks. Wait until you have real, ready-to-hand-off work.

5. **Use your own agent name when logging.** Log as `chef`, `pixel`, `patch`, etc. — never as `system`, `main-operator`, or another agent's name.

6. **Never send messages directly to Mark.** All communication goes through Main Operator (the orchestrator). When done, report to `main` — Main Operator decides what to surface.

7. **Never mark a task done prematurely.** Only move to Done after output is delivered and confirmed. "I generated the image" is not done — "the image is saved and Chef has the path" is done.

8. **Always exit after registering a dependency.** If you're waiting on another agent, register the dependency and stop. You'll be re-dispatched when it completes.

9. **Log progress every major step.** If you haven't logged in 5 minutes, the watchdog will flag you as stuck. Keep the logs flowing.
