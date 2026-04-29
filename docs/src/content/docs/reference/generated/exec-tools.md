---
title: Exec and MCP Tool Reference
description: Generated audit reference for Bakin exec/MCP tools exposed to agents.
---

## `bakin_exec_assets_audit`

Audit asset health: check for missing thumbnails, invalid sidecars, orphaned files. Set fix=true to auto-generate missing thumbnails and create stub sidecars.

Source: `plugins/assets/index.ts:682`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_assets_delete`

Soft-delete an asset (moves to trash, restorable until trash is emptied).

Source: `plugins/assets/index.ts:597`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_assets_empty_trash`

Permanently delete all items from trash. This cannot be undone.

Source: `plugins/assets/index.ts:858`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_assets_get`

Retrieve a single asset's sidecar metadata by canonical filename.

Source: `plugins/assets/index.ts:547`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_assets_link`

Link an asset to a different task, or unlink it (set taskId to null). Sidecar-only edit — no file move.

Source: `plugins/assets/index.ts:623`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_assets_list`

List assets with optional type filter. Returns asset count, canonical filenames, and metadata.

Source: `plugins/assets/index.ts:530`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_assets_list_trash`

List trashed assets with name, size, deleted timestamp, and days remaining before auto-purge.

Source: `plugins/assets/index.ts:645`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_assets_permanent_delete`

Permanently delete a specific trashed asset. This cannot be undone.

Source: `plugins/assets/index.ts:872`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_assets_restore`

Restore a trashed asset back to its original location. Use bakin_exec_assets_list_trash first to get the filename.

Source: `plugins/assets/index.ts:665`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_assets_retype`

Change an asset's type classification. Sidecar-only edit — no file move.

Source: `plugins/assets/index.ts:812`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_assets_save`

Save an agent-created file to the assets directory with standardized naming (YYYYMMDD-slug.ext) and sidecar metadata. Handles directory creation, naming conventions, and .meta.json automatically.

Source: `plugins/assets/index.ts:577`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_assets_update_content`

Update the text content of an editable asset. Only works for text-based MIME types (markdown, plain text, YAML, JSON, CSV, XML). Rewrites the entire file.

Source: `plugins/assets/index.ts:834`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_check_gates`

Get a human-readable overview of all gate statuses in a workflow. Shows which gates are approved, waiting, or pending.

Source: `plugins/workflows/index.ts:1410`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_gen_image`

Generate an image via Gemini Imagen (Nano Banana), or import an existing image file into the asset pipeline via filePath. Default model: flash (cheaper). Use model=pro for higher quality. Default: 1080x1920 portrait (9:16) for Stories/Reels. Presets: social-portrait, social-square, social-landscape, custom. Auto-generates thumbnail. Max ${MAX_IMAGE_EDGE}px on any edge.

Source: `scripts/lib/generate-image.ts:321`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_get_paths`

Get Bakin content directory paths — where to find assets, team info, docs, etc.

Source: `scripts/lib/get-paths.ts:9`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_get_step`

Get the current workflow step as human-readable formatted text. Includes instructions, prior outputs, schema, and rejection context in a clear structure.

Source: `plugins/workflows/index.ts:1334`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_health_doctor`

Run system diagnostics (agent roster, skill sync, runtime, taskboard, assets, etc.). Returns detailed check results. Use fresh=true to force a full re-check instead of returning cached results.

Source: `plugins/health/index.ts:260`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_health_status`

Get a quick system health summary — uptime, memory, active MCP sessions, and doctor error/warning counts. Useful for checking system state before starting work.

Source: `plugins/health/index.ts:231`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_heartbeat`

Write a heartbeat signal. Call periodically (every 5-10 minutes) to indicate you are alive. Also call when starting or finishing a task.

Source: `scripts/lib/heartbeat.ts:13`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_log`

Log a formatted progress update with category and stage tags. Categories: start, progress, milestone, blocked, complete. More structured than raw bakin_exec_tasks_log_progress.

Source: `scripts/lib/log-progress.ts:45`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_memory_get_session`

Fetch a session by key plus its most recent turns.

Source: `plugins/memory/mcp/get-session.ts:23`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_memory_get_turn`

Fetch a single turn by id (the `turn:<hex>` form).

Source: `plugins/memory/mcp/get-turn.ts:23`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_memory_list_agents`

