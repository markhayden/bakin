# Beacon API Documentation

_Auto-generated at 2026-03-21T04:22:59.101Z_

**Base URL:** `http://localhost:3737`

---

## Core Routes

### `GET /api/events`
SSE event stream — real-time updates for file changes, task events, alerts

### `GET /api/dispatch`
Get dispatch timer state — interval, last run, next run, dispatched count

### `POST /api/dispatch`
Trigger immediate task dispatch cycle

### `GET /api/settings`
Get current Beacon settings

### `POST /api/settings`
Update Beacon settings (partial merge)

**Parameters:** `JSON object with settings keys to update`

### `POST /api/internal/continuation`
Trigger dependency continuation check

**Parameters:** `{"completedTaskId":"string","completedTitle":"string"}`

### `POST /api/activity/emit`
Emit activity event via SSE

**Parameters:** `{"agent":"string","message":"string","ts":"string"}`

### `GET /api/docs`
Get API documentation as JSON

### `GET /api/search`
Search across all indexed content (requires Antfly)

**Parameters:** `?q=<query>&table=<optional>&limit=<optional>`

### `GET /api/agents`
List all agents with status and active tasks

### `GET /api/agents/:id`
Get agent status

### `GET /api/agents/:id/status`
Get detailed agent status

### `POST /api/agents/:id/message`
Send a message to an agent

**Parameters:** `{"message":"string"}`

### `GET /api/agents/:id/tasks`
Get tasks assigned to an agent

### `POST /api/plugins/install`
Install a plugin

**Parameters:** `{"source":"string","type":"local|github"}`

### `POST /api/plugins/remove`
Remove an installed plugin

**Parameters:** `{"pluginId":"string"}`

### `GET /api/doctor`
Run health checks (agent roster, skill sync, gateway, Antfly, taskboard)

### `POST /api/reindex`
Trigger full content reindex to Antfly

---

## Plugin: tasks

### `POST /api/plugins/tasks/create`

### `POST /api/plugins/tasks/move`

### `POST /api/plugins/tasks/delete`

### `POST /api/plugins/tasks/assign`

### `POST /api/plugins/tasks/log`

### `POST /api/plugins/tasks/block`

### `POST /api/plugins/tasks/update`

---

## Plugin: memory

### `GET /api/plugins/memory/audit`

### `GET /api/plugins/memory/workspace`

### `GET /api/plugins/memory/gateway`

---

## Plugin: models

### `GET /api/plugins/models/available`

### `GET /api/plugins/models/config`

### `POST /api/plugins/models/config`

### `POST /api/plugins/models/defaults`

### `GET /api/plugins/models/aliases`

### `POST /api/plugins/models/aliases`

### `POST /api/plugins/models/restart`

---

## Plugin: calendar

### `GET /api/plugins/calendar/items`

### `POST /api/plugins/calendar/items`

### `POST /api/plugins/calendar/items/update`

### `POST /api/plugins/calendar/items/delete`

### `POST /api/plugins/calendar/items/approve`

### `POST /api/plugins/calendar/items/reject`

### `POST /api/plugins/calendar/brainstorm`

---

## Plugin: workflows

### `GET /api/plugins/workflows/list`

### `GET /api/plugins/workflows/definition`

---
