# Bakin MCP Tools

Docs version: Bakin 0.0.0-dev

Audience: coding agents and technical authors.

Canonical docs: https://makinbakin.com/docs/

Call Bakin exec tools by name with structured JSON arguments. HOW a tool is
invoked (bare in-process call, native MCP prefix, shell shim) depends on the
active runtime — each agent's Tool access section carries the exact form.

```sh
<tool_name> <json arguments>
```

Use the exact tool name shown below. Tools with no parameters take no arguments.

## Assets

Asset tools let agents list, inspect, save, link, restore, and clean up files managed by Bakin.

### bakin_exec_assets_audit

Label: Audited assets
Purpose: Audit versioned-asset health: manifest integrity, current-pointer resolution, and missing version files.

Arguments: none.

Example:

```sh
bakin_exec_assets_audit
```

### bakin_exec_assets_consolidate

Label: Consolidated variant assets
Purpose: Absorb variant assets as versions of a winner asset (select-best flows): each loser's current file becomes a new version of the winner with consolidatedFrom provenance, the winner's pre-call current version stays promoted, and the losers move to trash. End state: ONE asset, every variant preserved as version history. Safe to re-call — already-absorbed losers are skipped and the version pointer is never moved by a retry.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `winnerAssetId` | string | yes | The selected (winning) asset id — absorbs the others |
| `loserAssetIds` | array | yes | The variant asset ids to absorb, in display order |
| `taskId` | string | yes | Task ID this consolidation belongs to |

Example:

```sh
bakin_exec_assets_consolidate {
  "winnerAssetId": "value",
  "loserAssetIds": [
    "value"
  ],
  "taskId": "value"
}
```

### bakin_exec_assets_delete

Label: Deleted an asset
Purpose: Soft-delete a whole asset (all versions) to trash, restorable until trash is emptied.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `assetId` | string | yes | Asset id |

Example:

```sh
bakin_exec_assets_delete {
  "assetId": "value"
}
```

### bakin_exec_assets_empty_trash

Label: Emptied asset trash
Purpose: Permanently delete all trashed assets. This cannot be undone.

Arguments: none.

Example:

```sh
bakin_exec_assets_empty_trash
```

### bakin_exec_assets_get

Label: Read asset details
Purpose: Retrieve an asset manifest (versions, current pointer, exports) by assetId.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `assetId` | string | yes | Asset id, e.g. "20260401-hero-a1b2c3d4" |

Example:

```sh
bakin_exec_assets_get {
  "assetId": "value"
}
```

### bakin_exec_assets_import

Label: Imported unmanaged files
Purpose: Explicitly import unmanaged files into managed versioned assets. Pass path (content-dir relative, e.g. assets/inbox/pic.png) or all: true. Optional type override and taskId link.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | string | no | One unmanaged file to import (content-dir relative) |
| `all` | boolean | no | Import every unmanaged file |
| `type` | choice | no | Override the suggested asset type |
| `taskId` | string | no | Link the imported asset(s) to this task |

Example:

```sh
bakin_exec_assets_import {
  "path": "value",
  "all": true,
  "type": "value",
  "taskId": "value"
}
```

### bakin_exec_assets_link

Label: Linked an asset
Purpose: Link an asset to a different task, or unlink it (set taskId to null).

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `assetId` | string | yes | Asset id |
| `taskId` | string | yes | Target task ID, or null to unlink |

Example:

```sh
bakin_exec_assets_link {
  "assetId": "value",
  "taskId": "value"
}
```

### bakin_exec_assets_list

Label: Listed assets
Purpose: List managed assets (one entry per asset, current-version view). Optional type, task, and tag filters. Tags are the UI "folders" — pass tags to list a folder, e.g. ["brand"].

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | choice | no | Filter by asset type |
| `taskId` | string | no | Filter to assets linked to this task id |
| `tags` | array | no | Filter to assets carrying ALL of these tags (the UI "folders"). |

Example:

```sh
bakin_exec_assets_list {
  "type": "value",
  "taskId": "value",
  "tags": [
    "value"
  ]
}
```

### bakin_exec_assets_list_trash

Label: Listed trashed assets
Purpose: List trashed assets (whole-asset deletions) with deletion time and version count.

Arguments: none.

Example:

```sh
bakin_exec_assets_list_trash
```

### bakin_exec_assets_open

Label: Opened an asset
Purpose: Open an asset by assetId: returns its manifest plus the current version’s extracted text for text-like assets.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `assetId` | string | yes | Asset id |

Example:

```sh
bakin_exec_assets_open {
  "assetId": "value"
}
```

### bakin_exec_assets_permanent_delete

Label: Permanently deleted an asset
Purpose: Permanently delete a specific trashed asset. This cannot be undone.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `trashName` | string | yes | Trash name (includes __deleted- suffix) |

Example:

```sh
bakin_exec_assets_permanent_delete {
  "trashName": "value"
}
```

### bakin_exec_assets_restore

Label: Restored an asset
Purpose: Restore a trashed asset by its trash name (from bakin_exec_assets_list_trash).

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `trashName` | string | yes | Trash name (includes __deleted- suffix) |

Example:

```sh
bakin_exec_assets_restore {
  "trashName": "value"
}
```

### bakin_exec_assets_retype

Label: Retyped an asset
Purpose: Change an asset type classification.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `assetId` | string | yes | Asset id |
| `type` | choice | yes |  |

Example:

```sh
bakin_exec_assets_retype {
  "assetId": "value",
  "type": "value"
}
```

### bakin_exec_assets_save

