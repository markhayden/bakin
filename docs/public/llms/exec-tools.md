# Bakin MCP Tools

Docs version: Bakin 0.0.0-dev

Audience: coding agents and technical authors.

Canonical docs: https://makinbakin.com/docs/

Use MCP tools through `mcporter`:

```sh
mcporter call bakin-<agent>.<tool_name> --args '<json>'
```

Use the exact tool name shown below. Omit `--args` only for tools with no parameters.

## Assets

Asset tools let agents list, inspect, save, link, restore, and clean up files managed by Bakin.

### bakin_exec_assets_audit

Label: Audited assets
Purpose: Audit asset health: check for missing thumbnails, invalid sidecars, orphaned files. Set fix=true to auto-generate missing thumbnails and create stub sidecars.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | choice | no | Limit audit to a specific asset type |
| `fix` | boolean | no | Auto-fix issues where possible |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_assets_audit --args '{
  "type": "value",
  "fix": true
}'
```

### bakin_exec_assets_delete

Label: Deleted an asset
Purpose: Soft-delete an asset (moves to trash, restorable until trash is emptied).

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `filename` | string | yes | Canonical asset filename (e.g. "20260401-hero-a1b2c3d4.png") |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_assets_delete --args '{
  "filename": "value"
}'
```

### bakin_exec_assets_empty_trash

Label: Emptied asset trash
Purpose: Permanently delete all items from trash. This cannot be undone.

Arguments: none.

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_assets_empty_trash
```

### bakin_exec_assets_get

Label: Read asset details
Purpose: Retrieve a single asset's sidecar metadata by canonical filename.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `filename` | string | yes | Canonical asset filename (e.g. "20260401-hero-a1b2c3d4.png") |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_assets_get --args '{
  "filename": "value"
}'
```

### bakin_exec_assets_link

Label: Linked an asset
Purpose: Link an asset to a different task, or unlink it (set taskId to null). Sidecar-only edit — no file move.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `filename` | string | yes | Canonical asset filename (e.g. "20260401-hero-a1b2c3d4.png") |
| `taskId` | string | yes | Target task ID, or null to unlink |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_assets_link --args '{
  "filename": "value",
  "taskId": "value"
}'
```

### bakin_exec_assets_list

Label: Listed assets
Purpose: List assets with optional type filter. Returns asset count, canonical filenames, and metadata.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | choice | no | Filter by asset type |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_assets_list --args '{
  "type": "value"
}'
```

### bakin_exec_assets_list_trash

Label: Listed trashed assets
Purpose: List trashed assets with name, size, deleted timestamp, and days remaining before auto-purge.

Arguments: none.

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_assets_list_trash
```

### bakin_exec_assets_open

Label: Opened an asset
Purpose: Open an attached asset by canonical filename. Returns sidecar metadata plus extracted text for text-like assets; non-extractable assets return metadata-only status.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `filename` | string | yes | Canonical asset filename (e.g. "20260401-hero-a1b2c3d4.png") |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_assets_open --args '{
  "filename": "value"
}'
```

### bakin_exec_assets_permanent_delete

Label: Permanently deleted an asset
Purpose: Permanently delete a specific trashed asset. This cannot be undone.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `filename` | string | yes | The trash filename (includes __deleted- suffix) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_assets_permanent_delete --args '{
  "filename": "value"
}'
```

### bakin_exec_assets_restore

Label: Restored an asset
Purpose: Restore a trashed asset back to its original location. Use bakin_exec_assets_list_trash first to get the filename.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `filename` | string | yes | The trash filename (includes __deleted- suffix) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_assets_restore --args '{
  "filename": "value"
}'
```

### bakin_exec_assets_retype

Label: Retyped an asset
Purpose: Change an asset's type classification. Sidecar-only edit — no file move.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `filename` | string | yes | Canonical asset filename (e.g. "20260401-hero-a1b2c3d4.png") |
| `type` | choice | yes |  |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_assets_retype --args '{
  "filename": "value",
  "type": "value"
}'
```

### bakin_exec_assets_save

Label: Saved an asset
Purpose: Save an agent-created file to the assets directory with standardized naming (YYYYMMDD-slug.ext) and sidecar metadata. Handles directory creation, naming conventions, and .meta.json automatically.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `filePath` | string | yes | Absolute path to the source file to save |
| `taskId` | string | yes | Task ID to record in sidecar metadata |
| `type` | choice | yes |  |
| `description` | string | no | One-sentence summary visible in the asset grid and search. Be specific — "Q2 blog hero image" not "an image". |
| `tags` | array | no | Lowercase hyphenated tags for filtering. Use domain tags (social, blog), format tags (draft, final), and project tags. |
| `tool` | string | no | Tool used to generate (e.g., "dall-e-3", "nano-banana-pro") |
| `slug` | string | no | Custom filename slug. Auto-derived from source filename if omitted. |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_assets_save --args '{
  "filePath": "value",
  "taskId": "value",
  "type": "value",
  "description": "value",
  "tags": [
    "value"
  ],
  "tool": "value",
  "slug": "value"
}'
```

### bakin_exec_assets_update_content

