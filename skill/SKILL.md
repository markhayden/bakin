---
name: bakin
description: Mission control integration for multi-agent coordination. Provides task management, logging, search, and agent communication via mcporter MCP tools. Required for all agents in the Bakin ecosystem.
---

# Bakin Mission Control

You are part of a multi-agent team coordinated by Bakin. You interact with Bakin through **mcporter** — a CLI that calls Bakin's MCP server.

Your Bakin MCP server is `bakin-<your-agent-name>` (e.g., `bakin-pixel`, `bakin-basil`). Your dispatch message will tell you which server to use.

## Quick Reference

```bash
# Log progress (mandatory, every major step)
mcporter call bakin-<agent>.bakin_log_progress taskId=<id> message="<update>"
# Report complete (moves to done + notifies orchestrator)
mcporter call bakin-<agent>.bakin_report_complete taskId=<id> summary="<what you did>"
# Block task (if stuck)
mcporter call bakin-<agent>.bakin_block_task taskId=<id> reason="<what went wrong>"
# Move task between columns
mcporter call bakin-<agent>.bakin_move_task taskId=<id> to=inProgress
# Create subtask for another agent
mcporter call bakin-<agent>.bakin_create_task title="<subtask>" assignee="<agent>" description="<brief>"
# Register dependency (then stop — you'll be re-dispatched)
mcporter call bakin-<agent>.bakin_register_dependency taskId=<id> dependsOn="<other-id>"
# Check your task details
mcporter call bakin-<agent>.bakin_get_task taskId=<id>
# Discover filesystem paths (never hardcode)
mcporter call bakin-<agent>.bakin_get_paths
# Workflow: submit step output
mcporter call bakin-<agent>.bakin_submit_step taskId=<id> stepId=<step> --args '<json>'
# Workflow: check current step
mcporter call bakin-<agent>.bakin_get_step taskId=<id>```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `bakin_log_progress` | Log what you're doing (mandatory, every major step) |
| `bakin_move_task` | Move task between columns |
| `bakin_create_task` | Create subtasks for other agents |
| `bakin_block_task` | Block a task with a reason |
| `bakin_report_complete` | Mark task done + notify orchestrator (includes summary) |
| `bakin_get_task` | Check your task details |
| `bakin_get_step` | Get current workflow step details |
| `bakin_submit_step` | Submit workflow step output |
| `bakin_get_paths` | Discover filesystem paths (never hardcode) |
| `bakin_register_dependency` | Register a dependency on another task |

Your agent identity is automatically injected by the MCP server — you do not need to specify it.

**Tool discovery:** The table below is auto-generated and may not reflect recently installed plugins. For the live, authoritative list of all available tools, run:
```bash
mcporter list bakin-<agent> --schema
```

<!-- bakin:exec-tools:start -->
## Execution Tools

> Auto-managed by `bakin doctor`. Do not edit this block manually.

Use these tools to accomplish actual work — saving files, posting content, generating images, scheduling jobs. Called the same way as MCP tools via mcporter.

