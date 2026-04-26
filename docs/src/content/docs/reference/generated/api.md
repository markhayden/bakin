---
title: API Reference
description: Generated reference for documented Bakin HTTP API routes.
---

Docs version: Bakin 1.0.0

This page is generated from `src/core/api-docs.ts` and runtime route registration metadata.

## Core Routes

### `GET /api/events`

SSE event stream

Real-time updates for file changes, task events, alerts.

- Visibility: `public`
- Stability: `stable`

### `GET /api/dispatch`

Get dispatch timer state

Returns interval, last run, next run, and dispatched count.

- Visibility: `public`
- Stability: `stable`

### `POST /api/dispatch`

Trigger dispatch

Triggers an immediate task dispatch cycle.

- Visibility: `public`
- Stability: `stable`

### `GET /api/settings`

Get settings

Returns current Bakin settings.

- Visibility: `public`
- Stability: `stable`

### `POST /api/settings`

Update settings

Updates Bakin settings with a partial merge.

Parameters: `JSON object with settings keys to update`

- Visibility: `public`
- Stability: `stable`

### `POST /api/internal/continuation`

Trigger continuation check

Triggers dependency continuation checks.

Parameters: `{"completedTaskId":"string","completedTitle":"string"}`

- Visibility: `internal`
- Stability: `experimental`

### `POST /api/activity/emit`

Emit activity event

Emits an activity event via SSE.

Parameters: `{"agent":"string","message":"string","ts":"string"}`

- Visibility: `public`
- Stability: `stable`

### `GET /api/docs`

Get API documentation

Returns API route documentation as JSON.

- Visibility: `public`
- Stability: `stable`

### `GET /api/search`

Search indexed content

Searches across indexed content. Requires Antfly.

Parameters: `?q=<query>&table=<optional>&limit=<optional>`

- Visibility: `public`
- Stability: `stable`

### `GET /api/agents`

List agents

Lists all agents with status and active tasks.

- Visibility: `public`
- Stability: `stable`

### `GET /api/agents/:id`

Get agent status

Returns agent status.

- Visibility: `public`
- Stability: `stable`

### `GET /api/agents/:id/status`

Get detailed agent status

Returns detailed status for one agent.

- Visibility: `public`
- Stability: `stable`

### `POST /api/agents/:id/message`

Send message to agent

Sends a message to an agent.

Parameters: `{"message":"string"}`

- Visibility: `public`
- Stability: `stable`

### `GET /api/agents/:id/tasks`

Get agent tasks

Returns tasks assigned to an agent.

- Visibility: `public`
- Stability: `stable`

### `POST /api/plugins/install`

Install plugin

Installs a plugin.

Parameters: `{"source":"string","type":"local|github"}`

- Visibility: `public`
- Stability: `stable`

### `POST /api/plugins/remove`

Remove plugin

Removes an installed plugin.

Parameters: `{"pluginId":"string"}`

- Visibility: `public`
- Stability: `stable`

### `POST /api/reindex`

Trigger reindex

Triggers a full content reindex to Antfly.

- Visibility: `public`
- Stability: `stable`