Label: Updated asset content
Purpose: Update the text content of an editable asset. Only works for text-based MIME types (markdown, plain text, YAML, JSON, CSV, XML). Rewrites the entire file.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `filename` | string | yes | Canonical asset filename (e.g. "20260401-doc-a1b2c3d4.md") |
| `content` | string | yes | New file content (replaces entire file) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_assets_update_content --args '{
  "filename": "value",
  "content": "value"
}'
```

## Check

### bakin_exec_check_gates

Label: Checked workflow gates
Purpose: Get a human-readable overview of all gate statuses in a workflow. Shows which gates are approved, waiting, or pending.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID (or workflow instance ID) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_check_gates --args '{
  "taskId": "value"
}'
```

## Gen

Generation tools create or import media through Bakin so outputs land in the asset pipeline with task context.

### bakin_exec_gen_image

Label: Generated an image
Purpose: Generate an image via Gemini Imagen (Nano Banana), or import an existing image file into the asset pipeline via filePath. Default model: flash (cheaper). Use model=pro for higher quality. Default: 1080x1920 portrait (9:16) for Stories/Reels. Presets: social-portrait, social-square, social-landscape, custom. Auto-generates thumbnail. Max ${MAX_IMAGE_EDGE}px on any edge.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `prompt` | string | no | Image generation prompt (required for Gemini generation, optional description for raw file import) |
| `filePath` | string | no | Path to an existing image file to import through the asset pipeline (skips Gemini generation) |
| `taskId` | string | yes | Task ID for asset organization |
| `preset` | choice | no | Size preset (default: social-portrait = 1080x1920) |
| `width` | number | no | Custom width (only when preset=custom, max ${MAX_IMAGE_EDGE}) |
| `height` | number | no | Custom height (only when preset=custom, max ${MAX_IMAGE_EDGE}) |
| `model` | choice | no | Model tier: flash (default, cheaper) or pro (higher quality) |
| `thumbnail` | boolean | no | Generate a 400px WebP thumbnail for UI previews (default: true) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_gen_image --args '{
  "prompt": "value",
  "filePath": "value",
  "taskId": "value",
  "preset": "value",
  "width": 20,
  "height": 20,
  "model": "value",
  "thumbnail": true
}'
```

## Get

Runtime lookup tools return local Bakin paths and state agents should not hardcode.

### bakin_exec_get_paths

Label: Resolved paths
Purpose: Get Bakin content directory paths — where to find assets, team info, docs, etc.

Arguments: none.

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_get_paths
```

### bakin_exec_get_step

Label: Read workflow step
Purpose: Get the current workflow step as human-readable formatted text. Includes instructions, prior outputs, schema, and rejection context in a clear structure.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_get_step --args '{
  "taskId": "value"
}'
```

## Git

### bakin_exec_git_prepare_worktree

Label: Prepared git worktree
Purpose: Create or reuse an isolated git worktree for a task. Call this before editing code for a Bakin task.

Arguments: none.

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_git_prepare_worktree
```

### bakin_exec_git_release_worktree

Label: Released git worktree
Purpose: Release a tracked git worktree. Refuses dirty removal unless force=true.

Arguments: none.

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_git_release_worktree
```

### bakin_exec_git_status

Label: Checked git worktrees
Purpose: List Bakin-tracked git worktrees and their dirty state.

Arguments: none.

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_git_status
```

## Health

Health tools let agents check whether Bakin is running correctly before or during work.

### bakin_exec_health_doctor

Label: Ran diagnostics
Purpose: Run system diagnostics (agent roster, skill sync, runtime, taskboard, assets, etc.). Returns detailed check results. Use fresh=true to force a full re-check instead of returning cached results.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `fresh` | boolean | no | Force fresh diagnostics instead of cached results |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_health_doctor --args '{
  "fresh": true
}'
```

### bakin_exec_health_status

Label: Checked system health
Purpose: Get a quick system health summary — uptime, memory, active MCP sessions, and doctor error/warning counts. Useful for checking system state before starting work.

Arguments: none.

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_health_status
```

## Heartbeat

Heartbeat tools let agents publish lightweight status so Bakin can show who is active and what they are doing.

### bakin_exec_heartbeat

Label: Sent heartbeat
Purpose: Write a heartbeat signal. Call periodically (every 5-10 minutes) to indicate you are alive. Also call when starting or finishing a task.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | choice | no | Current status |
| `currentTask` | string | no | Task ID currently being worked on |
| `message` | string | no | Brief status note |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_heartbeat --args '{
  "status": "value",
  "currentTask": "value",
  "message": "value"
}'
```

## Lesson

### bakin_exec_lesson_search

Label: Searched package lessons
Purpose: Search the enabled agent-package lessons for the calling agent.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | string | yes | Search query |
| `limit` | number | no | Max lessons to return (default from settings, max 10) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_lesson_search --args '{
  "query": "value",
  "limit": 20
}'
```

## Log

Logging tools record progress updates in Bakin task history and audit surfaces.

### bakin_exec_log

Label: Logged message
Purpose: Log a formatted progress update with category and stage tags. Categories: start, progress, milestone, blocked, complete. More structured than raw bakin_exec_tasks_log_progress.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |
| `message` | string | yes | Human-readable status update |
| `category` | choice | no | Log category (default: progress) |
| `stage` | string | no | Workflow stage tag (e.g., "image-gen", "copy-review") |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_log --args '{
  "taskId": "value",
  "message": "value",
  "category": "value",
  "stage": "value"
}'
```

## Memory

Memory tools expose indexed runtime memory, sessions, turns, checkpoints, and status to agents.

### bakin_exec_memory_get_session

Label: Read session memory
Purpose: Fetch a session by key plus its most recent turns.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionKey` | string | yes | Session key (required) |
| `agent` | string | no | Narrow to a single agent |
| `turnLimit` | number | no | Max turns to include (default 50) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_memory_get_session --args '{
  "sessionKey": "value",
  "agent": "value",
  "turnLimit": 20
}'
```

### bakin_exec_memory_get_turn

Label: Read turn memory
Purpose: Fetch a single turn by id (the `turn:<hex>` form).

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `turnId` | string | yes | Turn id (required, e.g. turn:abc123...) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_memory_get_turn --args '{
  "turnId": "value"
}'
```