| Tool | Purpose |
|------|---------|
| `bakin_exec_post_discord` | Post a message to a Discord channel via bot. Resolves channel names to IDs automatically. Supports image/video attachments and embeds. |
| `bakin_exec_log` | Log a formatted progress update with category and stage tags. Categories: start, progress, milestone, blocked, complete. More structured than raw bakin_log_progress. |
| `bakin_exec_gen_image` | Generate an image via Gemini Imagen (Nano Banana), or import an existing image file into the asset pipeline via filePath. Default model: flash (cheaper). Use model=pro for higher quality. Default: 1080x1920 portrait (9:16) for Stories/Reels. Presets: social-portrait, social-square, social-landscape, custom. Auto-generates thumbnail. Max 1200px on any edge. |
| `bakin_exec_get_paths` | Get Bakin content directory paths — where to find assets, team info, docs, etc. |
| `bakin_exec_heartbeat` | Write a heartbeat signal. Call periodically (every 5-10 minutes) to indicate you are alive. Also call when starting or finishing a task. |
| `bakin_exec_search_query` | Search across all Bakin content (tasks, assets, projects, workflows, schedules, agents) or a specific table. Returns ranked results with scores. |
| `bakin_exec_search_table` | Search a specific Bakin table with facet filtering. Returns results plus facet counts for filtering. |
| `bakin_exec_search_lookup` | Look up a specific indexed document by its key and table. |
| `bakin_exec_search_facets` | Get facet value counts for a table. Useful for understanding data distribution (e.g., how many tasks per status). |
| `bakin_exec_search_similar` | Find documents similar to a given text description. Uses semantic (vector) search for meaning-based matching. |
| `bakin_exec_search_reindex` | Trigger a full reindex of all content types (or a specific table). Use after bulk data changes. |
| `bakin_exec_search_stats` | Get search system health: enabled status, per-table document counts, and index stats. |
| `bakin_exec_team_list` | List all agents with their current status (online/working/available/offline). |
| `bakin_exec_team_profile` | Get the full profile for an agent including soul, rules, and tools. |
| `bakin_exec_team_status` | Get the heartbeat and health status for an agent. |
| `bakin_exec_team_read_file` | Read a workspace file for an agent (e.g., SOUL.md, AGENTS.md, TOOLS.md). |
| `bakin_exec_team_message` | Send a message to an agent via OpenClaw. |
| `bakin_exec_team_org` | Get the full org structure: teams with their members. Use this to understand who is on which team and reporting lines. |
| `bakin_exec_team_members` | Get agents that belong to a specific team (e.g. "builders", "creators"). |
| `bakin_exec_team_my_team` | Get the team that a specific agent belongs to, including all teammates. |
| `bakin_exec_tasks_list` | List all tasks on the board. Optionally filter by column or agent. |
| `bakin_exec_tasks_get` | Get details about a task — title, description, current column, logs, dependencies, project context. |
| `bakin_exec_tasks_create` | Create a new task on the task board. Workflows are auto-matched by title when workflowId is not provided. Provide workflowId to force a specific workflow, or skipWorkflowReason to explicitly skip. |
| `bakin_exec_tasks_move` | Move a task to a different column on the task board. |
| `bakin_exec_tasks_block` | Mark a task as blocked with a reason. Use when you cannot proceed. |
| `bakin_exec_tasks_complete` | Report that your task is complete. Moves the task to Done and notifies the orchestrator. |
| `bakin_exec_tasks_log_progress` | Log a human-readable progress update to the live activity feed. Call this at every significant step. |
| `bakin_exec_tasks_set_dependency` | Register a dependency between tasks. Your task will be auto-re-dispatched when the dependency completes. After registering, exit — do not wait. |
| `bakin_exec_tasks_update` | Update a task on the board — change title, description, or assigned agent. |
| `bakin_exec_tasks_delete` | Delete a task from the board. |
| `bakin_exec_tasks_assign` | Assign a task to an agent. |
| `bakin_exec_assets_list` | List assets with optional type filter. Returns asset count and paths. |
| `bakin_exec_assets_get` | Retrieve a single asset's sidecar metadata by path. |
| `bakin_exec_assets_save` | Save an agent-created file to the assets directory with standardized naming (YYYYMMDD-slug.ext) and sidecar metadata. Handles directory creation, naming conventions, and .meta.json automatically. |
| `bakin_exec_assets_delete` | Soft-delete an asset (moves to trash with 30-day expiry). |
| `bakin_exec_assets_link` | Link an asset to a different task, or unlink it (set taskId to null). Physically moves the file between task directories and updates sidecar metadata. |
| `bakin_exec_assets_list_trash` | List trashed assets with name, size, deleted timestamp, and days remaining before auto-purge. |
| `bakin_exec_assets_restore` | Restore a trashed asset back to its original location. Use bakin_exec_assets_list_trash first to get the filename. |
| `bakin_exec_assets_audit` | Audit asset health: check for missing thumbnails, invalid sidecars, orphaned files. Set fix=true to auto-generate missing thumbnails and create stub sidecars. |
| `bakin_exec_assets_empty_trash` | Permanently delete all items from trash. This cannot be undone. |
| `bakin_exec_assets_permanent_delete` | Permanently delete a specific trashed asset. This cannot be undone. |
| `bakin_exec_models_list` | List available AI models with tier classification (budget/standard/premium). Use this to discover what models are available for assignment. |
| `bakin_exec_models_get_config` | Get model configuration for all agents or a specific agent. Shows effective model (own override or default), subagent model, and system defaults. |
| `bakin_exec_messaging_list` | List messaging items with optional filters |
| `bakin_exec_messaging_get` | Get details for a single messaging item |
| `bakin_exec_messaging_create` | Create a new messaging item |
| `bakin_exec_messaging_update` | Update a messaging item |
| `bakin_exec_messaging_approve` | Approve a messaging item (draft → scheduled, review → published) |
| `bakin_exec_messaging_reject` | Reject a messaging item back to draft status |
| `bakin_exec_messaging_delete` | Delete a messaging item |
| `bakin_exec_messaging_session_list` | List planning sessions with optional filters |
| `bakin_exec_messaging_session_get` | Get a planning session with full message history and proposals |
| `bakin_exec_messaging_session_create` | Create a new planning session for an agent |
| `bakin_exec_messaging_session_update` | Update a planning session title or status |
| `bakin_exec_messaging_session_delete` | Delete a planning session |
| `bakin_exec_messaging_session_message` | Send a message in a planning session (non-streaming, returns full response) |
| `bakin_exec_messaging_proposal_update` | Update a proposal status or fields (approve, reject, edit) |
| `bakin_exec_messaging_session_confirm` | Confirm a planning session — creates messaging items from approved proposals |
| `bakin_exec_workflows_list` | List all workflow definitions (templates). Returns name, filename, description, and step count for each. |
| `bakin_exec_workflows_get_definition` | Get a workflow definition by filename. Returns the full definition with steps, inputs, and resolved sub-workflows. |
| `bakin_exec_workflows_start` | Start a workflow instance for a task. The task must exist on the board. Returns the created instance. |
| `bakin_exec_workflows_list_instances` | List workflow instances. Optionally filter by status (in_progress, pending_approval, complete, failed, cancelled). |
| `bakin_exec_workflows_get_instance` | Get the full state of a workflow instance for a task, including step states and history. |
| `bakin_exec_workflows_get_step` | Get the current workflow step for a task. Returns only the current step (information gating — future steps are hidden). Critical for agents to know what to do next. |
| `bakin_exec_workflows_complete_step` | Complete a workflow step with output. Validates output against the step schema, advances the workflow to the next step. Returns success status and whether the workflow is complete. |
| `bakin_exec_get_step` | Get the current workflow step as human-readable formatted text. Includes instructions, prior outputs, schema, and rejection context in a clear structure. |
| `bakin_exec_submit_step` | Submit workflow step output with local pre-validation. Validates against the step schema BEFORE hitting the server, giving you detailed field-level errors without a round trip. |
| `bakin_exec_check_gates` | Get a human-readable overview of all gate statuses in a workflow. Shows which gates are approved, waiting, or pending. |
| `bakin_exec_schedule_list` | List all scheduled jobs (merged OpenClaw + Bakin view) |
| `bakin_exec_schedule_create` | Create a new scheduled job that creates tasks on the board |
| `bakin_exec_schedule_update` | Update an existing scheduled job |
| `bakin_exec_schedule_pause` | Pause, resume, or skip runs for a scheduled job |
| `bakin_exec_schedule_delete` | Delete a scheduled job |
| `bakin_exec_schedule_get` | Get details for a single scheduled job |
| `bakin_exec_schedule_run_now` | Trigger an immediate run of a scheduled job |
| `bakin_exec_schedule_runs` | Get run history for a scheduled job |
| `bakin_exec_schedule_parse` | Parse a natural language or raw cron schedule expression |
| `bakin_exec_schedule_briefing` | Today's schedule summary — which jobs fire, assigned agents, alerts. Designed for orchestrator daily briefing. |
| `bakin_exec_project_list` | List all projects with optional status filter. Returns summaries with id, title, status, progress, taskCount. |
| `bakin_exec_project_get` | Get a project by ID including full spec, checklist, progress, and linked board task statuses. |
| `bakin_exec_project_create` | Create a new project with title, markdown body, and optional initial checklist items. Returns project ID and generated task item IDs. |
| `bakin_exec_project_update` | Update a project's title, status, body, or owner. Cannot set status to "completed" if unchecked items remain. |
| `bakin_exec_project_delete` | Delete a project by ID. |
| `bakin_exec_project_add_item` | Add a new checklist item to a project. |
| `bakin_exec_project_mark_item` | Mark a checklist item as checked (done) or unchecked. Returns updated progress percentage. |
| `bakin_exec_project_remove_item` | Remove a checklist item from a project. |
| `bakin_exec_project_link_item` | Link an existing board task to a project checklist item. Use this when a task was created separately and should be associated with a project. |
| `bakin_exec_project_promote_item` | Create a NEW board task from a project checklist item and automatically link it. The task appears on the task board with the item title and projectId set. |
| `bakin_exec_project_attach_asset` | Attach an existing asset to a project. Assets provide additional context (specs, designs, docs) that agents can reference. Only summaries are included in project_get — use asset tools to read full content when needed. |
| `bakin_exec_project_detach_asset` | Remove an asset reference from a project. Does not delete the asset itself. |
| `bakin_exec_project_toggle_item` | Toggle a checklist item checked/unchecked by item ID. Returns updated progress percentage. |
| `bakin_exec_project_update_item` | Update a checklist item's title and/or description. |
| `bakin_exec_project_ask` | Ask an agent a question about a project. Sends the project context (spec, checklist, assets) along with the message to the agent for brainstorming. |