Agents with memory rows, each with total count and per-tier breakdown.

Source: `plugins/memory/mcp/list-agents.ts:20`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_memory_search`

Hybrid search across every memory tier (sessions, turns, checkpoints, daily notes, dreams, durable, audit). Optional tier/agent filters.

Source: `plugins/memory/mcp/search.ts:24`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_memory_status`

Indexer health: per-tier row counts, offset tracking, snapshot timestamp.

Source: `plugins/memory/mcp/status.ts:30`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_approve`

Approve a messaging item (draft → scheduled, review → published)

Source: `bakin-bits-official/plugins/messaging/index.ts:1072`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_create`

Create a new messaging item

Source: `bakin-bits-official/plugins/messaging/index.ts:1011`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_delete`

Delete a messaging item

Source: `bakin-bits-official/plugins/messaging/index.ts:1113`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_get`

Get details for a single messaging item

Source: `bakin-bits-official/plugins/messaging/index.ts:996`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_list`

List messaging items with optional filters

Source: `bakin-bits-official/plugins/messaging/index.ts:960`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_proposal_update`

Update a proposal status or fields (approve, reject, edit)

Source: `bakin-bits-official/plugins/messaging/index.ts:1294`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_reject`

Reject a messaging item back to draft status

Source: `bakin-bits-official/plugins/messaging/index.ts:1090`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_session_confirm`

Confirm a planning session — creates messaging items from approved proposals

Source: `bakin-bits-official/plugins/messaging/index.ts:1328`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_session_create`

Create a new planning session for an agent

Source: `bakin-bits-official/plugins/messaging/index.ts:1165`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_session_delete`

Delete a planning session

Source: `bakin-bits-official/plugins/messaging/index.ts:1208`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_session_get`

Get a planning session with full message history and proposals

Source: `bakin-bits-official/plugins/messaging/index.ts:1150`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_session_list`

List planning sessions with optional filters

Source: `bakin-bits-official/plugins/messaging/index.ts:1133`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_session_message`

Send a message in a planning session (non-streaming, returns full response)

Source: `bakin-bits-official/plugins/messaging/index.ts:1228`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_session_update`

Update a planning session title or status

Source: `bakin-bits-official/plugins/messaging/index.ts:1185`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_messaging_update`

Update a messaging item

Source: `bakin-bits-official/plugins/messaging/index.ts:1046`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_models_get_config`

Get model configuration for all agents or a specific agent. Shows effective model (own override or default), subagent model, and system defaults.

Source: `plugins/models/index.ts:753`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_models_list`

List available AI models with tier classification (budget/standard/premium). Use this to discover what models are available for assignment.

Source: `plugins/models/index.ts:734`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_post_channel`

Post a message through the active runtime channel adapter. Supports image/video attachments when the adapter supports rich content.

Source: `scripts/lib/post-channel.ts:111`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_add_item`

Add a new checklist item to a project.

Source: `bakin-bits-official/plugins/projects/index.ts:606`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_ask`

Ask an agent a question about a project. Sends the project context (spec, checklist, assets) along with the message to the agent for brainstorming.

Source: `bakin-bits-official/plugins/projects/index.ts:796`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_attach_asset`

Attach an existing asset to a project by filename. Assets provide additional context (specs, designs, docs) that agents can reference. Only summaries are included in project_get — use asset tools to read full content when needed.

Source: `bakin-bits-official/plugins/projects/index.ts:708`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_create`

Create a new project with title, markdown body, and optional initial checklist items. Returns project ID and generated task item IDs.

Source: `bakin-bits-official/plugins/projects/index.ts:539`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_delete`

Delete a project by ID.

Source: `bakin-bits-official/plugins/projects/index.ts:588`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_detach_asset`

Remove an asset reference from a project by filename. Does not delete the asset itself.

Source: `bakin-bits-official/plugins/projects/index.ts:728`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_get`

Get a project by ID including full spec, checklist, progress, and linked board task statuses.

Source: `bakin-bits-official/plugins/projects/index.ts:525`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_link_item`

Link an existing board task to a project checklist item. Use this when a task was created separately and should be associated with a project.