### bakin_exec_memory_list_agents

Label: Listed memory agents
Purpose: Agents with memory rows, each with total count and per-tier breakdown.

Arguments: none.

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_memory_list_agents
```

### bakin_exec_memory_search

Label: Searched memory
Purpose: Hybrid search across every memory tier (sessions, turns, checkpoints, daily notes, dreams, durable, audit). Optional tier/agent filters.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | string | no | Search query (required) |
| `agent` | string | no | Filter to a single agent id |
| `limit` | number | no | Max results (default 20, max 100) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_memory_search --args '{
  "query": "value",
  "agent": "value",
  "limit": 20
}'
```

### bakin_exec_memory_status

Label: Read memory status
Purpose: Indexer health: per-tier row counts, offset tracking, snapshot timestamp.

Arguments: none.

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_memory_status
```

## Messaging

Messaging tools let agents create, update, approve, reject, and inspect human-facing messages and sessions.

### bakin_exec_messaging_approve

Label: Approved a message
Purpose: Approve a messaging item (draft → scheduled, review → published)

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `itemId` | string | yes | Item ID (required) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_approve --args '{
  "itemId": "value"
}'
```

### bakin_exec_messaging_create

Label: Created a message
Purpose: Create a new messaging item

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | string | yes | Item title (required) |
| `agent` | string | yes | Assigned agent (required) |
| `scheduledAt` | string | yes | ISO datetime for scheduling (required) |
| `channels` | array | no | Runtime channel IDs (default: ["general"]) |
| `contentType` | string | no | Content type id from the messaging contentTypes setting (e.g. post, article, video) |
| `tone` | string | no | Content tone (energetic, calm, educational, etc.) |
| `brief` | string | no | Content brief |
| `status` | string | no | Initial status (default: draft) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_create --args '{
  "title": "value",
  "agent": "value",
  "scheduledAt": "value",
  "channels": [
    "value"
  ],
  "contentType": "value",
  "tone": "value",
  "brief": "value",
  "status": "value"
}'
```

### bakin_exec_messaging_delete

Label: Deleted a message
Purpose: Delete a messaging item

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `itemId` | string | yes | Item ID (required) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_delete --args '{
  "itemId": "value"
}'
```

### bakin_exec_messaging_get

Label: Read message details
Purpose: Get details for a single messaging item

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `itemId` | string | yes | Item ID (required) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_get --args '{
  "itemId": "value"
}'
```

### bakin_exec_messaging_list

Label: Listed messages
Purpose: List messaging items with optional filters

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `month` | string | no | Filter by month (YYYY-MM) |
| `status` | string | no | Filter by status (draft, scheduled, review, published, etc.) |
| `agent` | string | no | Filter by assigned agent |
| `channel` | string | no | Filter by runtime channel ID (e.g. general, announcements) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_list --args '{
  "month": "value",
  "status": "value",
  "agent": "value",
  "channel": "value"
}'
```

### bakin_exec_messaging_proposal_update

Label: Updated brainstorm proposal
Purpose: Update a proposal status or fields (approve, reject, edit)

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Session ID (required) |
| `proposalId` | string | yes | Proposal ID (required) |
| `status` | string | no | New status (proposed, approved, rejected, revised) |
| `title` | string | no | Updated title |
| `brief` | string | no | Updated brief |
| `tone` | string | no | Updated tone |
| `scheduledAt` | string | no | Updated schedule datetime |
| `channels` | array | no | Updated channels |
| `rejectionNote` | string | no | Note explaining rejection |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_proposal_update --args '{
  "sessionId": "value",
  "proposalId": "value",
  "status": "value",
  "title": "value",
  "brief": "value",
  "tone": "value",
  "scheduledAt": "value",
  "channels": [
    "value"
  ],
  "rejectionNote": "value"
}'
```

### bakin_exec_messaging_reject

Label: Rejected a message
Purpose: Reject a messaging item back to draft status

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `itemId` | string | yes | Item ID (required) |
| `note` | string | no | Rejection note / feedback |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_reject --args '{
  "itemId": "value",
  "note": "value"
}'
```

### bakin_exec_messaging_session_confirm

Label: Confirmed brainstorm proposal
Purpose: Confirm a planning session — creates messaging items from approved proposals

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Session ID (required) |
| `autoApprove` | boolean | no | Auto-approve: create items in scheduled status instead of draft |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_session_confirm --args '{
  "sessionId": "value",
  "autoApprove": true
}'
```

### bakin_exec_messaging_session_create

Label: Created brainstorm session
Purpose: Create a new planning session for an agent

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Agent ID (required) |
| `title` | string | no | Session title |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_session_create --args '{
  "agentId": "value",
  "title": "value"
}'
```

### bakin_exec_messaging_session_delete

Label: Deleted brainstorm session
Purpose: Delete a planning session

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Session ID (required) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_session_delete --args '{
  "sessionId": "value"
}'
```

### bakin_exec_messaging_session_get

Label: Read brainstorm session
Purpose: Get a planning session with full message history and proposals

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Session ID (required) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_session_get --args '{
  "sessionId": "value"
}'
```