Label: Saved an asset
Purpose: Save an agent-created file as a managed, versioned asset. Re-saving the SAME source file appends a new version to the existing asset (or no-ops if unchanged) instead of creating a duplicate — so an evolving doc stays one asset with a version history. Returns the asset id.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `filePath` | string | yes | Absolute path to the source file to save. Re-saving the same path versions the existing asset. |
| `taskId` | string | yes | Task ID to link the asset. |
| `type` | choice | yes |  |
| `description` | string | no | One-sentence summary visible in the asset grid and search. Be specific. |
| `tags` | array | no | Lowercase hyphenated tags for filtering. |
| `tool` | string | no | Tool used to generate or import the asset. |
| `slug` | string | no | Custom slug for the asset id. Auto-derived from source filename if omitted. |

Example:

```sh
bakin_exec_assets_save {
  "filePath": "value",
  "taskId": "value",
  "type": "value",
  "description": "value",
  "tags": [
    "value"
  ],
  "tool": "value",
  "slug": "value"
}
```

### bakin_exec_assets_scan_unmanaged

Label: Scanned for unmanaged files
Purpose: List files under assets/ that are NOT managed assets (inbox drops, loose files). Nothing is imported automatically — use bakin_exec_assets_import to import.

Arguments: none.

Example:

```sh
bakin_exec_assets_scan_unmanaged
```

## Brands

### bakin_exec_brands_add_lesson

Label: Added a brand lesson
Purpose: Bank a brand learning from this task (e.g. "thread format flopped on LinkedIn — use single posts"). Append-only: the ONLY write agents may make to a published brand. Absolute always-rules belong in the brand's Rules list (ask the operator), not lessons.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `brandId` | string | yes | Brand id |
| `title` | string | yes | Short lesson title |
| `body` | string | yes | The lesson: what happened, what to do instead |

Example:

```sh
bakin_exec_brands_add_lesson {
  "brandId": "value",
  "title": "value",
  "body": "value"
}
```

### bakin_exec_brands_get

Label: Read a brand
Purpose: Full brand view: palette, absolute rules, terminology, logos, asset groups, guideline/lesson doc listings (with descriptions), and the content fingerprint. Use read_doc to fetch a doc body.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `brandId` | string | yes | Brand id (see bakin_exec_brands_list) |

Example:

```sh
bakin_exec_brands_get {
  "brandId": "value"
}
```

### bakin_exec_brands_list

Label: Listed brands
Purpose: List all published brands (id, name, description). Drafts are excluded.

Arguments: none.

Example:

```sh
bakin_exec_brands_list
```

### bakin_exec_brands_read_doc

Label: Read a brand doc
Purpose: Read one guideline or lesson markdown body for a brand.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `brandId` | string | yes | Brand id |
| `kind` | choice | yes | Doc kind |
| `name` | string | yes | Doc filename, e.g. style-guide.md |

Example:

```sh
bakin_exec_brands_read_doc {
  "brandId": "value",
  "kind": "value",
  "name": "value"
}
```

### bakin_exec_brands_update_manifest

Label: Updated a draft-brand manifest
Purpose: DRAFT BRANDS ONLY (builder flow): set description, palette, rules, terminology, and/or cardDocs while authoring a brand. Typed error on published brands.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `brandId` | string | yes | Draft brand id |
| `description` | string | no | One-line brand description |
| `palette` | array | no | Structured colors [{name, hex, usage?}] |
| `rules` | array | no | Absolute imperatives, e.g. "Never use emojis" |
| `terminology` | array | no | Do/don't term pairs [{term, rule}] |
| `cardDocs` | array | no | Guideline filenames inlined into the dispatch card |

Example:

```sh
bakin_exec_brands_update_manifest {
  "brandId": "value",
  "description": "value",
  "palette": [
    "value"
  ],
  "rules": [
    "value"
  ],
  "terminology": [
    "value"
  ],
  "cardDocs": [
    "value"
  ]
}
```

### bakin_exec_brands_write_doc

Label: Wrote a draft-brand doc
Purpose: DRAFT BRANDS ONLY (builder flow): write a guideline or lesson doc while authoring a brand. Typed error on published brands — live brand identity is operator-only.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `brandId` | string | yes | Draft brand id |
| `kind` | choice | yes | Doc kind |
| `name` | string | yes | Doc filename ending in .md, e.g. voice.md |
| `content` | string | yes | Full markdown content (frontmatter description: recommended) |

Example:

```sh
bakin_exec_brands_write_doc {
  "brandId": "value",
  "kind": "value",
  "name": "value",
  "content": "value"
}
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
bakin_exec_check_gates {
  "taskId": "value"
}
```

## Get

Runtime lookup tools return local Bakin paths and state agents should not hardcode.

### bakin_exec_get_paths

Label: Resolved paths
Purpose: Get Bakin content directory paths — where to find assets, team info, docs, etc.

Arguments: none.

Example:

```sh
bakin_exec_get_paths
```

### bakin_exec_get_step

Label: Read workflow step
Purpose: Get the current workflow step as human-readable formatted text. Includes instructions, prior outputs, schema, and rejection context in a clear structure.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |

Example:

```sh
bakin_exec_get_step {
  "taskId": "value"
}
```

## Git

### bakin_exec_git_prepare_worktree

Label: Prepared git worktree
Purpose: Create or reuse an isolated git worktree for a task. Call this before editing code for a Bakin task.

Arguments: none.

Example:

```sh
bakin_exec_git_prepare_worktree
```

### bakin_exec_git_release_worktree

Label: Released git worktree
Purpose: Release a tracked git worktree. Refuses dirty removal unless force=true.

Arguments: none.

Example:

```sh
bakin_exec_git_release_worktree
```

### bakin_exec_git_status

Label: Checked git worktrees
Purpose: List Bakin-tracked git worktrees and their dirty state.

Arguments: none.

Example:

```sh
bakin_exec_git_status
```

## Health

Health tools let agents check whether Bakin is running correctly before or during work.

### bakin_exec_health_doctor

Label: Ran diagnostics
Purpose: Return the canonical Health report. Use fresh=true to join or start a full diagnostic sweep first.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `fresh` | boolean | no | Force fresh diagnostics instead of cached results |

Example:

```sh
bakin_exec_health_doctor {
  "fresh": true
}
```

### bakin_exec_health_status

Label: Checked system health
Purpose: Get a quick canonical system health summary with uptime, memory, connected session count, activity failures, and incident counts.

Arguments: none.

Example:

```sh
bakin_exec_health_status
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
bakin_exec_heartbeat {
  "status": "value",
  "currentTask": "value",
  "message": "value"
}
```

## Images

### bakin_exec_images_edit

Label: Edited an image
Purpose: Edit a managed image asset (by assetId) through the runtime image provider — edits the current version, appends a NEW VERSION to that same asset, and returns the assetId. Pass referenceImages to supply extra context images alongside the edited asset.

Arguments: none.

Example:

```sh
bakin_exec_images_edit
```

### bakin_exec_images_export

Label: Exported an image
Purpose: Export an existing image asset to a target surface profile by resizing, cropping, and format-converting it.

Arguments: none.

Example:

```sh
bakin_exec_images_export
```

### bakin_exec_images_generate

Label: Generated an image
Purpose: Generate an image through a configured runtime image provider, save it as a NEW managed asset (v1), and return its assetId. Pass referenceImages to create a new image conditioned on existing assets/files (e.g. "in the style of these"); to revise an existing asset in place use bakin_exec_images_edit instead. In an interactive chat: omit taskId and, after it returns, deliver the image by embedding ![desc](/api/assets/<assetId>) in your reply — text alone delivers nothing.

Arguments: none.

Example:

```sh
bakin_exec_images_generate
```

### bakin_exec_images_import

Label: Imported an image
Purpose: Import an existing local image file as a new managed asset (v1) and return its assetId.

Arguments: none.

Example:

```sh
bakin_exec_images_import
```

### bakin_exec_images_profiles

Label: Listed image profiles
Purpose: List image surface profiles and configured provider readiness. Use this before choosing dimensions or provider routes for image generation.

Arguments: none.

Example:

```sh
bakin_exec_images_profiles
```

### bakin_exec_images_recommend

Label: Recommended an image route
Purpose: Recommend a deterministic image provider, model, surface profile, dimensions, and quality tier for an image generation request.

Arguments: none.

Example:

```sh
bakin_exec_images_recommend
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
bakin_exec_lesson_search {
  "query": "value",
  "limit": 20
}
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
bakin_exec_log {
  "taskId": "value",
  "message": "value",
  "category": "value",
  "stage": "value"
}
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
bakin_exec_memory_get_session {
  "sessionKey": "value",
  "agent": "value",
  "turnLimit": 20
}
```

### bakin_exec_memory_get_turn

Label: Read turn memory
Purpose: Fetch a single turn by id (the `turn:<hex>` form).

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `turnId` | string | yes | Turn id (required, e.g. turn:abc123...) |

Example:

```sh
bakin_exec_memory_get_turn {
  "turnId": "value"
}
```

### bakin_exec_memory_list_agents

Label: Listed memory agents
Purpose: Agents with memory rows, each with total count and per-tier breakdown.

Arguments: none.

Example:

```sh
bakin_exec_memory_list_agents
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
bakin_exec_memory_search {
  "query": "value",
  "agent": "value",
  "limit": 20
}
```

### bakin_exec_memory_status

Label: Read memory status
Purpose: Indexer health: per-tier row counts, offset tracking, snapshot timestamp.

Arguments: none.

Example:

```sh
bakin_exec_memory_status
```

## Messaging

Messaging tools let agents create, update, approve, reject, and inspect human-facing messages and sessions.

### bakin_exec_messaging_deliverable_approve

Label: Approved content deliverable
Purpose: Approve a Deliverable after review.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `deliverableId` | string | yes | Deliverable ID (required) |

Example:

```sh
bakin_exec_messaging_deliverable_approve {
  "deliverableId": "value"
}
```

### bakin_exec_messaging_deliverable_create

Label: Created content deliverable
Purpose: Create a Quick Post Deliverable. Plan Deliverables are created only by Plan activation.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `planId` | union | no | Optional Plan ID; null creates a Quick Post |
| `channel` | string | yes | Runtime channel ID |
| `contentType` | string | yes | Messaging content type ID |
| `tone` | string | yes | Tone |
| `agent` | string | yes | Prep agent |
| `title` | string | yes | Deliverable title |
| `brief` | string | yes | Deliverable brief |
| `publishAt` | string | yes | Publish datetime |
| `prepStartAt` | string | no | Optional explicit prep start datetime |
| `prepStartAtOverride` | string | no | Optional prep start override datetime |
| `status` | string | no | Optional initial status; defaults to planned |
| `draft` | object | no | Optional draft fields |

Example:

```sh
bakin_exec_messaging_deliverable_create {
  "planId": "value",
  "channel": "value",
  "contentType": "value",
  "tone": "value",
  "agent": "value",
  "title": "value",
  "brief": "value",
  "publishAt": "value",
  "prepStartAt": "value",
  "prepStartAtOverride": "value",
  "status": "value",
  "draft": {
    "key": "value"
  }
}
```