Source: `bakin-bits-official/plugins/projects/index.ts:660`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_list`

List all projects with optional status filter. Returns summaries with id, title, status, progress, taskCount.

Source: `bakin-bits-official/plugins/projects/index.ts:509`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_mark_item`

Mark a checklist item as checked (done) or unchecked. Returns updated progress percentage.

Source: `bakin-bits-official/plugins/projects/index.ts:621`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_promote_item`

Create a NEW board task from a project checklist item and automatically link it. The task appears on the task board with the item title and projectId set.

Source: `bakin-bits-official/plugins/projects/index.ts:684`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_remove_item`

Remove a checklist item from a project.

Source: `bakin-bits-official/plugins/projects/index.ts:641`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_toggle_item`

Toggle a checklist item checked/unchecked by item ID. Returns updated progress percentage.

Source: `bakin-bits-official/plugins/projects/index.ts:747`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_update`

Update a project's title, status, body, or owner. Cannot set status to "completed" if unchecked items remain.

Source: `bakin-bits-official/plugins/projects/index.ts:561`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_project_update_item`

Update a checklist item's title and/or description.

Source: `bakin-bits-official/plugins/projects/index.ts:768`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_schedule_briefing`

Today's schedule summary — which jobs fire, assigned agents, alerts. Designed for orchestrator daily briefing.

Source: `plugins/schedule/index.ts:851`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_schedule_create`

Create a new scheduled job that creates tasks on the board

Source: `plugins/schedule/index.ts:617`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_schedule_delete`

Delete a scheduled job

Source: `plugins/schedule/index.ts:748`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_schedule_get`

Get details for a single scheduled job

Source: `plugins/schedule/index.ts:764`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_schedule_list`

List all scheduled jobs (merged runtime cron + Bakin view)

Source: `plugins/schedule/index.ts:590`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_schedule_parse`

Parse a natural language or raw cron schedule expression

Source: `plugins/schedule/index.ts:836`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_schedule_pause`

Pause, resume, or skip runs for a scheduled job

Source: `plugins/schedule/index.ts:707`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_schedule_run_now`

Trigger an immediate run of a scheduled job

Source: `plugins/schedule/index.ts:802`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_schedule_runs`

Get run history for a scheduled job

Source: `plugins/schedule/index.ts:820`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_schedule_update`

Update an existing scheduled job

Source: `plugins/schedule/index.ts:669`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_search_facets`

Get facet value counts for a plugin. Useful for understanding data distribution (e.g., how many tasks per status).

Source: `scripts/lib/search-tools.ts:158`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_search_lookup`

Look up a specific indexed document by its key and plugin.

Source: `scripts/lib/search-tools.ts:126`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_search_query`

Search across all Bakin content (tasks, assets, projects, workflows, schedule, team, memory, messaging) or a specific plugin. Returns ranked results with scores.

Source: `scripts/lib/search-tools.ts:48`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_search_reindex`

Trigger a full reindex of all content types (or a specific plugin). Use after bulk data changes.

Source: `scripts/lib/search-tools.ts:221`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_search_similar`

Find documents similar to a given text description. Uses semantic (vector) search for meaning-based matching.

Source: `scripts/lib/search-tools.ts:187`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_search_stats`

Get search system health: enabled status, per-table document counts, and index stats.

Source: `scripts/lib/search-tools.ts:256`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_search_table`

Search a specific Bakin plugin with facet filtering. Returns results plus facet counts for filtering.

Source: `scripts/lib/search-tools.ts:90`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_submit_step`

Submit workflow step output with local pre-validation. Validates against the step schema BEFORE hitting the server, giving you detailed field-level errors without a round trip.

Source: `plugins/workflows/index.ts:1354`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_tasks_assign`

Assign a task to an agent.

Source: `plugins/tasks/index.ts:693`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_tasks_block`

Mark a task as blocked with a reason. Use when you cannot proceed.

Source: `plugins/tasks/index.ts:564`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_tasks_complete`

Report that your task is complete. Moves the task to Done and notifies the orchestrator.

Source: `plugins/tasks/index.ts:584`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_tasks_create`

Create a new task on the task board. Workflows are auto-matched by title when workflowId is not provided. Provide workflowId to force a specific workflow, or skipWorkflowReason to explicitly skip.

Source: `plugins/tasks/index.ts:493`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_tasks_delete`

Delete a task from the board.