### bakin_exec_messaging_session_list

Label: Listed brainstorm sessions
Purpose: List planning sessions with optional filters

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | string | no | Filter by status (active, completed) |
| `agentId` | string | no | Filter by agent ID |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_session_list --args '{
  "status": "value",
  "agentId": "value"
}'
```

### bakin_exec_messaging_session_message

Label: Sent brainstorm message
Purpose: Send a message in a planning session (non-streaming, returns full response)

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Session ID (required) |
| `message` | string | yes | User message content (required) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_session_message --args '{
  "sessionId": "value",
  "message": "value"
}'
```

### bakin_exec_messaging_session_update

Label: Updated brainstorm session
Purpose: Update a planning session title or status

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Session ID (required) |
| `title` | string | no | New title |
| `status` | string | no | New status (active, completed) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_session_update --args '{
  "sessionId": "value",
  "title": "value",
  "status": "value"
}'
```

### bakin_exec_messaging_update

Label: Updated a message
Purpose: Update a messaging item

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `itemId` | string | yes | Item ID (required) |
| `title` | string | no | New title |
| `scheduledAt` | string | no | New schedule datetime |
| `status` | string | no | New status |
| `brief` | string | no | Updated brief |
| `tone` | string | no | Updated tone |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_messaging_update --args '{
  "itemId": "value",
  "title": "value",
  "scheduledAt": "value",
  "status": "value",
  "brief": "value",
  "tone": "value"
}'
```

## Models

Model tools expose model configuration and available model choices to agents.

### bakin_exec_models_get_config

Label: Read model config
Purpose: Get model configuration for all agents or a specific agent. Shows effective model (own override or default), subagent model, and system defaults.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | no | Specific agent ID to query (omit for all agents) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_models_get_config --args '{
  "agentId": "value"
}'
```

### bakin_exec_models_list

Label: Listed models
Purpose: List available AI models with tier classification (budget/standard/premium). Use this to discover what models are available for assignment.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `tier` | choice | no | Filter by model tier |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_models_list --args '{
  "tier": "value"
}'
```

## Post

Publishing tools send completed work to configured channels through Bakin adapters.

### bakin_exec_post_channel

Label: Posted to channel
Purpose: Post a message through the active runtime channel adapter. Supports image/video attachments when the adapter supports rich content.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `channel` | string | yes | Channel name or runtime channel target |
| `content` | string | yes | Message text / caption |
| `imageFilename` | string | no | Asset filename resolved via the assets index. |
| `videoFilename` | string | no | Asset filename resolved via the assets index. |
| `embed` | record | no | Optional rich metadata for adapters that support it |
| `taskId` | string | no | Task ID for audit trail |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_post_channel --args '{
  "channel": "value",
  "content": "value",
  "imageFilename": "value",
  "videoFilename": "value",
  "embed": {
    "key": "value"
  },
  "taskId": "value"
}'
```

## Projects

### bakin_exec_projects_add_item

Label: Added project item
Purpose: Add a new checklist item to a project.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `title` | string | yes | Checklist item title |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_add_item --args '{
  "projectId": "value",
  "title": "value"
}'
```

### bakin_exec_projects_apply_plan

Label: Applied a project plan
Purpose: Apply a confirmed project plan update in one operation. Use this after the user confirms exact body/checklist changes so agents do not need shell scripts or multiple low-level calls.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `title` | string | no | Optional new project title |
| `status` | choice | no | Optional new status |
| `body` | string | no | Replacement markdown body for the project plan |
| `appendBody` | string | no | Markdown to append to the existing project body; cannot be combined with body |
| `owner` | string | no | Optional new owner |
| `checklistItems` | array | no | New unchecked checklist item titles to append |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_apply_plan --args '{
  "projectId": "value",
  "title": "value",
  "status": "value",
  "body": "value",
  "appendBody": "value",
  "owner": "value",
  "checklistItems": [
    "value"
  ]
}'
```

### bakin_exec_projects_ask

Label: Asked project question
Purpose: Ask an agent a question about a project. Sends the project context (spec, checklist, assets) along with the message to the agent for brainstorming.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `message` | string | yes | Question or prompt for the agent |
| `agent` | string | no | Agent ID to ask (defaults to main) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_ask --args '{
  "projectId": "value",
  "message": "value",
  "agent": "value"
}'
```

### bakin_exec_projects_attach_asset

Label: Attached asset to project
Purpose: Attach an existing asset to a project by filename. Assets provide additional context (specs, designs, docs) that agents can reference. Only summaries are included in projects_get — use asset tools to read full content when needed.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `filename` | string | yes | Asset filename (e.g., "20260327-hero-a1b2c3d4.png") — globally unique, stable across retype/relink |
| `label` | string | no | Human-readable label or summary of what this asset contains |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_attach_asset --args '{
  "projectId": "value",
  "filename": "value",
  "label": "value"
}'
```

### bakin_exec_projects_create

Label: Created a project
Purpose: Create a new project with title, markdown body, and optional initial checklist items. Returns project ID and generated task item IDs.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | string | yes | Project title |
| `body` | string | no | Markdown body (spec/plan) |
| `owner` | string | no | Project owner |
| `tasks` | array | no | Initial checklist item titles |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_create --args '{
  "title": "value",
  "body": "value",
  "owner": "value",
  "tasks": [
    "value"
  ]
}'
```