### bakin_exec_messaging_deliverable_get

Label: Read content deliverable
Purpose: Get a content Deliverable

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `deliverableId` | string | yes | Deliverable ID (required) |

Example:

```sh
bakin_exec_messaging_deliverable_get {
  "deliverableId": "value"
}
```

### bakin_exec_messaging_deliverable_list

Label: Listed content deliverables
Purpose: List content Deliverables with optional filters

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `planId` | union | no | Filter by Plan ID; null returns Quick Posts |
| `status` | string | no | Filter by Deliverable status |
| `channel` | string | no | Filter by channel |
| `publishAfter` | string | no | Filter by publishAt at or after this date |
| `publishBefore` | string | no | Filter by publishAt at or before this date |

Example:

```sh
bakin_exec_messaging_deliverable_list {
  "planId": "value",
  "status": "value",
  "channel": "value",
  "publishAfter": "value",
  "publishBefore": "value"
}
```

### bakin_exec_messaging_deliverable_ready_for_review

Label: Marked content deliverable ready for review
Purpose: Signal that a bare-task Deliverable draft is ready for user review or auto-approval.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `deliverableId` | string | yes | Deliverable ID (required) |

Example:

```sh
bakin_exec_messaging_deliverable_ready_for_review {
  "deliverableId": "value"
}
```

### bakin_exec_messaging_deliverable_reject

Label: Rejected content deliverable
Purpose: Request changes for a Deliverable after review.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `deliverableId` | string | yes | Deliverable ID (required) |
| `note` | string | no | Review note for the prep agent |

Example:

```sh
bakin_exec_messaging_deliverable_reject {
  "deliverableId": "value",
  "note": "value"
}
```

### bakin_exec_messaging_deliverable_update

Label: Updated content deliverable
Purpose: Update a content Deliverable. Draft fields are deep-merged.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `deliverableId` | string | yes | Deliverable ID (required) |
| `planId` | union | no | Optional Plan ID; null makes it a Quick Post |
| `channel` | string | no | Runtime channel ID |
| `contentType` | string | no | Messaging content type ID |
| `tone` | string | no | Tone |
| `agent` | string | no | Prep agent |
| `title` | string | no | Deliverable title |
| `brief` | string | no | Deliverable brief |
| `publishAt` | string | no | Publish datetime |
| `prepStartAt` | string | no | Optional explicit prep start datetime |
| `prepStartAtOverride` | string | no | Optional prep start override datetime |
| `status` | string | no | Deliverable status |
| `rejectionNote` | string | no | Optional rejection note |
| `draft` | object | no | Draft fields to deep-merge |

Example:

```sh
bakin_exec_messaging_deliverable_update {
  "deliverableId": "value",
  "planId": "value",
  "channel": "value",
  "contentType": "value",
  "tone": "value",
  "agent": "value",
  "title": "value",
  "brief": "value",
  "publishAt": "value",
  "prepStartAt": "value",
  "prepStartAtOverride": "value",
  "status": "value",
  "rejectionNote": "value",
  "draft": {
    "key": "value"
  }
}
```

### bakin_exec_messaging_plan_activate

Label: Activated content plan
Purpose: Activate a content Plan and create scheduled kickoff tasks for its configured channels.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `planId` | string | yes | Plan ID (required) |

Example:

```sh
bakin_exec_messaging_plan_activate {
  "planId": "value"
}
```

### bakin_exec_messaging_plan_channel_delete

Label: Deleted content plan channel
Purpose: Delete one configured Plan channel, its Deliverables, and linked board tasks.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `planId` | string | yes | Plan ID (required) |
| `channelId` | string | yes | Plan channel ID (required) |
| `deleteLinkedTasks` | boolean | no | Delete linked board tasks; defaults to true |

Example:

```sh
bakin_exec_messaging_plan_channel_delete {
  "planId": "value",
  "channelId": "value",
  "deleteLinkedTasks": true
}
```

### bakin_exec_messaging_plan_create

Label: Created content plan
Purpose: Create a content Plan

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | string | yes | Plan title |
| `targetDate` | string | yes | Target ISO date |
| `agent` | string | yes | Lead agent |
| `brief` | string | no | Plan brief |
| `campaign` | string | no | Campaign tag |
| `channels` | array | yes |  |
| `id` | string | no |  |
| `channel` | string | yes |  |
| `contentType` | string | yes |  |
| `publishAt` | string | yes |  |
| `prepStartAt` | string | no |  |
| `workflowId` | string | no |  |
| `agent` | string | no |  |
| `tone` | string | no |  |
| `title` | string | no |  |
| `brief` | string | no | Concrete channel deliverables to create when the Plan is activated |

Example:

```sh
bakin_exec_messaging_plan_create {
  "title": "value",
  "targetDate": "value",
  "agent": "value",
  "brief": "value",
  "campaign": "value",
  "channels": [
    "value"
  ],
  "id": "value",
  "channel": "value",
  "contentType": "value",
  "publishAt": "value",
  "prepStartAt": "value",
  "workflowId": "value",
  "tone": "value"
}
```

### bakin_exec_messaging_plan_delete

Label: Deleted content plan
Purpose: Delete a content Plan, its content pieces, and linked board tasks.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `planId` | string | yes | Plan ID (required) |
| `deleteLinkedTasks` | boolean | no | Delete linked board tasks; defaults to true |

Example:

```sh
bakin_exec_messaging_plan_delete {
  "planId": "value",
  "deleteLinkedTasks": true
}
```

### bakin_exec_messaging_plan_get