### Quick Reference

```bash
# Save a file as a managed asset (handles naming + sidecar automatically)
mcporter call bakin-<agent>.bakin_exec_save_asset taskId=<id> type=<images|text|video|audio|plans|data|other> filePath="<path>" description="<desc>"
# Post to Discord (with optional image/video attachment)
mcporter call bakin-<agent>.bakin_exec_post_discord channel="<name>" content="<msg>" taskId=<id>
# Generate image via Nano Banana
mcporter call bakin-<agent>.bakin_exec_gen_image taskId=<id> prompt="<text>" preset=social-portrait model=flash
# Check workflow gate statuses
mcporter call bakin-<agent>.bakin_exec_check_gates taskId=<id>
# Create a recurring scheduled job (NEVER use openclaw cron directly)
mcporter call bakin-<agent>.bakin_exec_schedule_create name="daily-recipe" schedule="every day at 11am" agentId="basil" taskPrompt="Post a short recipe"
# List all scheduled jobs
mcporter call bakin-<agent>.bakin_exec_schedule_list
```
<!-- bakin:exec-tools:end -->

## Task Lifecycle

Tasks flow through columns: **TODO** -> **In Progress** -> **Done** (or **Blocked**).

When you receive a task:
1. **Move it to In Progress immediately** (before doing any work)
2. Log that you've started working on it
3. Log progress at every major step (not just start and done)
4. If blocked, block the task with a clear reason
5. When done, report complete with a summary

