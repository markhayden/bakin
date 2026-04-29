---
title: API Reference
description: Generated reference for documented Bakin HTTP API routes.
---

Docs version: Bakin 1.0.0

This page is generated from `src/core/api-docs.ts` and each plugin's `bakin-plugin.json:contributes.apiRoutes` (with source-scan fallback for plugins that have not declared a manifest contract yet).

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

Searches across indexed content through the search adapter.

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

Triggers a full content reindex through the search adapter.

- Visibility: `public`
- Stability: `stable`

## Plugin: assets

Centralized content store for all artifacts with rich rendering, search, task linking, manual upload, and clipboard paste

### `DELETE /api/plugins/assets/`

Soft-delete an asset


### `GET /api/plugins/assets/`

List assets with filters


### `PUT /api/plugins/assets/content`

Update text content of an editable asset


### `GET /api/plugins/assets/file`

Serve asset file


### `PATCH /api/plugins/assets/link`

Relink or unlink an asset


### `PATCH /api/plugins/assets/retype`

Change asset type classification


### `DELETE /api/plugins/assets/trash`

Empty entire trash


### `GET /api/plugins/assets/trash`

List trashed assets


### `DELETE /api/plugins/assets/trash/:file`

Permanently delete a trashed asset


### `POST /api/plugins/assets/trash/:file/restore`

Restore a trashed asset


### `POST /api/plugins/assets/upload`

Upload asset files


## Plugin: health

System health dashboard — MCP stats, diagnostics, and uptime

### `GET /api/plugins/health/checks`

List registered plugin health checks (metadata only; does not execute them).


### `GET /api/plugins/health/doctor`

GET /doctor


### `GET /api/plugins/health/registry`

GET /registry


### `GET /api/plugins/health/search-status`

GET /search-status


### `GET /api/plugins/health/summary`

GET /summary


### `GET /api/plugins/health/usage`

GET /usage


### `GET /api/plugins/health/usage-feed`

GET /usage-feed


## Plugin: memory

Observability dashboard over runtime memory tiers plus Bakin's audit log

### `GET /api/plugins/memory/audit`

List indexed audit entries with optional filters


### `GET /api/plugins/memory/checkpoints`

List compaction checkpoints for an agent (optionally by session)


### `GET /api/plugins/memory/checkpoints/:agent/:sessionId/:checkpointId`

Read one checkpoint by (agent, sessionId, checkpointId)


### `GET /api/plugins/memory/daily-notes`

List daily notes for an agent (sorted by date desc)


### `GET /api/plugins/memory/daily-notes/:agent/:filename`

Read one daily note


### `POST /api/plugins/memory/daily-notes/compare-search`

Run the same query against Bakin search and runtime memory search


### `GET /api/plugins/memory/dreams`

List dream artifacts for an agent (optional phase/date/artifactType filters)


### `GET /api/plugins/memory/dreams/:agent/:artifactType`

Read one dream artifact by (agent, artifactType[, phase, date])


### `GET /api/plugins/memory/durable`

List canonical durable files present for an agent


### `GET /api/plugins/memory/durable/:agent/:basename`

Read one canonical durable file for an agent


### `GET /api/plugins/memory/recent`

Recent memory items across tiers, sorted by updated_at desc


### `GET /api/plugins/memory/sessions`

List sessions for an agent


### `GET /api/plugins/memory/sessions/:agent/:sessionKey`

Read one session by key


### `GET /api/plugins/memory/sessions/:agent/:sessionKey/turns`

List turns belonging to one session (indexed)


### `GET /api/plugins/memory/status`

Indexer health: per-tier row counts + offset snapshot


### `GET /api/plugins/memory/turns`

List turns by (agent, sessionId)


## Plugin: messaging

Content messaging with scheduling, brainstorming, and multi-agent content pipeline

### `GET /api/plugins/messaging/`

List messaging items

- Permissions: `storage.read`

### `GET /api/plugins/messaging/:itemId`

Get a messaging item

- Permissions: `storage.read`

### `POST /api/plugins/messaging/`

Create a messaging item

- Permissions: `storage.write`

### `PUT /api/plugins/messaging/:itemId`

Update a messaging item

- Permissions: `storage.write`

### `DELETE /api/plugins/messaging/:itemId`

Delete a messaging item

- Permissions: `storage.write`

### `POST /api/plugins/messaging/:itemId/approve`

Approve and optionally publish a messaging item

- Permissions: `storage.write`, `runtime.channels`, `assets.read`

### `POST /api/plugins/messaging/:itemId/unapprove`

Move an approved messaging item back to draft

- Permissions: `storage.write`

### `POST /api/plugins/messaging/:itemId/reject`

Reject a messaging item

- Permissions: `storage.write`

### `POST /api/plugins/messaging/brainstorm`

Send a one-shot brainstorm prompt

- Permissions: `runtime.messaging`

### `GET /api/plugins/messaging/sessions`

List planning sessions

- Permissions: `storage.read`

### `GET /api/plugins/messaging/sessions/:id`

