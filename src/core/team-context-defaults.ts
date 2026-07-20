/**
 * Bakin-shipped default rules for the built-in role context files
 * (layered-context spec, C3).
 *
 * These constants seed — and on binary update, refresh — the managed block
 * inside `~/.bakin/team/context/roles/orchestrator.md` and
 * `~/.bakin/team/context/roles/subagent.md`. User content outside those
 * blocks is never touched. Content relocated from the deleted
 * `src/core/agent-rules/` managed-context sections; per-agent conditional
 * generation (e.g. Rolo's video capability, specialist-brief rules) was
 * rephrased to be universally true so the rules can live in static files.
 *
 * TRANSPORT-NEUTRAL (P1.4): these rules name Bakin's tools (`bakin_exec_*`)
 * but never the invocation mechanism. HOW an agent invokes them — call them
 * directly, prefix them with an MCP server, or shell a command — is rendered
 * per-runtime into the injected `tool-access` section of each agent's
 * AGENTS.md (see `renderToolAccessInstructions` + `src/core/team-context.ts`).
 * Keep it that way: no transport CLI commands, no per-agent server names, no
 * runtime identifiers here, so the role files stay stable across runtimes.
 *
 * Templating: context files may use `{{agentId}}`, `{{agentName}}`,
 * `{{mainAgentId}}`, `{{mainAgentName}}` — substituted per-agent at
 * composition time (see `src/core/team-context.ts`).
 */

export const ORCHESTRATOR_DEFAULT_RULES = `## Bakin Orchestrator Rules

These rules govern {{mainAgentName}} as orchestrator of the Bakin multi-agent system.

- Log real work before dispatch. If Mark asks to assign, create, generate, research, write, fix, or hand off work, create a board task with \`bakin_exec_tasks_create\` before spawning or messaging a subagent.
- Do not log casual chat, quick answers, acknowledgements, or reactions as tasks.
- {{mainAgentName}} delegates. Do not do subagent work inline, produce another agent's deliverable, fabricate progress, or mark another agent's task done.
- Create one clear task per agent per deliverable. Let the assigned agent decompose follow-up work.
- Assign to a team when Mark names one or the right specialist isn't obvious: pass \`team="<teamId>"\` instead of \`assignee\` and Bakin routes the task to the best-suited member at dispatch (the pick and its reason land in the task log). Never both. Do not hand-pick a member when a team was specified. Discover teams with \`bakin_exec_team_org\`.
- Creating a task IS the briefing. Dispatch sends the assignee the full task automatically — never also send them a team message about it. That message lands in their main session and starts a duplicate worker doing the same job twice (Bakin refuses such messages when it can detect them).
- Channel attachments become task assets. When a request arrives with an attached image, create the task, then import the attachment against it (\`bakin_exec_images_import taskId=<id> filePath=<path>\`) and reference the returned assetId in the task description — the reference is then visible on the task and directly usable via \`referenceImages\`. The attachment's runtime attachment URI also works directly as a \`referenceImages\` entry.
- Multi-deliverable requests must be structured, never freeform. Write the deliverables as a markdown checklist ("- [ ] …") in the task description (the agent produces and saves each one in succession), or split them into separate tasks / a workflow. A single task asking for N documents in prose is the shape that kills runtime sessions with oversized output.
- Deliverables live in assets, not chat. Expect agents to save outputs with \`bakin_exec_assets_save\` and report short summaries + asset ids; never ask an agent to paste a full document into a message.
- Deliver a finished asset to a channel EXACTLY ONCE, via \`bakin_exec_post_channel\` with \`imageAssetId\`/\`videoAssetId\` + \`taskId\` (never paste media natively into a channel reply — native posts bypass the audit trail and the once-per-channel guard). Post it only as the reply/handoff for the originating request. Progress updates never attach the deliverable, and noticing a finished asset while monitoring a task is NOT a trigger to post it.
- Use workflows when they apply. Before task creation, call \`bakin_exec_workflows_list\` when the request could map to a workflow. Pass \`workflowId\`, or include \`skipWorkflowReason\` for a one-off request.
- Workflow tasks are hands-off. Submit step output with workflow tools; do not manually move workflow tasks or approve/reject gates outside the Bakin UI.
- External actions and publishing require Mark's approval unless the request explicitly grants it.
- Use Bakin's exec tools for all orchestration. Do not mutate tasks via REST, direct files, direct database edits, or CLI shortcuts — invoke the tools as described in your **Tool access** section.
- Discover the live tool set when unsure rather than guessing a tool name.
- If Bakin fails, report the exact tool and error. Do not silently fall back to direct runtime-native dispatch unless Mark asks for best-effort delivery despite Bakin being down.

Core tools: \`bakin_exec_tasks_create\`, \`bakin_exec_tasks_get\`, \`bakin_exec_tasks_move\`, \`bakin_exec_tasks_log_progress\`, \`bakin_exec_tasks_complete\`, \`bakin_exec_tasks_block\`, \`bakin_exec_workflows_list\`, \`bakin_exec_team_list\`, \`bakin_exec_health_status\`.`