### bakin_exec_projects_delete

Label: Deleted a project
Purpose: Delete a project by ID.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_delete --args '{
  "projectId": "value"
}'
```

### bakin_exec_projects_detach_asset

Label: Detached asset from project
Purpose: Remove an asset reference from a project by filename. Does not delete the asset itself.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `filename` | string | yes | Asset filename to detach |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_detach_asset --args '{
  "projectId": "value",
  "filename": "value"
}'
```

### bakin_exec_projects_get

Label: Read project details
Purpose: Get a project by ID including full spec, checklist, progress, and linked board task statuses.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_get --args '{
  "projectId": "value"
}'
```

### bakin_exec_projects_link_item

Label: Linked project item
Purpose: Link an existing board task to a project checklist item. Use this when a task was created separately and should be associated with a project.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `taskItemId` | string | yes | Checklist item ID |
| `taskId` | string | yes | Board task ID to link |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_link_item --args '{
  "projectId": "value",
  "taskItemId": "value",
  "taskId": "value"
}'
```

### bakin_exec_projects_list

Label: Listed projects
Purpose: List all projects with optional status filter. Returns summaries with id, title, status, progress, taskCount.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | choice | no | Filter by status |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_list --args '{
  "status": "value"
}'
```

### bakin_exec_projects_mark_item

Label: Marked project item
Purpose: Mark a checklist item as checked (done) or unchecked. Returns updated progress percentage.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `taskItemId` | string | yes | Checklist item ID (e.g., t001) |
| `checked` | boolean | yes | true to mark as done, false to uncheck |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_mark_item --args '{
  "projectId": "value",
  "taskItemId": "value",
  "checked": true
}'
```

### bakin_exec_projects_promote_item

Label: Promoted project item
Purpose: Create a NEW board task from a project checklist item and automatically link it. The task appears on the task board with the item title and projectId set.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `taskItemId` | string | yes | Checklist item ID to promote to a board task |
| `assignee` | string | no | Agent to assign the task to |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_promote_item --args '{
  "projectId": "value",
  "taskItemId": "value",
  "assignee": "value"
}'
```

### bakin_exec_projects_remove_item

Label: Removed project item
Purpose: Remove a checklist item from a project.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `taskItemId` | string | yes | Checklist item ID to remove |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_remove_item --args '{
  "projectId": "value",
  "taskItemId": "value"
}'
```

### bakin_exec_projects_toggle_item

Label: Toggled project item
Purpose: Toggle a checklist item checked/unchecked by item ID. Returns updated progress percentage.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `itemId` | string | yes | Checklist item ID (e.g., t001) |
| `checked` | boolean | yes | true to mark as done, false to uncheck |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_toggle_item --args '{
  "projectId": "value",
  "itemId": "value",
  "checked": true
}'
```

### bakin_exec_projects_update

Label: Updated a project
Purpose: Update a project's title, status, body, or owner. Cannot set status to "completed" if unchecked items remain.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `title` | string | no | New title |
| `status` | choice | no | New status |
| `body` | string | no | New markdown body |
| `owner` | string | no | New owner |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_update --args '{
  "projectId": "value",
  "title": "value",
  "status": "value",
  "body": "value",
  "owner": "value"
}'
```

### bakin_exec_projects_update_item

Label: Updated project item
Purpose: Update a checklist item's title and/or description.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `itemId` | string | yes | Checklist item ID (e.g., t001) |
| `title` | string | no | New title for the checklist item |
| `description` | string | no | New description for the checklist item |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_projects_update_item --args '{
  "projectId": "value",
  "itemId": "value",
  "title": "value",
  "description": "value"
}'
```

## Schedule

Schedule tools let agents create, inspect, pause, run, and update recurring Bakin jobs.

### bakin_exec_schedule_briefing

Label: Generated schedule briefing
Purpose: Today's schedule summary — which jobs fire, assigned agents, alerts. Designed for orchestrator daily briefing.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `date` | string | no | ISO date to check (defaults to today) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_schedule_briefing --args '{
  "date": "value"
}'
```

### bakin_exec_schedule_create

Label: Created a scheduled job
Purpose: Create a new scheduled job that creates tasks on the board

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Job name (required) |
| `schedule` | string | yes | Schedule expression: NL ("every day at 9am") or raw cron ("0 9 * * *") (required) |
| `agentId` | string | no | Agent to assign tasks to |
| `workflowId` | string | no | Workflow to attach to tasks |
| `taskPrompt` | string | no | Task description template |
| `taskTitle` | string | no | Task title template (supports {date}, {agent}) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_schedule_create --args '{
  "name": "value",
  "schedule": "value",
  "agentId": "value",
  "workflowId": "value",
  "taskPrompt": "value",
  "taskTitle": "value"
}'
```

### bakin_exec_schedule_delete

Label: Deleted a scheduled job
Purpose: Delete a scheduled job

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | string | yes | Job ID (required) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_schedule_delete --args '{
  "jobId": "value"
}'
```

### bakin_exec_schedule_get

Label: Read schedule details
Purpose: Get details for a single scheduled job

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | string | yes | Job ID (required) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_schedule_get --args '{
  "jobId": "value"
}'
```

### bakin_exec_schedule_list

Label: Listed scheduled jobs
Purpose: List all scheduled jobs (merged runtime cron + Bakin view)

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `filter` | choice | no | Filter by job type |
| `agentId` | string | no | Filter by assigned agent |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_schedule_list --args '{
  "filter": "value",
  "agentId": "value"
}'
```