Get a planning session

- Permissions: `storage.read`

### `POST /api/plugins/messaging/sessions`

Create a planning session

- Permissions: `storage.write`

### `PUT /api/plugins/messaging/sessions/:id`

Update a planning session

- Permissions: `storage.write`

### `DELETE /api/plugins/messaging/sessions/:id`

Delete a planning session

- Permissions: `storage.write`

### `POST /api/plugins/messaging/sessions/:id/messages`

Send a message to a planning session

- Permissions: `runtime.messaging`, `storage.write`

### `PUT /api/plugins/messaging/sessions/:id/proposals/:proposalId`

Update a planning-session proposal

- Permissions: `storage.write`

### `POST /api/plugins/messaging/sessions/:id/confirm`

Confirm planning-session proposals into calendar items

- Permissions: `storage.write`, `runtime.channels`, `assets.read`

### `GET /api/plugins/messaging/search`

Search messaging brainstorm sessions

- Permissions: `search.read`

## Plugin: models

Agent model configuration — per-agent models, aliases, task profiles, available models from Anthropic API

### `GET /api/plugins/models/aliases`

GET /aliases


### `POST /api/plugins/models/aliases`

POST /aliases


### `GET /api/plugins/models/available`

Bypass cache and fetch the model list fresh from the runtime adapter


### `GET /api/plugins/models/config`

GET /config


### `POST /api/plugins/models/config`

POST /config


### `POST /api/plugins/models/defaults`

POST /defaults


### `GET /api/plugins/models/profiles`

GET /profiles


### `PUT /api/plugins/models/profiles`

Check if runtime config is out of sync (needs restart)


### `POST /api/plugins/models/refresh`

Bypass cache and fetch the model list fresh from the runtime adapter


### `POST /api/plugins/models/runtime/restart`

List available AI models with tier classification (budget/standard/premium). Use this to discover what models are available for assignment.


### `GET /api/plugins/models/runtime/status`

Check if runtime config is out of sync (needs restart)


## Plugin: projects

Project management with specs, checklists, task linking, and agent access via MCP tools

### `GET /api/plugins/projects/`

List projects

- Permissions: `storage.read`

### `GET /api/plugins/projects/:projectId`

Get a project

- Permissions: `storage.read`, `tasks.read`, `assets.read`

### `POST /api/plugins/projects/`

Create a project

- Permissions: `storage.write`, `runtime.agents`

### `PUT /api/plugins/projects/:projectId`

Update a project

- Permissions: `storage.write`

### `DELETE /api/plugins/projects/:projectId`

Delete a project

- Permissions: `storage.write`, `tasks.write`

### `POST /api/plugins/projects/:projectId/checklist`

Add a checklist item

- Permissions: `storage.write`

### `PUT /api/plugins/projects/:projectId/checklist/:itemId/toggle`

Toggle a checklist item

- Permissions: `storage.write`

### `PUT /api/plugins/projects/:projectId/checklist/:itemId`

Update a checklist item

- Permissions: `storage.write`

### `DELETE /api/plugins/projects/:projectId/checklist/:itemId`

Remove a checklist item

- Permissions: `storage.write`

### `POST /api/plugins/projects/:projectId/checklist/:itemId/link`

Link a checklist item to a task

- Permissions: `storage.write`, `tasks.read`

### `POST /api/plugins/projects/:projectId/checklist/:itemId/promote`

Promote a checklist item to a task

- Permissions: `storage.write`, `tasks.write`

### `POST /api/plugins/projects/:projectId/assets`

Attach an asset

- Permissions: `storage.write`, `assets.read`

### `DELETE /api/plugins/projects/:projectId/assets/:filename`

Detach an asset

- Permissions: `storage.write`

### `POST /api/plugins/projects/:projectId/ask`

Ask an agent about a project

- Permissions: `runtime.messaging`, `storage.read`

### `GET /api/plugins/projects/search`

Search projects

- Permissions: `search.read`

## Plugin: schedule

Cron job scheduling through the runtime adapter with task creation

### `GET /api/plugins/schedule/`

List all scheduled jobs


### `POST /api/plugins/schedule/`

Create a scheduled job


### `DELETE /api/plugins/schedule/:jobId`

Delete a scheduled job


### `GET /api/plugins/schedule/:jobId`

Get details for a single scheduled job


### `PUT /api/plugins/schedule/:jobId`

PUT /:jobId


### `POST /api/plugins/schedule/:jobId/pause`

Pause/resume/skip a job


### `POST /api/plugins/schedule/:jobId/run`

Trigger immediate run


### `GET /api/plugins/schedule/:jobId/runs`

Get run history for a job


### `POST /api/plugins/schedule/bridge`

Cron bridge webhook


### `POST /api/plugins/schedule/parse`

Parse schedule expression


## Plugin: tasks

Kanban task management with Bakin task-store persistence, agent assignment, and dependency tracking

### `GET /api/plugins/tasks/`

List all tasks


### `POST /api/plugins/tasks/`

Create a new task


### `DELETE /api/plugins/tasks/:taskId`

