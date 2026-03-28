---
name: beacon
description: Mission control integration for multi-agent coordination. Provides task management, logging, search, and agent communication via mcporter MCP tools. Required for all agents in the Beacon ecosystem.
---

# Beacon Mission Control

You are part of a multi-agent team coordinated by Beacon. You interact with Beacon through **mcporter** — a CLI that calls Beacon's MCP server.

Your Beacon MCP server is `beacon-<your-agent-name>` (e.g., `beacon-pixel`, `beacon-chef`). Your dispatch message will tell you which server to use.

## Quick Reference

```bash
# Log progress (mandatory, every major step)
mcporter call beacon-<agent>.beacon_log_progress taskId=<id> message="<update>"
# Report complete (moves to done + notifies orchestrator)
mcporter call beacon-<agent>.beacon_report_complete taskId=<id> summary="<what you did>"
# Block task (if stuck)
mcporter call beacon-<agent>.beacon_block_task taskId=<id> reason="<what went wrong>"
# Move task between columns
mcporter call beacon-<agent>.beacon_move_task taskId=<id> to=inProgress
# Create subtask for another agent
mcporter call beacon-<agent>.beacon_create_task title="<subtask>" assignee="<agent>" description="<brief>"
# Register dependency (then stop — you'll be re-dispatched)
mcporter call beacon-<agent>.beacon_register_dependency taskId=<id> dependsOn="<other-id>"
# Check your task details
mcporter call beacon-<agent>.beacon_get_task taskId=<id>
# Discover filesystem paths (never hardcode)
mcporter call beacon-<agent>.beacon_get_paths
# Workflow: submit step output
mcporter call beacon-<agent>.beacon_submit_step taskId=<id> stepId=<step> --args '<json>'
# Workflow: check current step
mcporter call beacon-<agent>.beacon_get_step taskId=<id>```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `beacon_log_progress` | Log what you're doing (mandatory, every major step) |
| `beacon_move_task` | Move task between columns |
| `beacon_create_task` | Create subtasks for other agents |
| `beacon_block_task` | Block a task with a reason |
| `beacon_report_complete` | Mark task done + notify orchestrator (includes summary) |
| `beacon_get_task` | Check your task details |
| `beacon_get_step` | Get current workflow step details |
| `beacon_submit_step` | Submit workflow step output |
| `beacon_get_paths` | Discover filesystem paths (never hardcode) |
| `beacon_register_dependency` | Register a dependency on another task |

Your agent identity is automatically injected by the MCP server — you do not need to specify it.

<!-- beacon:exec-tools:start -->
## Execution Tools

> Auto-managed by `beacon doctor`. Do not edit this block manually.

Use these tools to accomplish actual work — saving files, posting content, generating images. Called the same way as MCP tools via mcporter.

| Tool | Purpose |
|------|---------|
| `beacon_exec_save_asset` | Save an agent-created file to the assets directory with standardized naming (YYYYMMDD-slug.ext) and sidecar metadata. Handles directory creation, naming conventions, and .meta.json automatically. |
| `beacon_exec_log` | Log a formatted progress update with category and stage tags. Categories: start, progress, milestone, blocked, complete. More structured than raw beacon_log_progress. |
| `beacon_exec_get_step` | Get the current workflow step as human-readable formatted text. Includes instructions, prior outputs, schema, and rejection context in a clear structure. |
| `beacon_exec_submit_step` | Submit workflow step output with local pre-validation. Validates against the step schema BEFORE hitting the server, giving you detailed field-level errors without a round trip. |
| `beacon_exec_check_gates` | Get a human-readable overview of all gate statuses in a workflow. Shows which gates are approved, waiting, or pending. |
| `beacon_exec_gen_image` | Generate an image via Gemini Imagen (Nano Banana). Default model: flash (cheaper). Use model=pro for higher quality. Default: 1080x1920 portrait (9:16) for Stories/Reels. Presets: social-portrait, social-square, social-landscape, custom. Auto-generates thumbnail. Max 1200px on any edge. |
| `beacon_exec_post_discord` | Post a message to a Discord channel via bot. Resolves channel names to IDs automatically. Supports image/video attachments and embeds. |
| `beacon_exec_audit_assets` | Audit asset health: check for missing thumbnails, invalid sidecars, orphaned files. Set fix=true to auto-generate missing thumbnails and create stub sidecars. |
| `beacon_exec_list_trash` | List trashed assets with name, size, deleted timestamp, and days remaining before auto-purge. |
| `beacon_exec_restore_trash` | Restore a trashed asset back to its original location. Use beacon_exec_list_trash first to get the filename. |
| `beacon_exec_empty_trash` | Permanently delete all items from trash. This cannot be undone. |