### bakin_exec_schedule_parse

Label: Parsed cron expression
Purpose: Parse a natural language or raw cron schedule expression

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | string | yes | Schedule expression to parse (required) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_schedule_parse --args '{
  "input": "value"
}'
```

### bakin_exec_schedule_pause

Label: Paused a scheduled job
Purpose: Pause, resume, or skip runs for a scheduled job

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | string | yes | Job ID (required) |
| `action` | choice | yes | Action to take (required) |
| `pauseUntil` | string | no | ISO date to auto-resume (for pause action) |
| `skipN` | number | no | Number of runs to skip (for skip action) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_schedule_pause --args '{
  "jobId": "value",
  "action": "value",
  "pauseUntil": "value",
  "skipN": 20
}'
```

### bakin_exec_schedule_run_now

Label: Triggered scheduled job
Purpose: Trigger an immediate run of a scheduled job

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | string | yes | Job ID (required) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_schedule_run_now --args '{
  "jobId": "value"
}'
```

### bakin_exec_schedule_runs

Label: Listed schedule runs
Purpose: Get run history for a scheduled job

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | string | yes | Job ID (required) |
| `limit` | number | no | Max runs to return (default 50) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_schedule_runs --args '{
  "jobId": "value",
  "limit": 20
}'
```

### bakin_exec_schedule_update

Label: Updated a scheduled job
Purpose: Update an existing scheduled job

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | string | yes | Job ID (required) |
| `name` | string | no | New job name |
| `schedule` | string | no | New schedule expression |
| `agentId` | string | no | New agent assignment |
| `workflowId` | string | no | New workflow binding |
| `taskPrompt` | string | no | New task prompt template |
| `taskTitle` | string | no | New task title template |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_schedule_update --args '{
  "jobId": "value",
  "name": "value",
  "schedule": "value",
  "agentId": "value",
  "workflowId": "value",
  "taskPrompt": "value",
  "taskTitle": "value"
}'
```

## Search

Search tools query Bakin-indexed content across plugins or inside a specific surface.

### bakin_exec_search_facets

Label: Search facets
Purpose: Get facet value counts for a plugin. Useful for understanding data distribution (e.g., how many tasks per status).

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `plugin` | string | yes | Plugin id (tasks, assets, projects, etc.) |
| `facets` | string | yes | Comma-separated facet fields (e.g., "status,agent") |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_search_facets --args '{
  "plugin": "value",
  "facets": "value"
}'
```

### bakin_exec_search_lookup

Label: Search lookup
Purpose: Look up a specific indexed document by its key and plugin.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `plugin` | string | yes | Plugin id (tasks, assets, projects, etc.) |
| `key` | string | yes | Document key to look up |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_search_lookup --args '{
  "plugin": "value",
  "key": "value"
}'
```

### bakin_exec_search_query

Label: Search
Purpose: Search across all Bakin content (tasks, assets, projects, workflows, schedule, team, memory, messaging) or a specific plugin. Returns ranked results with scores.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `q` | string | no | Search query text |
| `limit` | number | no | Maximum results to return (default: 20) |
| `offset` | number | no | Skip this many results (for pagination) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_search_query --args '{
  "q": "value",
  "limit": 20,
  "offset": 20
}'
```

### bakin_exec_search_reindex

Label: Reindex search
Purpose: Trigger a full reindex of all content types (or a specific plugin). Use after bulk data changes.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `plugin` | string | no | Specific plugin id to reindex (optional — omit for all) |
| `rebuild` | boolean | no | Drop and recreate indexes before reindexing (default: false) |
| `verify` | boolean | no | Re-query tables after reindex to verify doc counts (default: false) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_search_reindex --args '{
  "plugin": "value",
  "rebuild": true,
  "verify": true
}'
```

### bakin_exec_search_similar

Label: Find similar
Purpose: Find documents similar to a given text description. Uses semantic (vector) search for meaning-based matching.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `text` | string | yes | Text to find similar documents for |
| `plugin` | string | no | Limit to a specific plugin id (optional) |
| `limit` | number | no | Maximum results (default: 10) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_search_similar --args '{
  "text": "value",
  "plugin": "value",
  "limit": 20
}'
```

### bakin_exec_search_stats

Label: Search stats
Purpose: Get search system health: enabled status, per-table document counts, and index stats.

Arguments: none.

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_search_stats
```

### bakin_exec_search_table

Label: Search plugin
Purpose: Search a specific Bakin plugin with facet filtering. Returns results plus facet counts for filtering.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `q` | string | no | Search query text |
| `limit` | number | no | Maximum results (default: 20) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_search_table --args '{
  "q": "value",
  "limit": 20
}'
```

## Submit

Workflow submission tools let agents submit step output back to the workflow engine.

### bakin_exec_submit_step

Label: Submitted workflow step
Purpose: Submit workflow step output with local pre-validation. Validates against the step schema BEFORE hitting the server, giving you detailed field-level errors without a round trip.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |
| `stepId` | string | yes | Step ID to submit for |
| `output` | record | yes | JSON output matching the step schema |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_submit_step --args '{
  "taskId": "value",
  "stepId": "value",
  "output": {
    "key": "value"
  }
}'
```

## Tasks

Task tools are the main agent interface for creating, reading, moving, logging, blocking, and completing work.

### bakin_exec_tasks_assign

Label: Assigned a task
Purpose: Assign a task to an agent.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |
| `agent` | string | yes | Agent to assign the task to |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_tasks_assign --args '{
  "taskId": "value",
  "agent": "value"
}'
```