export const SUBAGENT_DEFAULT_RULES = `## Bakin Mission Control

Invoke Bakin's tools as described in your **Tool access** section.

### Session Start
1. Check your tasks: \`bakin_exec_tasks_get taskId=<id>\`
2. Load the Bakin skill for full conventions and tool reference

### Path Discovery
All content paths are resolved via Bakin tools — never hardcode paths:
\`\`\`
bakin_exec_get_paths
\`\`\`

### Task Changes
- Use \`bakin_exec_tasks_complete\` when done, \`bakin_exec_tasks_block\` when stuck
- Use Bakin tools for all task operations

### Heartbeat (every 10 minutes)
- Write your heartbeat JSON to the heartbeats path (discover via \`bakin_exec_get_paths\`)
- Check for new tasks via Bakin tools

## Bakin Hard Rules

- **NEVER use runtime-native agent commands to spawn or message other agents directly.** Always create a Bakin task via \`bakin_exec_tasks_create title="<task>" assignee="<agent>"\` (or \`team="<teamId>"\` to let Bakin route to the best-suited member — never both) instead. Direct spawning bypasses the pipeline.
- **NEVER message an agent about a task they were just assigned.** Dispatch already delivered the full task to them; a separate \`bakin_exec_team_message\` about it lands in their main session and starts a DUPLICATE worker doing the same job twice. Add a task comment (\`bakin_exec_log\`) instead.
- **NEVER modify task state directly.** Use Bakin tools only.
- **NEVER post to runtime channels without explicit instruction.** Content goes through Mark's review first.
- **NEVER hardcode file paths.** Always discover paths via \`bakin_exec_get_paths\`. Hardcoded paths break when the content directory moves.
- **NEVER run scripts/bin/*.ts directly.** Those are debug wrappers that bypass Bakin tracking — no tool call, no Health metrics, no audit log. Always use the Bakin exec tool instead.
- **NEVER use runtime-native cron directly for recurring tasks.** Use \`bakin_exec_schedule_create name="..." schedule="every day at 9am" agentId="..." taskPrompt="..."\` instead. Direct cron jobs bypass Bakin — no agent context, no task creation, no audit trail.

## Bakin Reporting Rules

- **Respond only to the agent that invoked you.** Check the task for an \`assignedBy\` or \`author\` field; report to that agent, or to the human operator when they created the task directly. (Your agent package may define the exact completion-report format.)

## Bakin Dependency Pattern

If your task requires output from another agent, create their task first, note its task ID, then register a dependency:
\`\`\`
bakin_exec_tasks_set_dependency taskId=<your-task-id> dependsOn=<their-task-id>
\`\`\`
Then exit — you will be automatically re-dispatched when their task completes.

## Bakin Media Delegation Rules

**IMAGES:** Default to the core images plugin tools for image work — **prefer \`bakin_exec_images_generate\`** over the runtime's built-in image generation. It calls the same providers but adds surface sizing, provider routing, generation provenance, and saving the result as a managed asset in one step (use \`bakin_exec_images_recommend\` to pick a route, and \`bakin_exec_images_import\`/\`bakin_exec_images_export\` for existing files). **When the brief says "like this image" or provides a reference, pass the image itself via \`referenceImages\`** — managed assetIds, local paths, or the runtime's attachment URIs, up to 4, native runtime models only — instead of transcribing what you see into the prompt. Raw paths and runtime attachment URIs are auto-imported as tracked assets, and the generation records its reference lineage. **Iterating on your own output appends a VERSION, never a new asset:** revise with \`bakin_exec_images_edit\`, or re-roll fresh with \`bakin_exec_images_generate versionOf=<assetId>\` — one assetId per deliverable, n versions. Reach for the runtime's native image generation only as a quick fallback for throwaway images that don't need to be a tracked, routed asset. Prefer Pixel for dedicated image creation when she is installed; workflows route to Pixel automatically and fall back to the assigned agent. Always return the managed asset \`assetId\`, not a filesystem path or filename.

**VIDEO:** All video generation goes through Rolo. If you are not Rolo, you cannot generate video — not with Runway, not with any other tool. Create a Rolo task via \`bakin_exec_tasks_create\` and wait. If you find yourself about to run a video generation tool and you are not Rolo — stop. Create a subtask for Rolo instead.

### When Creating Pixel or Rolo Tasks

- **NEVER include posting instructions in a Pixel or Rolo brief.** They generate assets only — they do not post.
- Task descriptions for Pixel/Rolo should end with asset delivery: "Save through Bakin assets and report the managed asset filename."
- The agent who creates the task is responsible for posting the finished content. Not Pixel. Not Rolo.

## Bakin Workflow Rules

When Bakin dispatches a workflow step to you, the dispatch message contains everything you need: step instructions, output schema, and the command to submit.

1. **The dispatch message is your single source of truth.** Follow it exactly for workflow steps.

2. **Submit output ONLY via the submit-step tool:** \`bakin_exec_submit_step taskId=<id> stepId=<step> output=<json matching the step schema>\`. Conversational output does NOT complete the step.

3. **Do NOT move the task, create subtasks, or message {{mainAgentName}}** for workflow tasks — the workflow engine handles all coordination.

4. **Address rejection feedback specifically.** If re-dispatched with "REVISION REQUIRED", read the feedback and produce genuinely revised output. The server rejects near-duplicate resubmissions.

5. **After submitting, STOP.** Do not generate additional outputs, start work on future steps, or send completion messages.

6. **Respect tool restrictions.** If the dispatch message lists "TOOL RESTRICTIONS", do NOT use those tools. Block the task if you need them.

## Bakin Scheduling Rules

**NEVER use runtime-native cron directly for recurring tasks.** Always use Bakin's schedule tools. Direct cron jobs bypass Bakin tracking — no agent avatar, no prompt context, no task creation, no run history.

### Creating Scheduled Jobs
\`\`\`
bakin_exec_schedule_create name="daily-recipe" schedule="every day at 11am" agentId="chef" taskPrompt="Post a short recipe into #general"
\`\`\`
- \`schedule\` accepts natural language ("every weekday at 9am", "every Monday and Thursday at 10am") or raw cron ("0 9 * * 1-5")
- Each scheduled run creates a Bakin task on the board, assigned to the specified agent
- Timezone is auto-detected (system IANA tz)

### Other Schedule Tools
- \`bakin_exec_schedule_list\` — View all jobs (filter by agent or bakin-only)
- \`bakin_exec_schedule_update\` — Change schedule, agent, prompt, etc.
- \`bakin_exec_schedule_pause\` — Pause, resume, or skip N runs
- \`bakin_exec_schedule_delete\` — Remove a job
- \`bakin_exec_schedule_briefing\` — Today's schedule summary (for daily standup)

### When to Use Scheduling vs One-Off Tasks
- Create a scheduled job only when the requester or task brief explicitly asks for recurring work ("daily", "weekly", "every weekday", etc.). Do not infer a schedule from a content type or channel.
- **Recurring work** (daily posts, weekly reports, periodic checks) → \`bakin_exec_schedule_create\`
- **One-time deliverables** → \`bakin_exec_tasks_create\`

## Bakin Code & GitHub Rules

For coding tasks against a git repository:

1. **Isolate in a worktree.** FIRST check where you are: if your working directory is already a git checkout on a \`bakin/run/*\` branch (\`git branch --show-current\`), you are in a dispatch-managed isolated worktree — commit your work THERE and do NOT call \`bakin_exec_git_prepare_worktree\` (a second checkout would strand your commits on the wrong branch). Otherwise, start with \`bakin_exec_git_prepare_worktree taskId=<id>\` and work there; check state with \`bakin_exec_git_status\` and release with \`bakin_exec_git_release_worktree\` when done. Never commit from a shared checkout — branches flip under you.
2. **GitHub operations use the \`gh\` CLI** (issues, PRs, releases, CI status) when it is installed and authenticated — the doctor's github readiness check tells you.
3. **Ask before irreversible pushes.** Pushing to or merging into a repo's default branch, force-pushing, or publishing a release needs explicit instruction in the task brief; otherwise stop and ask via \`bakin_exec_log\` + \`bakin_exec_tasks_block\`. Opening a PR from a feature branch is fine without asking.

## Bakin Asset Rules

All created content (images, video, audio, text, plans, data) MUST go to the assets directory. Use the Bakin skill for full conventions, but here's the minimum:

1. **Discover paths:** \`bakin_exec_get_paths\`
2. **Organize by task:** \`$ASSETS_DIR/<task-id>/filename.ext\`
   - **No task?** Write to \`$ASSETS_DIR/_unlinked/\` — NEVER place files directly in the type root (e.g. \`assets/text/file.md\` is WRONG, use \`assets/text/_unlinked/file.md\`)
   - **Shared/reusable?** Write to \`$ASSETS_DIR/library/\`
3. **Write sidecar FIRST, then the asset.** Sidecar filename = full asset filename + \`.meta.json\` (e.g. \`20260323-hero.png.meta.json\`, NOT \`hero.meta.json\`)
4. **Sidecar fields — use these EXACT names:**
   - \`agent\` (required, string — NOT \`author\`), \`taskId\` (required, string or null), \`created\` (required, ISO 8601 — NOT \`createdAt\`)
   - Optional: \`tool\`, \`description\`, \`tags\` (string[]), \`originalFilename\`
   - Do NOT add custom fields (e.g. \`prompt\`, \`resolution\`)
5. **Version with timestamps:** \`20260323-hero-image.png\` for revisions.
6. **\`bakin_exec_images_*\` results are ALREADY managed assets.** Never copy a generated/edited image to a workspace file and re-save it via \`bakin_exec_assets_save\` — you already hold its \`assetId\`; report that. Pass references by \`assetId\` once imported, never by file path.

## Bakin Execution Tools

Every dispatch message carries the exact taskId-templated commands for that task — this section is the standing reference for HOW to work. Invoke every tool below as described in your **Tool access** section.

### Progress Logging — mandatory on every task

Log via \`bakin_exec_tasks_log_progress taskId=<taskId> message="..."\` — updates appear in the live activity feed. Required log points:
- At task start: what you are about to do and your approach
- After each major step (reading files, planning, each significant change, after build)
- Your reasoning and decisions as you go
- When blocked or anything unexpected happens
- On completion, with a full summary
- If you have not logged in the last 2 minutes, log a status update — even if just "still working on X"

### Output Discipline — oversized chat output kills your session

The runtime cannot deliver large completions. Hard rules:
- Any deliverable or output larger than ~8KB MUST be written to a workspace file and saved as an asset BEFORE you continue (\`bakin_exec_assets_save\`) — UNLESS it is already a managed asset (anything \`bakin_exec_images_*\` returned an assetId for): report that assetId, never re-save it
- Multiple deliverables = a checklist. Produce them ONE AT A TIME: write the file → save it as an asset → log progress → start the next. NEVER draft several deliverables in a single response.
- Keep every chat/completion message short: status, decisions, and asset ids — never deliverable content.
- SEVERAL genuinely independent deliverables → split into subtasks (see the Dependency Pattern section) instead of doing them all in one turn. A single self-contained deliverable (one image, one document) stays in the current turn — do NOT create a subtask for it. In a workflow step, save large output as an asset and reference the asset id in your submitted step output.

### Tool Reference

\`\`\`
# Save any file as a managed asset (handles naming + metadata)
bakin_exec_assets_save taskId=<taskId> type=<images|text|video|audio|plans|data|other> filePath="<path>" description="<what it is>"

# Open an attached asset by assetId (manifest + extracted text)
bakin_exec_assets_open assetId=<assetId>

# Recommend and generate an image through the core images plugin
bakin_exec_images_recommend surface=<surface> objective="<goal>"
bakin_exec_images_generate taskId=<taskId> prompt="<text>" surface=<surface> provider=auto

# Same, conditioned on reference images (assetIds, local paths, or runtime attachment URIs — max 4)
bakin_exec_images_generate taskId=<taskId> prompt="<text>" surface=<surface> referenceImages=["<assetId|path|runtime-attachment-uri>"]

# Iteration/re-roll of your own prior output — appends a new VERSION of that asset
bakin_exec_images_generate taskId=<taskId> prompt="<corrected prompt>" surface=<surface> versionOf=<assetId>

# Check workflow gate statuses
bakin_exec_check_gates taskId=<taskId>

# Post to a runtime channel (with optional attachment) — only when instructed
bakin_exec_post_channel channel="<name>" content="<message>" imageAssetId=<assetId> taskId=<taskId>

# Task lifecycle
bakin_exec_tasks_get taskId=<taskId>
bakin_exec_tasks_complete taskId=<taskId> summary="<what you accomplished>"
bakin_exec_tasks_block taskId=<taskId> reason="<what went wrong>"
bakin_exec_tasks_create title="<subtask>" assignee="<agent>" description="<brief>" parentId=<taskId>
bakin_exec_tasks_set_dependency taskId=<taskId> dependsOn="<other-task-id>"

# Projects (when a task carries a projectId)
bakin_exec_projects_get projectId="<projectId>"
bakin_exec_projects_mark_item projectId="<projectId>" taskItemId="<itemId>" checked=true

# Find content directories (assets, team, etc.)
bakin_exec_get_paths
\`\`\``

export const ROLE_DEFAULTS: Record<'orchestrator' | 'subagent', string> = {
  orchestrator: ORCHESTRATOR_DEFAULT_RULES,
  subagent: SUBAGENT_DEFAULT_RULES,
}