Delete a task


### `GET /api/plugins/tasks/:taskId`

Get a single task by ID


### `PUT /api/plugins/tasks/:taskId`

Update a task


### `POST /api/plugins/tasks/:taskId/assign`

Assign a task to an agent


### `POST /api/plugins/tasks/:taskId/block`

Mark a task as blocked


### `POST /api/plugins/tasks/:taskId/complete`

Mark a task as complete


### `POST /api/plugins/tasks/:taskId/dependency`

Set a dependency between tasks


### `POST /api/plugins/tasks/:taskId/log`

Add a log entry to a task


### `POST /api/plugins/tasks/:taskId/move`

Move a task to a different column


### `POST /api/plugins/tasks/reorder`

Reorder tasks within a column


## Plugin: team

Agent team management — adapter layer over runtime agent workspaces

### `GET /api/plugins/team/`

List all agents with runtime status


### `POST /api/plugins/team/`

Create a new agent in the active runtime


### `DELETE /api/plugins/team/:agentId`

Remove an agent from the active runtime and move workspace to trash


### `GET /api/plugins/team/:agentId`

Get full agent profile merged from runtime state


### `GET /api/plugins/team/:agentId/active-context`

Read the most recent session JSONL parsed into a message stream


### `GET /api/plugins/team/:agentId/avatar`

Serve agent avatar image


### `POST /api/plugins/team/:agentId/avatar`

Upload agent avatar image


### `GET /api/plugins/team/:agentId/files`

List workspace files for an agent


### `GET /api/plugins/team/:agentId/files/:filename`

Read a specific workspace file


### `PUT /api/plugins/team/:agentId/files/:filename`

Write a workspace file through the active runtime


### `GET /api/plugins/team/:agentId/heartbeat`

Read the agent's HEARTBEAT.md narrative + file mtime


### `PUT /api/plugins/team/:agentId/identity`

Update agent identity fields and persona files


### `GET /api/plugins/team/:agentId/memory`

List memory files for an agent


### `GET /api/plugins/team/:agentId/memory/:date`

Read a specific memory file


### `PUT /api/plugins/team/:agentId/permissions`

Update agent dispatch permissions (subagents.allowAgents)


### `GET /api/plugins/team/:agentId/recent-activity`

Per-agent dispatch + error counts across 5m / 1h / 24h windows (resets on server restart)


### `GET /api/plugins/team/:agentId/skills`

List installed skills for an agent


### `GET /api/plugins/team/:agentId/skills/:skillId`

Read SKILL.md for a specific skill


### `POST /api/plugins/team/:agentId/start`

Start an agent via the active runtime


### `GET /api/plugins/team/:agentId/stats`

Get token usage and cost stats for an agent


### `POST /api/plugins/team/:agentId/stop`

Stop an agent


### `PUT /api/plugins/team/:agentId/team`

Assign an agent to an organizational team


### `GET /api/plugins/team/settings`

Get agent display settings


### `PUT /api/plugins/team/settings`

Update agent display settings


### `GET /api/plugins/team/teams`

List organizational teams


### `POST /api/plugins/team/teams`

Create an organizational team


### `DELETE /api/plugins/team/teams/:teamId`

Delete an organizational team


### `PUT /api/plugins/team/teams/:teamId`

Update an organizational team


### `GET /api/plugins/team/teams/:teamId/members`

List agents belonging to a team


## Plugin: workflows

Workflow runtime — enforces step-by-step agent execution with gated delivery, parallel steps, human gates, and output validation

### `GET /api/plugins/workflows/definitions`

List all workflow templates with step counts and resolved sub-workflows


### `POST /api/plugins/workflows/definitions`

Create a new user-owned workflow definition


### `DELETE /api/plugins/workflows/definitions/:name`

Delete a user-owned workflow definition


### `GET /api/plugins/workflows/definitions/:name`

Get a specific workflow definition by name


### `PUT /api/plugins/workflows/definitions/:name`

Update or shadow a workflow definition (writes user YAML)


### `POST /api/plugins/workflows/gates/:taskId/approve`

Approve a human gate step


### `POST /api/plugins/workflows/gates/:taskId/reject`

Reject a gate step, rewinds workflow


### `GET /api/plugins/workflows/gates/pending`

List all gates awaiting approval


### `GET /api/plugins/workflows/gates/status`

Batch check gate status for tasks


### `GET /api/plugins/workflows/instances`

List active workflow instances. Optional status filter.


### `GET /api/plugins/workflows/instances/:taskId`

Get full workflow instance state for a task


### `POST /api/plugins/workflows/instances/start`

Start a workflow instance for a task


### `GET /api/plugins/workflows/node-types`

List registered workflow node types (builtin + plugin-registered) for the canvas palette


### `GET /api/plugins/workflows/notification-channels`

List registered notification channels


### `GET /api/plugins/workflows/steps/:taskId`

Get current workflow step for a task


### `POST /api/plugins/workflows/steps/:taskId/complete`

Submit step output, validates against schema, advances workflow