### bakin_exec_tasks_block

Label: Blocked a task
Purpose: Mark a task as blocked with a reason. Use when you cannot proceed.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |
| `reason` | string | yes | Why the task is blocked |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_tasks_block --args '{
  "taskId": "value",
  "reason": "value"
}'
```

### bakin_exec_tasks_complete

Label: Completed a task
Purpose: Report that your task is complete. Moves the task to Done and notifies the orchestrator.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |
| `summary` | string | yes | Summary of what you accomplished |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_tasks_complete --args '{
  "taskId": "value",
  "summary": "value"
}'
```

### bakin_exec_tasks_create

Label: Created a task
Purpose: Create a new task on the task board. Workflows are auto-matched by title when workflowId is not provided. Provide workflowId to force a specific workflow, or skipWorkflowReason to explicitly skip.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | string | yes | Task title |
| `assignee` | string | no | Agent to assign (chef, pixel, rolo, patch, trainer, etc.) |
| `description` | string | no | Task description and context |
| `parentId` | string | no | Parent task ID if this is a subtask |
| `workflowId` | string | no | Workflow to start (e.g. image-social-post, video-script). Use bakin_exec_workflows_list to see options. |
| `skipWorkflowReason` | string | no | Reason no workflow applies (required if workflowId is not set and this is not a subtask) |
| `projectId` | string | no | Project ID to link this task to |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_tasks_create --args '{
  "title": "value",
  "assignee": "value",
  "description": "value",
  "parentId": "value",
  "workflowId": "value",
  "skipWorkflowReason": "value",
  "projectId": "value"
}'
```

### bakin_exec_tasks_delete

Label: Deleted a task
Purpose: Delete a task from the board.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_tasks_delete --args '{
  "taskId": "value"
}'
```

### bakin_exec_tasks_get

Label: Read task details
Purpose: Get details about a task — title, description, current column, logs, dependencies, project context.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_tasks_get --args '{
  "taskId": "value"
}'
```

### bakin_exec_tasks_list

Label: Listed tasks
Purpose: List all tasks on the board. Optionally filter by column or agent.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `column` | choice | no | Filter by column |
| `agent` | string | no | Filter by assigned agent |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_tasks_list --args '{
  "column": "value",
  "agent": "value"
}'
```

### bakin_exec_tasks_log_progress

Label: Logged progress
Purpose: Log a human-readable progress update to the live activity feed. Call this at every significant step.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID (e.g. "fe84ac51") |
| `message` | string | yes | Human-readable status update |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_tasks_log_progress --args '{
  "taskId": "value",
  "message": "value"
}'
```

### bakin_exec_tasks_move

Label: Moved a task
Purpose: Move a task to a different column on the task board.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |
| `to` | choice | yes | Target column |
| `reason` | string | no | Required when moving to "blocked" |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_tasks_move --args '{
  "taskId": "value",
  "to": "value",
  "reason": "value"
}'
```

### bakin_exec_tasks_set_dependency

Label: Set task dependency
Purpose: Register a dependency between tasks. Your task will be auto-re-dispatched when the dependency completes. After registering, exit — do not wait.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Your task ID (the one that depends) |
| `dependsOn` | string | yes | Task ID you depend on |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_tasks_set_dependency --args '{
  "taskId": "value",
  "dependsOn": "value"
}'
```

### bakin_exec_tasks_update

Label: Updated a task
Purpose: Update a task on the board — change title, description, or assigned agent.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |
| `title` | string | no | New task title |
| `description` | string | no | New task description |
| `agent` | string | no | New assigned agent |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_tasks_update --args '{
  "taskId": "value",
  "title": "value",
  "description": "value",
  "agent": "value"
}'
```

## Team

Team tools expose agent roster, identity, status, messaging, and permission operations.

### bakin_exec_team_create_agent

Label: Created agent
Purpose: Create a new agent: registers it with the active runtime, writes persona files, configures dispatch permissions, optionally assigns it to a team. Returns next-step instructions.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | no | Agent ID (lowercase alphanumeric + hyphens). Auto-derived from name if omitted. |
| `name` | string | yes | Display name (e.g. "Jessica Fetcher") |
| `emoji` | string | no | Single emoji (e.g. "🔎") |
| `role` | string | no | One-line role description |
| `vibe` | string | no | Personality vibe |
| `primaryFunction` | string | no | What the agent does |
| `defaultMode` | string | no | How the agent operates by default |
| `model` | string | no | Full provider/model string. Uses default if omitted. |
| `soul` | string | no | Raw markdown for SOUL.md |
| `tools` | string | no | Raw markdown for TOOLS.md |
| `teamId` | string | no | Bakin team to assign the agent to |
| `dispatchable` | union | no | Who can dispatch tasks to this agent. Default: "main". |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_team_create_agent --args '{
  "id": "value",
  "name": "value",
  "emoji": "value",
  "role": "value",
  "vibe": "value",
  "primaryFunction": "value",
  "defaultMode": "value",
  "model": "value",
  "soul": "value",
  "tools": "value",
  "teamId": "value",
  "dispatchable": "value"
}'
```

### bakin_exec_team_delete_agent

Label: Deleted agent
Purpose: Remove an agent from the active runtime and clean up Bakin state. Requires confirm=true as a safety guard.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Agent to delete |
| `confirm` | boolean | yes | Must be true — safety guard against accidental deletion |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_team_delete_agent --args '{
  "agentId": "value",
  "confirm": true
}'
```