Valid transitions: backlog→todo, todo→inProgress/blocked/done/backlog, inProgress→done/blocked/todo, blocked→todo/inProgress/backlog, done→archived/todo. The `archived` column holds completed work — tasks auto-archive after 24 hours in done, and can be recovered back to done or todo. The `backlog` column is for planning only — tasks there are never auto-dispatched to agents.

### Report Completion

Use `bakin_report_complete` — it moves the task to Done, logs the summary, and notifies the orchestrator automatically.

**Do NOT use this for workflow tasks.** Workflow tasks complete via `bakin_submit_step`.

## Creating Subtasks

If your task requires work from another agent, create a subtask with `bakin_create_task`. Include `parentId` for immediate dispatch.

### Workflow preflight — run this sequence every time before `bakin_create_task`

Workflows are the default. Skipping one is the exception, and skipping silently is never allowed.

1. **Check the catalog.** Call `bakin_exec_workflows_list` and read what's available.
2. **Match against the subtask.** Does any workflow fit by title keywords, target agent, or intent? (e.g., a subtask for Pixel to produce an image matches `image-generation`.)
3. **If a match exists, STOP. Do not create the task yet.** Message your parent task's requester (via `bakin_log_progress` on your own task, or by messaging roscoe if you need a decision back) and ask whether they want the full workflow or a one-off. Example: *"I need Pixel to produce a hero image — there's an `image-generation` workflow with a prompt-approval gate. Use the workflow, or one-off?"* Silence is not permission to skip.
4. **Only after the decision**, call `bakin_create_task` with either `workflowId` set to the chosen workflow, or `skipWorkflowReason` citing the confirmation (e.g., `"roscoe confirmed one-off — no approval gate needed for quick reference image"`).