Label: Read content plan
Purpose: Get a content Plan and its Deliverables

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `planId` | string | yes | Plan ID (required) |

Example:

```sh
bakin_exec_messaging_plan_get {
  "planId": "value"
}
```

### bakin_exec_messaging_plan_list

Label: Listed content plans
Purpose: List content Plans with optional filters

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | string | no | Filter by Plan status |
| `agent` | string | no | Filter by lead agent |
| `campaign` | string | no | Filter by campaign |

Example:

```sh
bakin_exec_messaging_plan_list {
  "status": "value",
  "agent": "value",
  "campaign": "value"
}
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
| `targetDate` | string | no | Updated Plan target date |
| `suggestedChannels` | array | no | Updated suggested channels |
| `rejectionNote` | string | no | Note explaining rejection |

Example:

```sh
bakin_exec_messaging_proposal_update {
  "sessionId": "value",
  "proposalId": "value",
  "status": "value",
  "title": "value",
  "brief": "value",
  "targetDate": "value",
  "suggestedChannels": [
    "value"
  ],
  "rejectionNote": "value"
}
```

### bakin_exec_messaging_session_create

Label: Created brainstorm session
Purpose: Create a new planning session for an agent

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Agent ID (required) |
| `title` | string | no | Session title |
| `scope` | string | no | Optional brainstorm scope |

Example:

```sh
bakin_exec_messaging_session_create {
  "agentId": "value",
  "title": "value",
  "scope": "value"
}
```

### bakin_exec_messaging_session_delete

Label: Deleted brainstorm session
Purpose: Delete a planning session without deleting Plans prepared from it.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Session ID (required) |

Example:

```sh
bakin_exec_messaging_session_delete {
  "sessionId": "value"
}
```

### bakin_exec_messaging_session_get

Label: Read brainstorm session
Purpose: Get a planning session with full message history and proposals

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Session ID (required) |

Example:

```sh
bakin_exec_messaging_session_get {
  "sessionId": "value"
}
```

### bakin_exec_messaging_session_list

Label: Listed brainstorm sessions
Purpose: List planning sessions with optional filters

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | string | no | Filter by status (active, archived) |
| `agentId` | string | no | Filter by agent ID |

Example:

```sh
bakin_exec_messaging_session_list {
  "status": "value",
  "agentId": "value"
}
```

### bakin_exec_messaging_session_materialize

Label: Prepared Plans from brainstorm proposals
Purpose: Prepare Plans from accepted brainstorm proposals

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Session ID (required) |

Example:

```sh
bakin_exec_messaging_session_materialize {
  "sessionId": "value"
}
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
bakin_exec_messaging_session_message {
  "sessionId": "value",
  "message": "value"
}
```

### bakin_exec_messaging_session_update

Label: Updated brainstorm session
Purpose: Update a planning session title or status

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | yes | Session ID (required) |
| `title` | string | no | New title |
| `status` | string | no | New status (active, archived) |

Example:

```sh
bakin_exec_messaging_session_update {
  "sessionId": "value",
  "title": "value",
  "status": "value"
}
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
bakin_exec_models_get_config {
  "agentId": "value"
}
```

### bakin_exec_models_list

Label: Listed models
Purpose: List available AI models with tier classification (budget/standard/premium). Use this to discover what models are available for assignment.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `tier` | choice | no | Filter by model tier |

Example:

```sh
bakin_exec_models_list {
  "tier": "value"
}
```

## Post

Publishing tools send completed work to configured channels through Bakin adapters.

### bakin_exec_post_channel

Label: Posted to channel
Purpose: Post a message through the active runtime channel adapter. Supports image/video attachments when the adapter supports rich content. Oversized images are downscaled automatically for the channel (as a derived export of the same asset) — pass the original asset id; do NOT create a separate, smaller asset just to post it.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `channel` | string | yes | Channel name or runtime channel target |
| `content` | string | yes | Message text / caption |
| `imageAssetId` | string | no | Asset id of an image to attach. The current version is sent, or an auto-downscaled export if it exceeds the channel attachment limit (no separate asset is created). |
| `videoAssetId` | string | no | Asset id of a video to attach (current version is sent). |
| `embed` | record | no | Optional rich metadata for adapters that support it |
| `taskId` | string | no | Task ID for audit trail |
| `repost` | boolean | no | An attached asset is delivered to a channel once per task; set true ONLY when a second copy is genuinely intended. |

Example:

```sh
bakin_exec_post_channel {
  "channel": "value",
  "content": "value",
  "imageAssetId": "value",
  "videoAssetId": "value",
  "embed": {
    "key": "value"
  },
  "taskId": "value",
  "repost": true
}
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
bakin_exec_projects_add_item {
  "projectId": "value",
  "title": "value"
}
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
bakin_exec_projects_apply_plan {
  "projectId": "value",
  "title": "value",
  "status": "value",
  "body": "value",
  "appendBody": "value",
  "owner": "value",
  "checklistItems": [
    "value"
  ]
}
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
bakin_exec_projects_ask {
  "projectId": "value",
  "message": "value",
  "agent": "value"
}
```

### bakin_exec_projects_attach_asset

Label: Attached asset to project
Purpose: Attach an existing asset to a project by assetId. Assets provide additional context (specs, designs, docs) that agents can reference. Only summaries are included in projects_get — use asset tools to read full content when needed.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `assetId` | string | yes | Asset id (e.g., "20260327-hero-a1b2c3d4") — stable across versions |
| `label` | string | no | Human-readable label or summary of what this asset contains |

Example:

```sh
bakin_exec_projects_attach_asset {
  "projectId": "value",
  "assetId": "value",
  "label": "value"
}
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
bakin_exec_projects_create {
  "title": "value",
  "body": "value",
  "owner": "value",
  "tasks": [
    "value"
  ]
}
```

### bakin_exec_projects_delete

Label: Deleted a project
Purpose: Delete a project by ID.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |

Example:

```sh
bakin_exec_projects_delete {
  "projectId": "value"
}
```

### bakin_exec_projects_detach_asset

Label: Detached asset from project
Purpose: Remove an asset reference from a project by assetId. Does not delete the asset itself.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `assetId` | string | yes | Asset id to detach |

Example:

```sh
bakin_exec_projects_detach_asset {
  "projectId": "value",
  "assetId": "value"
}
```

### bakin_exec_projects_get

Label: Read project details
Purpose: Get a project by ID including full spec, checklist, progress, and linked board task statuses.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |

Example:

```sh
bakin_exec_projects_get {
  "projectId": "value"
}
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
bakin_exec_projects_link_item {
  "projectId": "value",
  "taskItemId": "value",
  "taskId": "value"
}
```

### bakin_exec_projects_list

Label: Listed projects
Purpose: List all projects with optional status filter. Returns summaries with id, title, status, progress, taskCount.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | choice | no | Filter by status |

Example:

```sh
bakin_exec_projects_list {
  "status": "value"
}
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
bakin_exec_projects_mark_item {
  "projectId": "value",
  "taskItemId": "value",
  "checked": true
}
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
bakin_exec_projects_promote_item {
  "projectId": "value",
  "taskItemId": "value",
  "assignee": "value"
}
```

### bakin_exec_projects_relink_asset

Label: Relinked project asset
Purpose: Replace an attached project asset reference with another existing asset. Use this to repair missing or deleted asset references without removing the project context.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Project ID |
| `assetId` | string | yes | Current asset id attached to the project |
| `newAssetId` | string | yes | Replacement asset id to attach in its place |
| `label` | string | no | Optional replacement label. If omitted, the existing project label is preserved. |

Example:

```sh
bakin_exec_projects_relink_asset {
  "projectId": "value",
  "assetId": "value",
  "newAssetId": "value",
  "label": "value"
}
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
bakin_exec_projects_remove_item {
  "projectId": "value",
  "taskItemId": "value"
}
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
bakin_exec_projects_toggle_item {
  "projectId": "value",
  "itemId": "value",
  "checked": true
}
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
bakin_exec_projects_update {
  "projectId": "value",
  "title": "value",
  "status": "value",
  "body": "value",
  "owner": "value"
}
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
bakin_exec_projects_update_item {
  "projectId": "value",
  "itemId": "value",
  "title": "value",
  "description": "value"
}
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
bakin_exec_schedule_briefing {
  "date": "value"
}
```

### bakin_exec_schedule_create

Label: Created a scheduled job
Purpose: Create a new scheduled job that creates tasks on the board

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Job name (required) |
| `schedule` | string | yes | Schedule expression: NL ("every day at 9am") or raw cron ("0 9 * * *") (required) |
| `agentId` | string | no | Agent to assign tasks to. Mutually exclusive with teamId. |
| `teamId` | string | no | Team to assign — each occurrence is routed to the best-suited member at fire time (#189). Mutually exclusive with agentId. |
| `workflowId` | string | no | Workflow to attach to tasks |
| `taskPrompt` | string | no | Task description template |
| `taskTitle` | string | no | Task title template (supports {date}, {agent}) |

Example:

```sh
bakin_exec_schedule_create {
  "name": "value",
  "schedule": "value",
  "agentId": "value",
  "teamId": "value",
  "workflowId": "value",
  "taskPrompt": "value",
  "taskTitle": "value"
}
```

### bakin_exec_schedule_delete

Label: Deleted a scheduled job
Purpose: Delete a scheduled job

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | string | yes | Job ID (required) |

Example:

```sh
bakin_exec_schedule_delete {
  "jobId": "value"
}
```

### bakin_exec_schedule_get

Label: Read schedule details
Purpose: Get details for a single scheduled job

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | string | yes | Job ID (required) |

Example:

```sh
bakin_exec_schedule_get {
  "jobId": "value"
}
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
bakin_exec_schedule_list {
  "filter": "value",
  "agentId": "value"
}
```

### bakin_exec_schedule_parse

Label: Parsed cron expression
Purpose: Parse a natural language or raw cron schedule expression

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | string | yes | Schedule expression to parse (required) |

Example:

```sh
bakin_exec_schedule_parse {
  "input": "value"
}
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
bakin_exec_schedule_pause {
  "jobId": "value",
  "action": "value",
  "pauseUntil": "value",
  "skipN": 20
}
```

### bakin_exec_schedule_run_now

Label: Triggered scheduled job
Purpose: Trigger an immediate run of a scheduled job

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | string | yes | Job ID (required) |

Example:

```sh
bakin_exec_schedule_run_now {
  "jobId": "value"
}
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
bakin_exec_schedule_runs {
  "jobId": "value",
  "limit": 20
}
```

### bakin_exec_schedule_update

Label: Updated a scheduled job
Purpose: Update an existing scheduled job

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `jobId` | string | yes | Job ID (required) |
| `name` | string | no | New job name |
| `schedule` | string | no | New schedule expression |
| `agentId` | string | no | New agent assignment. Setting a non-empty agent clears any team; mutually exclusive with teamId. |
| `teamId` | string | no | New team assignment (#189). Setting a non-empty team clears any agent; mutually exclusive with agentId. |
| `workflowId` | string | no | New workflow binding |
| `taskPrompt` | string | no | New task prompt template |
| `taskTitle` | string | no | New task title template |

Example:

```sh
bakin_exec_schedule_update {
  "jobId": "value",
  "name": "value",
  "schedule": "value",
  "agentId": "value",
  "teamId": "value",
  "workflowId": "value",
  "taskPrompt": "value",
  "taskTitle": "value"
}
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
bakin_exec_search_facets {
  "plugin": "value",
  "facets": "value"
}
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
bakin_exec_search_lookup {
  "plugin": "value",
  "key": "value"
}
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
bakin_exec_search_query {
  "q": "value",
  "limit": 20,
  "offset": 20
}
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
bakin_exec_search_reindex {
  "plugin": "value",
  "rebuild": true,
  "verify": true
}
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
bakin_exec_search_similar {
  "text": "value",
  "plugin": "value",
  "limit": 20
}
```

### bakin_exec_search_stats

Label: Search stats
Purpose: Get search system health: enabled status, per-table document counts, and index stats.

Arguments: none.

Example:

```sh
bakin_exec_search_stats
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
bakin_exec_search_table {
  "q": "value",
  "limit": 20
}
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
bakin_exec_submit_step {
  "taskId": "value",
  "stepId": "value",
  "output": {
    "key": "value"
  }
}
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
bakin_exec_tasks_assign {
  "taskId": "value",
  "agent": "value"
}
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
bakin_exec_tasks_block {
  "taskId": "value",
  "reason": "value"
}
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
bakin_exec_tasks_complete {
  "taskId": "value",
  "summary": "value"
}
```

### bakin_exec_tasks_create

Label: Created a task
Purpose: Create a new task on the task board. Workflows are auto-matched by title when workflowId is not provided. Provide workflowId to force a specific workflow, or skipWorkflowReason to explicitly skip.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | string | yes | Task title |
| `assignee` | string | no | Agent to assign (chef, pixel, rolo, patch, trainer, etc.). Mutually exclusive with team. |
| `team` | string | no | Team to assign — Bakin routes the task to the best-suited member at dispatch (use bakin_exec_team_org to see teams). Mutually exclusive with assignee. |
| `description` | string | no | Task description and context |
| `parentId` | string | no | Parent task ID if this is a subtask |
| `workflowId` | string | no | Workflow to start (e.g. image-social-post, video-script). Use bakin_exec_workflows_list to see options. |
| `skipWorkflowReason` | string | no | Reason no workflow applies (required if workflowId is not set and this is not a subtask) |
| `projectId` | string | no | Project ID to link this task to |
| `brandId` | string | no | Brand ID this task's output must follow (see bakin_exec_brands_list). Omit to inherit from the parent task or project. |
| `availableAt` | string | no | ISO timestamp before which dispatch should not pick up the task |
| `dueAt` | string | no | ISO timestamp representing the task deadline or target delivery time |
| `sourcePluginId` | string | no | Plugin that owns the source entity for this task |
| `sourceEntityType` | string | no | Source entity type, such as plan or deliverable |
| `sourceEntityId` | string | no | Source entity ID |
| `sourcePurpose` | string | no | Source purpose, such as kickoff or publish |

Example:

```sh
bakin_exec_tasks_create {
  "title": "value",
  "assignee": "value",
  "team": "value",
  "description": "value",
  "parentId": "value",
  "workflowId": "value",
  "skipWorkflowReason": "value",
  "projectId": "value",
  "brandId": "value",
  "availableAt": "value",
  "dueAt": "value",
  "sourcePluginId": "value",
  "sourceEntityType": "value",
  "sourceEntityId": "value",
  "sourcePurpose": "value"
}
```

### bakin_exec_tasks_delete

Label: Deleted a task
Purpose: Delete a task from the board.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |

Example:

```sh
bakin_exec_tasks_delete {
  "taskId": "value"
}
```

### bakin_exec_tasks_get

Label: Read task details
Purpose: Get details about a task — title, description, current column, logs, dependencies, project context.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |

Example:

```sh
bakin_exec_tasks_get {
  "taskId": "value"
}
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
bakin_exec_tasks_list {
  "column": "value",
  "agent": "value"
}
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
bakin_exec_tasks_log_progress {
  "taskId": "value",
  "message": "value"
}
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
bakin_exec_tasks_move {
  "taskId": "value",
  "to": "value",
  "reason": "value"
}
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
bakin_exec_tasks_set_dependency {
  "taskId": "value",
  "dependsOn": "value"
}
```

### bakin_exec_tasks_update

Label: Updated a task
Purpose: Update a task on the board — change title, description, or assigned agent.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |
| `title` | string | no | New task title |
| `description` | string | no | New task description |
| `agent` | string | no | New assigned agent. Mutually exclusive with team. |
| `team` | string | no | New team assignment — clears any concrete agent; Bakin re-routes at dispatch. Mutually exclusive with agent. |
| `availableAt` | string | no | ISO timestamp before which dispatch should not pick up the task |
| `dueAt` | string | no | ISO timestamp representing the task deadline or target delivery time |
| `expectedVersion` | number | no | Optimistic-concurrency check: fail if the task version has moved past this |

Example:

```sh
bakin_exec_tasks_update {
  "taskId": "value",
  "title": "value",
  "description": "value",
  "agent": "value",
  "team": "value",
  "availableAt": "value",
  "dueAt": "value",
  "expectedVersion": 20
}
```

## Team

Team tools expose agent roster, identity, status, messaging, and permission operations.

### bakin_exec_team_create_agent

Label: Created agent
Purpose: Create a new agent: registers it with the active runtime, writes persona files, configures dispatch permissions, optionally assigns it to a team. Returns next-step instructions.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | no | Agent ID (lowercase alphanumeric + hyphens). Auto-derived from name if omitted. |
| `name` | string | yes | Display name (e.g. "Jessica") |
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
bakin_exec_team_create_agent {
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
}
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
bakin_exec_team_delete_agent {
  "agentId": "value",
  "confirm": true
}
```

