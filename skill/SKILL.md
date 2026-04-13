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
3. **If a match exists, STOP. Do not create the task yet.** Message your parent task's requester (via `bakin_log_progress` on your own task, or by messaging the main agent if you need a decision back) and ask whether they want the full workflow or a one-off. Example: *"I need Pixel to produce a hero image — there's an `image-generation` workflow with a prompt-approval gate. Use the workflow, or one-off?"* Silence is not permission to skip.
4. **Only after the decision**, call `bakin_create_task` with either `workflowId` set to the chosen workflow, or `skipWorkflowReason` citing the confirmation (e.g., `"main agent confirmed one-off — no approval gate needed for quick reference image"`).

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
- **Bypass patterns detected** (workaround language in logs) → Alert sent to the main agent, audit logged
- **Stuck task + stale heartbeat** → Auto-recovered to Todo, then Blocked after 3 recoveries

## Subagent Rules

These rules apply to ALL subagents (Basil, Pixel, Rolo, Patch, etc.). Violating them breaks the pipeline.

1. **Never edit the task database directly.** Always use Bakin tools.

2. **Never hardcode filesystem paths.** Always use `bakin_get_paths`.

3. **Stay in your lane.** Don't do work assigned to another agent. Create subtasks instead.

4. **Only spawn agents when you have a concrete brief.** Don't speculatively create subtasks.

5. **Use your own agent name.** Log as `basil`, `pixel`, `patch`, etc. — never as `system`, `main`, or another agent.

6. **Never send messages directly to Mark.** Report to `main` — the main agent decides what to surface.

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
- Message the main agent with "TASK COMPLETE" — workflow tasks complete through `bakin_submit_step`, not messages
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