**Chat requests that sound simple are still workflow candidates if a matching workflow exists.** "Quick image," "just a draft," and "one-off" are NOT reasons to bypass a workflow on your own. The user's phrasing doesn't change the rule — the catalog does.

**Your judgment alone is not enough to skip.** The only valid reasons to skip without asking: (a) no workflow in the catalog matches, or (b) the requester has already said in this conversation they want a one-off.

## Dependencies

Register a dependency with `bakin_register_dependency`, then **stop**. You will be automatically re-dispatched when the dependency completes.

## Search

Search across all indexed content (tasks, decisions, assets, projects):

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

**NEVER hardcode or construct filesystem paths.** Always use `bakin_get_paths` to discover where files live.

Available path keys: `home`, `memoryLog`, `calendar`, `audit`, `assets`, `assets.text`, `assets.images`, `assets.video`, `assets.audio`, `assets.plans`, `assets.data`, `assets.other`, `personas`, `team`, `heartbeats`, `inbox`, `projects`, `workflows`, `settings`.

### Querying Assets

List all indexed assets (supports filters):
```bash
# All assets
curl -s http://localhost:3737/api/plugins/assets/list

# Filter by type, agent, taskId, or tag
curl -s 'http://localhost:3737/api/plugins/assets/list?type=images&agent=pixel'
curl -s 'http://localhost:3737/api/plugins/assets/list?taskId=task-abc'
curl -s 'http://localhost:3737/api/plugins/assets/list?tag=hero'
```

Serve an asset file:
```bash
curl -s 'http://localhost:3737/api/plugins/assets/file?path=assets/images/task-abc/hero.png'
```

Soft-delete an asset (moves to .trash/):
```bash
curl -s -X DELETE 'http://localhost:3737/api/plugins/assets/assets%2Fimages%2Ftask-abc%2Fhero.png'
```

### Writing Assets

Use `bakin_exec_save_asset` to save any agent-created content. The tool handles
directory creation, naming conventions (YYYYMMDD-slug.ext), and sidecar metadata
automatically. Never write assets manually.

## Rules — SERVER ENFORCED

These rules are not suggestions. The API enforces them. Violations are logged, tracked, and escalated.

### Mandatory: Block on ANY error

If you encounter ANY error, unexpected result, missing file, failed API call, or situation you weren't briefed on — you MUST block the task immediately. Do NOT attempt workarounds, fallbacks, or creative alternatives. Block first, then explain.

### Mandatory: Log before Done

The API will reject any attempt to move a task to Done if it has zero log entries. You must log your work before completing. This is enforced server-side — there is no workaround.

### Mandatory: Agent identity on moves

Your agent identity is automatically injected by the MCP server. Use your real agent name when connecting — never impersonate another agent.

### Mandatory: Use the API, never edit files

Always use Bakin tools (via mcporter) to manage tasks. Direct database edits bypass locking, validation, and audit logging.

### Mandatory: Never run scripts/bin/*.ts directly

The `scripts/bin/` directory contains debug wrappers that call tool functions directly, bypassing Bakin's MCP server entirely. This means no Health metrics, no audit log, no tracking. Always use the MCP tool via `mcporter call bakin-<agent>.bakin_exec_<tool> ...` instead.