### bakin_exec_team_list

Label: Listed team
Purpose: List all agents with their current status (online/working/available/offline).

Arguments: none.

Example:

```sh
bakin_exec_team_list
```

### bakin_exec_team_members

Label: Listed team members
Purpose: Get agents that belong to a specific team (e.g. "builders", "creators").

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `teamId` | string | yes | Team ID (e.g. "builders", "creators") |

Example:

```sh
bakin_exec_team_members {
  "teamId": "value"
}
```

### bakin_exec_team_message

Label: Sent a message
Purpose: Send a message to an agent via the active runtime.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Agent ID |
| `message` | string | yes | Message to send. Do NOT use this to brief an agent about a task they were just assigned — dispatch already notified them, and a second message starts a duplicate worker in their main session. |

Example:

```sh
bakin_exec_team_message {
  "agentId": "value",
  "message": "value"
}
```

### bakin_exec_team_my_team

Label: Read own team
Purpose: Get the team that a specific agent belongs to, including all teammates.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Agent ID |

Example:

```sh
bakin_exec_team_my_team {
  "agentId": "value"
}
```

### bakin_exec_team_org

Label: Read organization
Purpose: Get the full org structure: teams with their members. Use this to understand who is on which team and reporting lines.

Arguments: none.

Example:

```sh
bakin_exec_team_org
```

