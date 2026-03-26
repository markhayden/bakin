---
name: beacon
description: Mission control integration for multi-agent coordination. Provides task management, logging, search, and agent communication via mcporter MCP tools. Required for all agents in the Beacon ecosystem.
---

# Beacon Mission Control

You are part of a multi-agent team coordinated by Beacon. You interact with Beacon through **mcporter** — a CLI that calls Beacon's MCP server.

Your Beacon MCP server is `beacon-<your-agent-name>` (e.g., `beacon-pixel`, `beacon-basil`). Your dispatch message will tell you which server to use.

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

## Task Lifecycle

Tasks flow through columns: **TODO** -> **In Progress** -> **Done** (or **Blocked**).

When you receive a task:
1. **Move it to In Progress immediately** (before doing any work)
2. Log that you've started working on it
3. Log progress at every major step (not just start and done)
4. If blocked, block the task with a clear reason
5. When done, report complete with a summary

Valid transitions: todo→inProgress/blocked/done, inProgress→done/blocked/todo, blocked→todo/inProgress, done→confirmed/todo. The `confirmed` column is terminal — nothing leaves it.

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

### Writing Assets (REQUIRED CONVENTION)

All agent-created content (images, video, audio, text, plans, data) MUST be written to the assets directory. Assets are organized by type and task ID.

**Step 1: Get the asset path** via `beacon_get_paths`

**Step 2: Create the task directory**
```bash
mkdir -p "$ASSETS_DIR/<task-id>"
```

**Step 3: Write the sidecar FIRST, then the asset**

Always write the `.meta.json` sidecar file BEFORE the asset file. This ensures intent is captured even if the asset write fails.

**NAMING RULE:** The sidecar filename is ALWAYS the full asset filename (including extension) + `.meta.json`.
- Asset: `20260323-hero-image.png` → Sidecar: `20260323-hero-image.png.meta.json`
- Asset: `intro-clip.mp4` → Sidecar: `intro-clip.mp4.meta.json`
- WRONG: `hero-image.meta.json` (missing date prefix and file extension)
- WRONG: `pop-tart.meta.json` for asset `20250727-pop-tart.png`

**EXACT FIELDS — use these names verbatim, do not rename or add custom fields:**

| Field             | Required | Type     | Notes                                          |
|-------------------|----------|----------|-------------------------------------------------|
| `agent`           | YES      | string   | Your agent name. NOT `author` or `name`.        |
| `taskId`          | YES      | string   | The task ID. Use `null` if no task context.      |
| `created`         | YES      | string   | ISO 8601 UTC timestamp. NOT `createdAt`.         |
| `tool`            | no       | string   | Tool used to generate (e.g. `"dall-e-3"`)        |
| `description`     | no       | string   | Brief human-readable description of the asset    |
| `tags`            | no       | string[] | Tags for filtering and search                   |
| `originalFilename`| no       | string   | Original filename if the file was renamed        |

Do NOT add custom fields (e.g. `prompt`, `resolution`, `aspectRatio`). Use `description` and `tags` for additional context.

```bash
# Sidecar filename = full asset filename + .meta.json
cat > "$ASSETS_DIR/<task-id>/hero-image.png.meta.json" <<EOF
{
  "agent": "<your-agent-name>",
  "taskId": "<task-id>",
  "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "tool": "dall-e-3",
  "description": "Hero image for the blog post",
  "tags": ["hero", "blog"]
}
EOF

# Then write the actual asset file
# (your image generation/download writes to $ASSETS_DIR/<task-id>/hero-image.png)
```

**Versioning convention:** Use timestamp-prefix filenames for revisions: `20260323-hero-image.png`, `20260324-hero-image.png`.

**Shared/reusable assets:** Write to the `library/` subdirectory instead of a task ID: `$ASSETS_DIR/library/brand-logo.png`.

**Assets without a task:** Write to `_unlinked/`: `$ASSETS_DIR/_unlinked/exploratory-sketch.png`.

**Asset type directories:**
- `assets.text` — markdown, txt (blog posts, briefs, scripts)
- `assets.images` — png, jpg, gif, webp, svg
- `assets.video` — mp4, mov, webm
- `assets.audio` — mp3, wav, m4a
- `assets.plans` — yaml, markdown strategy docs
- `assets.data` — json, csv, xml
- `assets.other` — anything else

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
- **Bypass patterns detected** (workaround language in logs) → Alert sent to roscoe, audit logged
- **Stuck task + stale heartbeat** → Auto-recovered to Todo, then Blocked after 3 recoveries

## Subagent Rules

These rules apply to ALL subagents (Basil, Pixel, Rolo, Patch, etc.). Violating them breaks the pipeline.

1. **Never edit TASKBOARD.md directly.** Direct edits are auto-reverted. Always use Beacon tools.

2. **Never hardcode filesystem paths.** Always use `beacon_get_paths`.

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
- Message roscoe with "TASK COMPLETE" — workflow tasks complete through `beacon_submit_step`, not messages
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