### Quick Reference

```bash
# Save a file as a managed asset (handles naming + sidecar automatically)
mcporter call beacon-<agent>.beacon_exec_save_asset taskId=<id> type=<images|text|video|audio|plans|data|other> filePath="<path>" description="<desc>"
# Post to Discord (with optional image/video attachment)
mcporter call beacon-<agent>.beacon_exec_post_discord channel="<name>" content="<msg>" taskId=<id>
# Generate image via Nano Banana
mcporter call beacon-<agent>.beacon_exec_gen_image taskId=<id> prompt="<text>" preset=social-portrait model=flash
# Check workflow gate statuses
mcporter call beacon-<agent>.beacon_exec_check_gates taskId=<id>
```
<!-- beacon:exec-tools:end -->

## Task Lifecycle

Tasks flow through columns: **TODO** -> **In Progress** -> **Done** (or **Blocked**).

When you receive a task:
1. **Move it to In Progress immediately** (before doing any work)
2. Log that you've started working on it
3. Log progress at every major step (not just start and done)
4. If blocked, block the task with a clear reason
5. When done, report complete with a summary

Valid transitions: backlog→todo, todo→inProgress/blocked/done/backlog, inProgress→done/blocked/todo, blocked→todo/inProgress/backlog, done→confirmed/todo. The `confirmed` column is terminal — nothing leaves it. The `backlog` column is for planning only — tasks there are never auto-dispatched to agents.

### Report Completion

Use `beacon_report_complete` — it moves the task to Done, logs the summary, and notifies the orchestrator automatically.

**Do NOT use this for workflow tasks.** Workflow tasks complete via `beacon_submit_step`.

## Creating Subtasks

If your task requires work from another agent, create a subtask with `beacon_create_task`. Include `parentId` for immediate dispatch.

## Dependencies

Register a dependency with `beacon_register_dependency`, then **stop**. You will be automatically re-dispatched when the dependency completes.

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

**NEVER hardcode or construct filesystem paths.** Always use `beacon_get_paths` to discover where files live.