### bakin_exec_team_profile

Label: Read agent profile
Purpose: Get the full profile for an agent including soul, rules, and tools.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Agent ID |

Example:

```sh
bakin_exec_team_profile {
  "agentId": "value"
}
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
bakin_exec_team_read_file {
  "agentId": "value",
  "filename": "value"
}
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
bakin_exec_team_set_permissions {
  "agentId": "value",
  "allowAgents": [
    "value"
  ]
}
```

### bakin_exec_team_status

Label: Checked agent status
Purpose: Get the heartbeat and health status for an agent.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | Agent ID |

Example:

```sh
bakin_exec_team_status {
  "agentId": "value"
}
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
bakin_exec_team_update_identity {
  "agentId": "value",
  "name": "value",
  "emoji": "value",
  "role": "value",
  "vibe": "value",
  "primaryFunction": "value",
  "defaultMode": "value",
  "soul": "value",
  "tools": "value"
}
```

## Workflows

Workflow tools expose workflow definitions, active instances, current steps, and step completion.

### bakin_exec_workflows_cancel_map_child

Label: Cancelled map child
Purpose: Cancel one fan-out child of a map_workflow step. The map join stays blocked until the child is retried or the whole parent is cancelled — children are never silently skipped.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | PARENT task ID (the instance holding the map step) |
| `stepId` | string | yes | The map_workflow step ID |
| `index` | number | yes | Child index within the fan-out (0-based) |