### bakin_exec_team_list

Label: Listed team
Purpose: List all agents with their current status (online/working/available/offline).

Arguments: none.

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_team_list
```

### bakin_exec_team_members

Label: Listed team members
Purpose: Get agents that belong to a specific team (e.g. "builders", "creators").

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `teamId` | string | yes | Team ID (e.g. "builders", "creators") |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_team_members --args '{
  "teamId": "value"
}'
```

### bakin_exec_team_message

Label: Sent a message
Purpose: Send a message to an agent via the active runtime.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Agent ID |
| `message` | string | yes | Message to send |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_team_message --args '{
  "agentId": "value",
  "message": "value"
}'
```

### bakin_exec_team_my_team

Label: Read own team
Purpose: Get the team that a specific agent belongs to, including all teammates.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Agent ID |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_team_my_team --args '{
  "agentId": "value"
}'
```

### bakin_exec_team_org

Label: Read organization
Purpose: Get the full org structure: teams with their members. Use this to understand who is on which team and reporting lines.

Arguments: none.

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_team_org
```

### bakin_exec_team_profile

Label: Read agent profile
Purpose: Get the full profile for an agent including soul, rules, and tools.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Agent ID |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_team_profile --args '{
  "agentId": "value"
}'
```

### bakin_exec_team_read_file

Label: Read agent file
Purpose: Read a workspace file for an agent (e.g., SOUL.md, AGENTS.md, TOOLS.md).

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Agent ID |
| `filename` | string | yes | File name (e.g., SOUL.md) |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_team_read_file --args '{
  "agentId": "value",
  "filename": "value"
}'
```

### bakin_exec_team_set_permissions

Label: Updated permissions
Purpose: Update dispatch permissions — which agents a given agent can dispatch tasks to (subagents.allowAgents).

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Agent whose allowAgents to modify |
| `allowAgents` | array | yes | Full replacement list of agent IDs this agent can dispatch to |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_team_set_permissions --args '{
  "agentId": "value",
  "allowAgents": [
    "value"
  ]
}'
```

### bakin_exec_team_status

Label: Checked agent status
Purpose: Get the heartbeat and health status for an agent.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Agent ID |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_team_status --args '{
  "agentId": "value"
}'
```

### bakin_exec_team_update_identity

Label: Updated agent identity
Purpose: Update an existing agent's identity fields (name, emoji, role, vibe, etc.) and/or workspace files (SOUL.md, TOOLS.md).

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Target agent ID |
| `name` | string | no | New display name |
| `emoji` | string | no | New emoji |
| `role` | string | no | Updated role |
| `vibe` | string | no | Updated vibe |
| `primaryFunction` | string | no | Updated primary function |
| `defaultMode` | string | no | Updated default mode |
| `soul` | string | no | Replace SOUL.md content |
| `tools` | string | no | Replace TOOLS.md content |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_team_update_identity --args '{
  "agentId": "value",
  "name": "value",
  "emoji": "value",
  "role": "value",
  "vibe": "value",
  "primaryFunction": "value",
  "defaultMode": "value",
  "soul": "value",
  "tools": "value"
}'
```

## Workflows

Workflow tools expose workflow definitions, active instances, current steps, and step completion.

### bakin_exec_workflows_complete_step

Label: Completed workflow step
Purpose: Complete a workflow step with output. Validates output against the step schema, advances the workflow to the next step. Returns success status and whether the workflow is complete.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |
| `stepId` | string | yes | Step ID to complete |
| `output` | record | yes | Step output object |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_workflows_complete_step --args '{
  "taskId": "value",
  "stepId": "value",
  "output": {
    "key": "value"
  }
}'
```

### bakin_exec_workflows_get_definition

Label: Read workflow definition
Purpose: Get a workflow definition by filename. Returns the full definition with steps, inputs, and resolved sub-workflows.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Workflow definition filename (e.g. "content-pipeline") |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_workflows_get_definition --args '{
  "name": "value"
}'
```

### bakin_exec_workflows_get_instance

Label: Read workflow instance
Purpose: Get the full state of a workflow instance for a task, including step states and history.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_workflows_get_instance --args '{
  "taskId": "value"
}'
```

### bakin_exec_workflows_get_step

Label: Read workflow step
Purpose: Get the current workflow step for a task. Returns only the current step (information gating — future steps are hidden). Critical for agents to know what to do next.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_workflows_get_step --args '{
  "taskId": "value"
}'
```

### bakin_exec_workflows_list

Label: Listed workflows
Purpose: List all workflow definitions (templates). Returns name, filename, description, and step count for each.

Arguments: none.

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_workflows_list
```

### bakin_exec_workflows_list_instances

Label: Listed workflow runs
Purpose: List workflow instances. Optionally filter by status (in_progress, pending_approval, complete, failed, cancelled).

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | choice | no | Filter by instance status |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_workflows_list_instances --args '{
  "status": "value"
}'
```

### bakin_exec_workflows_start

Label: Started a workflow
Purpose: Start a workflow instance for a task. The task must exist on the board. Returns the created instance.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID to start workflow for |
| `workflowId` | string | yes | Workflow definition filename |

Example:

```sh
mcporter call bakin-<agent>.bakin_exec_workflows_start --args '{
  "taskId": "value",
  "workflowId": "value"
}'
```