Available path keys: `home`, `taskboard`, `memoryLog`, `calendar`, `audit`, `assets`, `assets.text`, `assets.images`, `assets.video`, `assets.audio`, `assets.plans`, `assets.data`, `assets.other`, `personas`, `team`, `heartbeats`, `inbox`, `projects`, `workflows`, `settings`.

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
curl -s -X POST 'http://localhost:3737/api/plugins/assets/delete?path=assets/images/task-abc/hero.png'
```

### Writing Assets

Use `beacon_exec_save_asset` to save any agent-created content. The tool handles
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

Always use Beacon tools (via mcporter) to manage tasks. Direct edits to TASKBOARD.md bypass locking, validation, and audit logging.

### Mandatory: Never run scripts/bin/*.ts directly

The `scripts/bin/` directory contains debug wrappers that call tool functions directly, bypassing Beacon's MCP server entirely. This means no Health metrics, no audit log, no tracking. Always use the MCP tool via `mcporter call beacon-<agent>.beacon_exec_<tool> ...` instead.

### Mandatory: Discover paths via beacon_get_paths

Never hardcode `content/`, `~/.beacon/`, or any absolute path. Always use `beacon_get_paths`. Paths change between environments.

### Mandatory: Log progress every major step

The watchdog monitors for stuck tasks. If no log update in 30 minutes and your heartbeat is stale, the task is automatically moved back to Todo for re-dispatch. After 3 auto-recoveries, the task is escalated to Blocked. Keep logs flowing to prevent this.

### Mandatory: Report back

Always use `beacon_report_complete` when done — it handles notification automatically. For blocks, use `beacon_block_task`.

### What happens when you violate these rules

- **Invalid state transition** → Tool returns error with allowed transitions
- **Move without agent** → Tool returns error
- **Done without logs** → Tool returns error
- **Direct TASKBOARD.md edit** → Bypasses all validation, breaks locking
- **Bypass patterns detected** (workaround language in logs) → Alert sent to main-operator, audit logged
- **Stuck task + stale heartbeat** → Auto-recovered to Todo, then Blocked after 3 recoveries

## Subagent Rules

These rules apply to ALL subagents (Chef, Pixel, Rolo, Patch, etc.). Violating them breaks the pipeline.

1. **Never edit TASKBOARD.md directly.** Direct edits are auto-reverted. Always use Beacon tools.

2. **Never hardcode filesystem paths.** Always use `beacon_get_paths`.

3. **Stay in your lane.** Don't do work assigned to another agent. Create subtasks instead.

4. **Only spawn agents when you have a concrete brief.** Don't speculatively create subtasks.

5. **Use your own agent name.** Log as `chef`, `pixel`, `patch`, etc. — never as `system`, `main-operator`, or another agent.

6. **Never send messages directly to Mark.** Report to `main` — Main Operator decides what to surface.

7. **Never mark a task done prematurely.** Only move to Done after output is delivered and confirmed.

8. **Always exit after registering a dependency.** Register it and stop. You'll be re-dispatched automatically.

9. **Block immediately on errors.** Do NOT work around blockers. Block the task and explain.

## Workflow Step Discipline

When you receive a message that starts with "# WORKFLOW STEP ASSIGNMENT", you are in **workflow mode**. These rules override all other instructions for the duration of that step.

### What workflow mode means

- You are executing ONE step of a multi-step pipeline
- You cannot see other steps — by design, not by accident
- The ONLY valid completion is calling `beacon_submit_step` via mcporter
- The workflow engine advances the pipeline — you do not

### What you MUST do

1. Read the step instructions completely before starting
2. Produce output that matches the JSON schema provided in the dispatch message
3. Submit output via `beacon_submit_step`
4. Log progress at each major milestone via `beacon_log_progress`
5. Your `agentId` is automatically included in tool calls

### What you MUST NOT do

- Generate deliverables outside your step's scope (e.g., do not generate images if your step is "write copy")
- Move the task to Done or any other column — the workflow engine handles task state
- Message main-operator with "TASK COMPLETE" — workflow tasks complete through `beacon_submit_step`, not messages
- Create subtasks for other agents — the workflow defines who does what
- Attempt to read or infer what future steps contain
- Resubmit the same output after a rejection without addressing the feedback — the server detects near-duplicates and rejects them
- Use tools listed in "TOOL RESTRICTIONS" if present in the dispatch message

### After rejection

If your step is re-dispatched with a "REVISION REQUIRED" section, the reviewer found a problem with your previous output. You MUST:
1. Read the rejection reason carefully
2. Identify what specifically needs to change
3. Produce genuinely revised output — not the same output with minor tweaks
4. Submit via `beacon_submit_step` as before

### What happens automatically

- Output is validated against JSON Schema server-side (invalid = error with details)
- Extra fields beyond the schema are rejected (additionalProperties is enforced)
- The workflow engine advances to the next step or gate after valid submission
- Gates pause the workflow for human review — you are never asked to review gates
- If a gate rejects, the relevant agent is re-dispatched with feedback and previous output
- The watchdog monitors for stuck or out-of-scope behavior
- Workflow tasks cannot be moved to Done directly — only the workflow engine can do this