### Mandatory: Discover paths via bakin_get_paths

Never hardcode `content/`, `~/.bakin/`, or any absolute path. Always use `bakin_get_paths`. Paths change between environments.

### Mandatory: Log progress every major step

The watchdog monitors for stuck tasks. If no log update in 30 minutes and your heartbeat is stale, the task is automatically moved back to Todo for re-dispatch. After 3 auto-recoveries, the task is escalated to Blocked. Keep logs flowing to prevent this.

### Mandatory: Report back

Always use `bakin_report_complete` when done — it handles notification automatically. For blocks, use `bakin_block_task`.

### What happens when you violate these rules

- **Invalid state transition** → Tool returns error with allowed transitions
- **Move without agent** → Tool returns error
- **Done without logs** → Tool returns error
- **Direct database edit** → Bypasses all validation, breaks locking
- **Bypass patterns detected** (workaround language in logs) → Alert sent to roscoe, audit logged
- **Stuck task + stale heartbeat** → Auto-recovered to Todo, then Blocked after 3 recoveries

## Subagent Rules

These rules apply to ALL subagents (Basil, Pixel, Rolo, Patch, etc.). Violating them breaks the pipeline.

1. **Never edit the task database directly.** Always use Bakin tools.

2. **Never hardcode filesystem paths.** Always use `bakin_get_paths`.

3. **Stay in your lane.** Don't do work assigned to another agent. Create subtasks instead.

4. **Only spawn agents when you have a concrete brief.** Don't speculatively create subtasks.

5. **Use your own agent name.** Log as `basil`, `pixel`, `patch`, etc. — never as `system`, `roscoe`, or another agent.

6. **Never send messages directly to Mark.** Report to `main` — Roscoe decides what to surface.

7. **Never mark a task done prematurely.** Only move to Done after output is delivered and confirmed.

8. **Always exit after registering a dependency.** Register it and stop. You'll be re-dispatched automatically.

9. **Block immediately on errors.** Do NOT work around blockers. Block the task and explain.

## Workflow Step Discipline

When you receive a message that starts with "# WORKFLOW STEP ASSIGNMENT", you are in **workflow mode**. These rules override all other instructions for the duration of that step.

### What workflow mode means

- You are executing ONE step of a multi-step pipeline
- You cannot see other steps — by design, not by accident
- The ONLY valid completion is calling `bakin_submit_step` via mcporter
- The workflow engine advances the pipeline — you do not

### What you MUST do

1. Read the step instructions completely before starting
2. Produce output that matches the JSON schema provided in the dispatch message
3. Submit output via `bakin_submit_step`
4. Log progress at each major milestone via `bakin_log_progress`
5. Your `agentId` is automatically included in tool calls

### What you MUST NOT do

- Generate deliverables outside your step's scope (e.g., do not generate images if your step is "write copy")
- Move the task to Done or any other column — the workflow engine handles task state
- Message roscoe with "TASK COMPLETE" — workflow tasks complete through `bakin_submit_step`, not messages
- Create subtasks for other agents — the workflow defines who does what
- Attempt to read or infer what future steps contain
- Resubmit the same output after a rejection without addressing the feedback — the server detects near-duplicates and rejects them
- Use tools listed in "TOOL RESTRICTIONS" if present in the dispatch message

### After rejection

If your step is re-dispatched with a "REVISION REQUIRED" section, the reviewer found a problem with your previous output. You MUST:
1. Read the rejection reason carefully
2. Identify what specifically needs to change
3. Produce genuinely revised output — not the same output with minor tweaks
4. Submit via `bakin_submit_step` as before

### What happens automatically

- Output is validated against JSON Schema server-side (invalid = error with details)
- Extra fields beyond the schema are rejected (additionalProperties is enforced)
- The workflow engine advances to the next step or gate after valid submission
- Gates pause the workflow for human review — you are never asked to review gates
- If a gate rejects, the relevant agent is re-dispatched with feedback and previous output
- The watchdog monitors for stuck or out-of-scope behavior
- Workflow tasks cannot be moved to Done directly — only the workflow engine can do this