Example:

```sh
bakin_exec_workflows_cancel_map_child {
  "taskId": "value",
  "stepId": "value",
  "index": 20
}
```

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
bakin_exec_workflows_complete_step {
  "taskId": "value",
  "stepId": "value",
  "output": {
    "key": "value"
  }
}
```

### bakin_exec_workflows_get_definition

Label: Read workflow definition
Purpose: Get a workflow definition by filename. Returns the full definition with steps, inputs, and resolved sub-workflows.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Workflow definition filename (e.g. "content-pipeline") |

Example:

```sh
bakin_exec_workflows_get_definition {
  "name": "value"
}
```

### bakin_exec_workflows_get_instance

Label: Read workflow instance
Purpose: Get the full state of a workflow instance for a task, including step states and history.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |

Example:

```sh
bakin_exec_workflows_get_instance {
  "taskId": "value"
}
```

### bakin_exec_workflows_get_step

Label: Read workflow step
Purpose: Get the current workflow step for a task. Returns only the current step (information gating — future steps are hidden). Critical for agents to know what to do next.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | Task ID |

Example:

```sh
bakin_exec_workflows_get_step {
  "taskId": "value"
}
```

### bakin_exec_workflows_list

Label: Listed workflows
Purpose: List all workflow definitions (templates). Returns name, filename, description, and step count for each.

Arguments: none.

Example:

```sh
bakin_exec_workflows_list
```

### bakin_exec_workflows_list_instances

Label: Listed workflow runs
Purpose: List workflow instances. Optionally filter by status (in_progress, pending_approval, complete, failed, cancelled).

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | choice | no | Filter by instance status |

Example:

```sh
bakin_exec_workflows_list_instances {
  "status": "value"
}
```

### bakin_exec_workflows_retry_map_child

Label: Retried map child
Purpose: Retry one fan-out child of a map_workflow step. Live children reopen in place; dead/cancelled children are re-created under the same child task id with their original item context. Unblocks a blocked map join without rewinding the parent.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `taskId` | string | yes | PARENT task ID (the instance holding the map step) |
| `stepId` | string | yes | The map_workflow step ID |
| `index` | number | yes | Child index within the fan-out (0-based) |
| `reason` | string | no | Why this child is being retried |

Example:

```sh
bakin_exec_workflows_retry_map_child {
  "taskId": "value",
  "stepId": "value",
  "index": 20,
  "reason": "value"
}
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
bakin_exec_workflows_start {
  "taskId": "value",
  "workflowId": "value"
}
```
