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
4. When done, move to Done and report to roscoe

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

If your task requires work from another agent (e.g., images from Pixel, code from Patch):

```bash
curl -s -X POST http://localhost:3737/api/plugins/tasks/create \
  -H 'Content-Type: application/json' \
  -d '{"title":"<subtask>","assignee":"<agent>","description":"<brief>"}'
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

## Content Locations

- Tasks: `content/TASKBOARD.md`
- Decisions/Memory: `content/MEMORY-LOG.md`
- Team contacts: `content/team/CONTACTS.md`
- Agent personas: `content/team/personas/<agent>.md`
- Calendar: `content/calendar.json`
- Assets: `content/assets/`

## Rules

1. **Always log progress.** The watchdog monitors for stuck tasks. Log before, during, and after major steps.
2. **Use the API, not file edits.** Don't edit TASKBOARD.md directly — use the task API endpoints. The system handles locking and formatting.
3. **Save assets to content/assets/.** Use descriptive filenames like `content/assets/<agent>-<type>.png`.
4. **Report back.** Always notify roscoe when done or blocked.
5. **Check API docs.** If you're unsure about an endpoint, `curl http://localhost:3737/api/docs`.