Source: `plugins/tasks/index.ts:672`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_tasks_get`

Get details about a task — title, description, current column, logs, dependencies, project context.

Source: `plugins/tasks/index.ts:470`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_tasks_list`

List all tasks on the board. Optionally filter by column or agent.

Source: `plugins/tasks/index.ts:440`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_tasks_log_progress`

Log a human-readable progress update to the live activity feed. Call this at every significant step.

Source: `plugins/tasks/index.ts:604`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_tasks_move`

Move a task to a different column on the task board.

Source: `plugins/tasks/index.ts:539`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_tasks_set_dependency`

Register a dependency between tasks. Your task will be auto-re-dispatched when the dependency completes. After registering, exit — do not wait.

Source: `plugins/tasks/index.ts:623`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_tasks_update`

Update a task on the board — change title, description, or assigned agent.

Source: `plugins/tasks/index.ts:642`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_team_create_agent`

Create a new agent: registers it with the active runtime, writes persona files, configures dispatch permissions, optionally assigns it to a team. Returns next-step instructions.

Source: `plugins/team/index.ts:1780`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_team_delete_agent`

Remove an agent from the active runtime and clean up Bakin state. Requires confirm=true as a safety guard.

Source: `plugins/team/index.ts:1890`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_team_list`

List all agents with their current status (online/working/available/offline).

Source: `plugins/team/index.ts:1647`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_team_members`

Get agents that belong to a specific team (e.g. "builders", "creators").

Source: `plugins/team/index.ts:1735`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_team_message`

Send a message to an agent via the active runtime.

Source: `plugins/team/index.ts:1711`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_team_my_team`

Get the team that a specific agent belongs to, including all teammates.

Source: `plugins/team/index.ts:1754`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_team_org`

Get the full org structure: teams with their members. Use this to understand who is on which team and reporting lines.

Source: `plugins/team/index.ts:1725`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_team_profile`

Get the full profile for an agent including soul, rules, and tools.

Source: `plugins/team/index.ts:1667`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_team_read_file`

Read a workspace file for an agent (e.g., SOUL.md, AGENTS.md, TOOLS.md).

Source: `plugins/team/index.ts:1696`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_team_set_permissions`

Update dispatch permissions — which agents a given agent can dispatch tasks to (subagents.allowAgents).

Source: `plugins/team/index.ts:1935`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_team_status`

Get the heartbeat and health status for an agent.

Source: `plugins/team/index.ts:1681`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_team_update_identity`

Update an existing agent's identity fields (name, emoji, role, vibe, etc.) and/or workspace files (SOUL.md, TOOLS.md).

Source: `plugins/team/index.ts:1855`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_workflows_complete_step`

Complete a workflow step with output. Validates output against the step schema, advances the workflow to the next step. Returns success status and whether the workflow is complete.

Source: `plugins/workflows/index.ts:1298`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_workflows_get_definition`

Get a workflow definition by filename. Returns the full definition with steps, inputs, and resolved sub-workflows.

Source: `plugins/workflows/index.ts:1204`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_workflows_get_instance`

Get the full state of a workflow instance for a task, including step states and history.

Source: `plugins/workflows/index.ts:1270`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_workflows_get_step`

Get the current workflow step for a task. Returns only the current step (information gating — future steps are hidden). Critical for agents to know what to do next.

Source: `plugins/workflows/index.ts:1284`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_workflows_list`

List all workflow definitions (templates). Returns name, filename, description, and step count for each.

Source: `plugins/workflows/index.ts:1185`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_workflows_list_instances`

List workflow instances. Optionally filter by status (in_progress, pending_approval, complete, failed, cancelled).

Source: `plugins/workflows/index.ts:1257`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

## `bakin_exec_workflows_start`

Start a workflow instance for a task. The task must exist on the board. Returns the created instance.

Source: `plugins/workflows/index.ts:1222`

- Visibility: `public` until explicitly marked otherwise
- Stability: `beta` until a tool contract declares stability
- Contract status: `audited`

<aside class="generated-page-note" aria-label="Generated page metadata">
  <span>Generated from <code>source audit</code>.</span>
  <span>Bakin 1.0.0.</span>
  <span>A later contract pass will replace audited tool entries with explicit metadata and schemas.</span>
</aside>
