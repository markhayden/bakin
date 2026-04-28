/**
 * Managed-block infrastructure for per-agent AGENTS.md blocks.
 *
 * The doctor runs `applyAllManagedBlocks` to keep 7 marker-fenced blocks
 * (mission-control, hard-rules, dependency-pattern, media-delegation,
 * workflow-rules, scheduling-rules, asset-rules) in sync across every
 * non-main agent's `~/.openclaw/workspaces/{agentId}/AGENTS.md`. The
 * marker primitives (extractBlock, getBlockState, injectBlock) live in
 * packages/core/src/agent-packages/managed-blocks.ts and are shared
 * with the agent-package installer/projector.
 *
 * The orchestrator-rules block targets the main agent's
 * `~/.openclaw/workspace/AGENTS.md` and is owned by
 * plugins/health/lib/system-checks/orchestrator-rules.ts (which imports
 * AGENT_RULES_BLOCK_START/END + resolveOrchestratorRules from here).
 *
 * Migrated from src/core/doctor.ts in #139 C8 (orchestrator-rules
 * constants + template) and #139 C9 (MANAGED_BLOCKS + check helper +
 * applyAllManagedBlocks). The CLI's `bakin agent-rules` subcommand
 * imports directly from this module.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import {
  extractBlock,
  getBlockState,
  injectBlock,
} from '../../../packages/core/src/agent-packages/managed-blocks'
import { createLogger } from '../../../src/core/logger'
import { getMainAgentId, getMainAgentName } from '../../../src/core/main-agent'
import { getHookRegistry } from '../../../src/lib/plugin-registry'
import { getAgentIds } from '../../../packages/core/src/openclaw-config'
import { getOpenClawPath } from '../../../packages/core/src/openclaw-home'
import type { HealthCheckResult } from '../../../packages/core/src/plugin-types'
import type { AgentRuntimeAdapter, RuntimeAgent } from '../../../packages/core/src/adapters/runtime'

const log = createLogger('managed-blocks')

// ─── Result constructors (inlined; matches workflows precedent) ─────────────

function ok(check: string, message: string): HealthCheckResult {
  return { check, status: 'ok', message, autoFixable: false }
}
function warn(check: string, message: string, autoFixable = false): HealthCheckResult {
  return { check, status: 'warn', message, autoFixable }
}
function error(check: string, message: string): HealthCheckResult {
  return { check, status: 'error', message, autoFixable: false }
}
function fixed(check: string, message: string): HealthCheckResult {
  return { check, status: 'fixed', message, autoFixable: true }
}

// ─── Orchestrator rules block — constants written into user state ─────────

export const AGENT_RULES_BLOCK_START = '<!-- bakin:orchestrator-rules:start -->'
export const AGENT_RULES_BLOCK_END = '<!-- bakin:orchestrator-rules:end -->'

const ORCHESTRATOR_RULES_CONTENT = `## Bakin Orchestrator Rules

> Auto-managed by \`bakin agent-rules --apply\`. Do not edit this block manually.

These rules govern AGENT_NAME_PLACEHOLDER as orchestrator of the Bakin multi-agent system.

1. **Every task gets logged before work begins.** Call \`bakin_exec_tasks_create\` via MCP before spawning any subagent or producing any deliverable. No exceptions.

    A task is anything that spawns a subagent, produces a deliverable (image, code, document, post), requires research, or gets handed off. NOT a task: quick questions, reactions, casual banter, acknowledgements. If it involves a verb (generate, build, research, write, fix, create), it's a task — log it first, then do it.

2. **Never do subagent work inline.** AGENT_NAME_PLACEHOLDER delegates — AGENT_NAME_PLACEHOLDER does not generate images, write long-form copy, or produce video. That's what the team is for.

3. **High-level tasks only on the board.** Don't break tasks into subtasks yourself. Create one task, assign it, let the subagent decompose it.

4. **Subagents own their handoffs.** If Basil needs Pixel, Basil creates that task — not AGENT_NAME_PLACEHOLDER. Let the pipeline flow naturally.

5. **Approval gates are non-negotiable.** Before publishing, sending, or any external action: pause and confirm with Mark unless pre-approved.

6. **Monitor the pipeline, don't micromanage.** Check heartbeats, watch for blocked tasks, intervene when stuck — but don't shadow-execute tasks that are in flight.

7. **One task per agent per piece of content.** Don't assign the same content to multiple agents in parallel. Let the assigned agent drive.

8. **AGENTS.md is your rulebook, not the subagents'.** The Bakin skill (SKILL.md) governs subagents. AGENTS.md governs you.

9. **Workflow tasks are hands-off.** If a task has a \`workflowId\`, the workflow engine manages step progression. Do not manually move workflow tasks between columns, do not produce step output yourself, and do not interfere with gates outside the Bakin UI.

10. **Every task requires a workflow decision. Workflows are the default — skipping is the exception.** When calling \`bakin_exec_tasks_create\`, you MUST either specify a \`workflowId\` or explain why none applies via \`skipWorkflowReason\`:
    - With workflow: \`{ title, assignee, workflowId: "<id>" }\`
    - Without workflow: \`{ title, assignee, skipWorkflowReason: "<reason>" }\`

    **Preflight sequence — follow these steps in order, every time:**
    1. Call \`bakin_exec_workflows_list\` and read the catalog.
    2. Check if any workflow matches the request (by title keywords, agent, or intent).
    3. **If a matching workflow exists, DO NOT create the task yet.** Reply to the requester with the workflow's tradeoffs and ask them to choose. Example: *"There's an \`image-generation\` workflow with a prompt-approval gate — want the full workflow, or should I do a quick one-off?"* **Silence is not permission to skip.** Wait for an explicit choice.
    4. Only after the requester's decision, call \`bakin_exec_tasks_create\` — either with \`workflowId\` set to what they picked, or with \`skipWorkflowReason\` citing the confirmation (e.g., \`"Mark approved skipping image-generation in chat — one-off horse image, no approval gate needed"\`).

    **Chat requests that sound simple are still workflow candidates if a matching workflow exists.** "Have Pixel make an image of a horse" is NOT a reason to bypass \`image-generation\`. The user's phrasing doesn't change the rule — the catalog does.

    **Your judgment is not enough to skip.** "This feels heavier than needed," "this is a one-off," and "this is quick" are NOT valid reasons on their own. The only valid reasons to skip without asking first: (a) no workflow in the catalog matches the request, or (b) the requester has already said in this conversation that they want a one-off.

    The catalog snapshot below is a hint, not the source of truth. **Always trust the live output of \`bakin_exec_workflows_list\` over any text in this file.** The snapshot is frozen at the last doctor run and may be stale, empty, or out of date; the tool is authoritative.

    Workflow catalog snapshot (last rendered by \`bakin agent-rules --apply\`):
WORKFLOW_CATALOG_PLACEHOLDER

The skip reason is logged to the audit trail for debugging. Always verify against \`bakin_exec_workflows_list\` before deciding a workflow doesn't exist.

11. **Gate approvals go through the UI.** When a workflow gate is reached, a notification is sent and the task card shows "Awaiting Approval" in the Bakin UI. Tell Mark a gate is waiting — do NOT approve or reject gates yourself. Mark handles gates in the task drawer.

12. **MCP tools only. No REST. No CLI. Ever.** All orchestration happens through the \`bakin_exec_*\` MCP tools. OpenClaw has no native MCP client, so you reach them by shelling out to **mcporter** — a CLI shim that relays your call to Bakin's MCP server. Your server is \`bakin-AGENT_ID_PLACEHOLDER\`.

    **Invocation pattern (positional args):**
    \`\`\`
    mcporter call bakin-AGENT_ID_PLACEHOLDER.<tool_name> key=value key=value
    \`\`\`

    **Invocation pattern (JSON args, for nested/complex inputs):**
    \`\`\`
    mcporter call bakin-AGENT_ID_PLACEHOLDER.<tool_name> --args '{"key":"value","nested":{"k":"v"}}'
    \`\`\`

    **Discovery:** \`mcporter list bakin-AGENT_ID_PLACEHOLDER --schema\` prints every available tool with its input schema. Run it when you're not sure what's available. Do NOT guess tool names.

    The REST API at \`/api/plugins/*\` and the \`bakin\` CLI both exist for humans, the web UI, and scripting — NOT for you. If a capability appears to be missing from MCP, STOP and tell Mark so we can add the tool. Do not curl, do not fetch, do not shell out to \`bakin tasks ...\`, do not write scripts that hit \`/api/...\`. Every REST call from an agent surfaces on the Health dashboard as a bad-habit signal.

    **Core orchestration tools** (non-exhaustive — run discovery for the full list):
    - Tasks: \`bakin_exec_tasks_create\`, \`bakin_exec_tasks_get\`, \`bakin_exec_tasks_move\`, \`bakin_exec_tasks_log_progress\`, \`bakin_exec_tasks_complete\`, \`bakin_exec_tasks_block\`
    - Workflows: \`bakin_exec_workflows_list\`, \`bakin_exec_workflows_get_definition\`, \`bakin_exec_workflows_start\`, \`bakin_exec_workflows_get_instance\`, \`bakin_exec_workflows_get_step\`, \`bakin_exec_workflows_complete_step\`
    - Team: \`bakin_exec_team_list\`, \`bakin_exec_team_status\`, \`bakin_exec_team_message\`
    - Health: \`bakin_exec_health_status\`, \`bakin_exec_health_doctor\`

    **Example — create a task for Pixel:**
    \`\`\`
    mcporter call bakin-AGENT_ID_PLACEHOLDER.bakin_exec_tasks_create --args '{"title":"Create a stylized image of a horse","assignee":"pixel","skipWorkflowReason":"one-off request, no workflow matches"}'
    \`\`\`

13. **Never impersonate other agents.** You are AGENT_NAME_PLACEHOLDER. You do not speak as Basil, Pixel, Flint, Nori, or any other team member. You do not write their task updates, fabricate their progress logs, or mark their tasks done on their behalf. If an agent is silent or stuck, create a follow-up task or tell Mark — do not ventriloquize.

14. **The channel doesn't change the rules.** These rules apply whether Mark is talking to you in the Bakin UI, a group chat, the terminal, or any other surface. There is no "informal mode" where CLI, REST, or inline subagent work becomes acceptable.`

/** Build the workflow catalog from available definitions for embedding in rules */
async function buildWorkflowCatalog(): Promise<string> {
  try {
    const hooks = getHookRegistry()
    const defs = await hooks.invoke<Array<{ definition: Record<string, unknown>; name: string }>>('workflows.listDefinitions', {}) ?? []
    if (defs.length === 0) return '   (no workflows defined yet)'
    return defs.map(d => {
      const steps = (d.definition.steps || []) as Array<Record<string, unknown>>
      const agents = [...new Set(steps.filter((s) => typeof s.agent === 'string').map((s) => s.agent as string))]
      return `   - \`${d.name}\`: ${d.definition.description || d.definition.name}${agents.length ? ` (agents: ${agents.join(', ')})` : ''}`
    }).join('\n')
  } catch {
    return '   (query GET /api/plugins/workflows/definitions at runtime)'
  }
}

/** Resolve the orchestrator rules template with the current workflow catalog and main agent id */
export async function resolveOrchestratorRules(): Promise<string> {
  const agentId = getMainAgentId()
  const agentName = getMainAgentName()
  return resolveOrchestratorRulesForAgent(agentId, agentName)
}

export async function resolveOrchestratorRulesForAgent(agentId: string, agentName: string): Promise<string> {
  return ORCHESTRATOR_RULES_CONTENT
    .replace('WORKFLOW_CATALOG_PLACEHOLDER', await buildWorkflowCatalog())
    .replaceAll('AGENT_ID_PLACEHOLDER', agentId)
    .replaceAll('AGENT_NAME_PLACEHOLDER', agentName)
}

// ─── Generic managed-block helper ─────────────────────────────────────────

interface ManagedBlockContext {
  mainAgentId: string
  mainAgentName: string
}

interface ManagedBlockDef {
  blockId: string
  contentFn: (agentId: string, context: ManagedBlockContext) => string
  agentFilter?: (agentId: string) => boolean // defaults to all non-main-agent
}

function defaultManagedBlockContext(): ManagedBlockContext {
  return { mainAgentId: getMainAgentId(), mainAgentName: getMainAgentName() }
}

function runtimeManagedBlockContext(agents: RuntimeAgent[]): ManagedBlockContext {
  const main = agents.find((agent) => agent.id === 'main')
    ?? agents.find((agent) => agent.role?.toLowerCase() === 'orchestrator')
    ?? agents[0]
  return {
    mainAgentId: main?.id ?? 'main',
    mainAgentName: main?.name ?? 'Main',
  }
}

/**
 * Check / inject / update a managed block in each agent's AGENTS.md.
 *
 * The marker primitives are imported from
 * packages/core/src/agent-packages/managed-blocks.ts (shared with the
 * agent-package installer/projector). This function is the doctor-shaped
 * wrapper around them: it translates marker state into HealthCheckResult
 * shapes and applies the autoFix policy.
 *
 * All managed blocks follow the same marker pattern:
 *   <!-- bakin:{blockId}:start -->
 *   {content}
 *   <!-- bakin:{blockId}:end -->
 */
function checkManagedBlock(def: ManagedBlockDef, autoFix: boolean, context = defaultManagedBlockContext()): HealthCheckResult[] {
  const results: HealthCheckResult[] = []
  const openclawBase = getOpenClawPath()
  const checkName = `agent-${def.blockId}`

  for (const agentId of getAgentIds()) {
    if (agentId === context.mainAgentId) continue
    if (def.agentFilter && !def.agentFilter(agentId)) continue

    const agentsPath = join(openclawBase, 'workspaces', agentId, 'AGENTS.md')

    if (!existsSync(agentsPath)) {
      results.push(warn(checkName, `AGENTS.md not found for ${agentId} — cannot verify ${def.blockId}`))
      continue
    }

    const current = readFileSync(agentsPath, 'utf-8')
    const expectedBody = def.contentFn(agentId, context).trim()
    const state = getBlockState(current, def.blockId)

    if (state === 'orphan-start' || state === 'orphan-end') {
      // Malformed marker pair — refuse to silently rewrite. The user's
      // intent isn't clear (mid-edit? merge conflict remnant?), and
      // overwriting could destroy unsynced work.
      results.push(error(
        checkName,
        `${def.blockId} block has malformed markers (${state}) in ${agentId}/AGENTS.md`,
      ))
      continue
    }

    if (state === 'absent') {
      if (!autoFix) {
        results.push(warn(checkName, `${def.blockId} block missing from ${agentId}/AGENTS.md`, true))
        continue
      }
      writeFileSync(agentsPath, injectBlock(current, def.blockId, expectedBody), 'utf-8')
      results.push(fixed(checkName, `Added ${def.blockId} block to ${agentId}/AGENTS.md`))
      continue
    }

    // state === 'present'
    const currentBody = extractBlock(current, def.blockId) ?? ''
    if (currentBody === expectedBody) {
      results.push(ok(checkName, `${def.blockId} in ${agentId}/AGENTS.md is up to date`))
    } else if (autoFix) {
      writeFileSync(agentsPath, injectBlock(current, def.blockId, expectedBody), 'utf-8')
      results.push(fixed(checkName, `Updated ${def.blockId} block in ${agentId}/AGENTS.md`))
    } else {
      results.push(warn(checkName, `${def.blockId} block is outdated in ${agentId}/AGENTS.md`, true))
    }
  }

  // Suppress lint warning for unused log import on hot paths — kept for
  // future debugging when block edits behave unexpectedly.
  void log

  return results
}

async function checkManagedBlockRuntime(
  runtime: AgentRuntimeAdapter,
  def: ManagedBlockDef,
  autoFix: boolean,
  agents: RuntimeAgent[],
  context: ManagedBlockContext,
): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []
  const checkName = `agent-${def.blockId}`

  for (const agent of agents) {
    const agentId = agent.id
    if (agentId === context.mainAgentId) continue
    if (def.agentFilter && !def.agentFilter(agentId)) continue

    const file = await runtime.agents.readWorkspaceFile(agentId, 'AGENTS.md')
    if (!file) {
      results.push(warn(checkName, `AGENTS.md not found for ${agentId} — cannot verify ${def.blockId}`))
      continue
    }

    const current = file.content
    const expectedBody = def.contentFn(agentId, context).trim()
    const state = getBlockState(current, def.blockId)

    if (state === 'orphan-start' || state === 'orphan-end') {
      results.push(error(
        checkName,
        `${def.blockId} block has malformed markers (${state}) in ${agentId}/AGENTS.md`,
      ))
      continue
    }

    if (state === 'absent') {
      if (!autoFix) {
        results.push(warn(checkName, `${def.blockId} block missing from ${agentId}/AGENTS.md`, true))
        continue
      }
      await runtime.agents.writeWorkspaceFile(agentId, { path: 'AGENTS.md', content: injectBlock(current, def.blockId, expectedBody) })
      results.push(fixed(checkName, `Added ${def.blockId} block to ${agentId}/AGENTS.md`))
      continue
    }

    const currentBody = extractBlock(current, def.blockId) ?? ''
    if (currentBody === expectedBody) {
      results.push(ok(checkName, `${def.blockId} in ${agentId}/AGENTS.md is up to date`))
    } else if (autoFix) {
      await runtime.agents.writeWorkspaceFile(agentId, { path: 'AGENTS.md', content: injectBlock(current, def.blockId, expectedBody) })
      results.push(fixed(checkName, `Updated ${def.blockId} block in ${agentId}/AGENTS.md`))
    } else {
      results.push(warn(checkName, `${def.blockId} block is outdated in ${agentId}/AGENTS.md`, true))
    }
  }

  return results
}

// ─── Managed block definitions ────────────────────────────────────────────

const MANAGED_BLOCKS: ManagedBlockDef[] = [
  {
    blockId: 'mission-control',
    contentFn: (agentId: string) => `## Bakin Mission Control

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

All Bakin interactions use **mcporter**. Your MCP server is \`bakin-${agentId}\`.

### Session Start
1. Check your tasks: \`mcporter call bakin-${agentId}.bakin_exec_tasks_get taskId=<id>\`
2. Load the Bakin skill for full conventions and tool reference

### Path Discovery
All content paths are resolved via mcporter — never hardcode paths:
\`\`\`bash
mcporter call bakin-${agentId}.bakin_exec_get_paths
\`\`\`

### Task Changes
- Use \`bakin_exec_tasks_complete\` when done, \`bakin_exec_tasks_block\` when stuck
- Use Bakin tools via mcporter for all task operations

### Heartbeat (every 10 minutes)
- Write your heartbeat JSON to the heartbeats path (discover via \`bakin_exec_get_paths\`)
- Check for new tasks via mcporter`,
  },

  {
    blockId: 'hard-rules',
    contentFn: (agentId: string) => `## Bakin Hard Rules

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

- **NEVER use \`openclaw agent\` to spawn or message other agents directly.** Always create a Bakin task via \`mcporter call bakin-${agentId}.bakin_exec_tasks_create title="<task>" assignee="<agent>"\` instead. Direct spawning bypasses the pipeline.
- **NEVER modify task state directly.** Use Bakin tools via mcporter only.
- **NEVER post to Discord without explicit instruction.** Content goes through Mark's review first.
- **NEVER hardcode file paths.** Always discover paths via \`mcporter call bakin-${agentId}.bakin_exec_get_paths\`. Hardcoded paths break when the content directory moves.
- **NEVER run scripts/bin/*.ts directly.** Those are debug wrappers that bypass Bakin tracking — no MCP call, no Health metrics, no audit log. Always use the MCP tool via \`mcporter call bakin-${agentId}.bakin_exec_<tool> ...\` instead.
- **NEVER use \`openclaw cron\` directly for recurring tasks.** Use \`mcporter call bakin-${agentId}.bakin_exec_schedule_create name="..." schedule="every day at 9am" agentId="..." taskPrompt="..."\` instead. Direct cron jobs bypass Bakin — no agent context, no task creation, no audit trail.`,
  },

  {
    blockId: 'dependency-pattern',
    contentFn: (agentId: string) => `## Bakin Dependency Pattern

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

If your task requires output from another agent, create their task first, note its task ID, then register a dependency:
\`\`\`bash
mcporter call bakin-${agentId}.bakin_exec_tasks_set_dependency taskId=<your-task-id> dependsOn=<their-task-id>
\`\`\`
Then exit — you will be automatically re-dispatched when their task completes.`,
  },

  {
    blockId: 'media-delegation',
    contentFn: (agentId: string) => {
      const canImage = agentId === 'pixel'
      const canVideo = agentId === 'rolo'
      const createsSubtasks = !canImage // everyone except pixel creates pixel subtasks

      let content = `## Bakin Media Delegation Rules

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.\n`

      if (!canImage) {
        content += `\n**IMAGES:** You cannot generate images. Ever. Not with nano-banana-pro, not with any other tool. All image generation goes through Pixel. Create a Pixel task via \`mcporter call bakin-${agentId}.bakin_exec_tasks_create\` and wait.\n`
      }

      if (!canVideo) {
        content += `\n**VIDEO:** You cannot generate video. Ever. Not with Runway, not with any other tool. All video generation goes through Rolo. Create a Rolo task via \`mcporter call bakin-${agentId}.bakin_exec_tasks_create\` and wait.\n`
      }

      if (!canImage && !canVideo) {
        content += `\nIf you find yourself about to run an image or video generation tool — stop. Create a subtask for the right agent instead.\n`
      }

      if (createsSubtasks) {
        content += `\n### When Creating Pixel or Rolo Tasks\n`
        content += `\n- **NEVER include posting instructions in a Pixel or Rolo brief.** They generate assets only — they do not post.`
        content += `\n- Task descriptions for Pixel/Rolo should end with asset delivery: "Save to the assets directory (discover path via \`bakin_exec_get_paths\`) and report the file path."`
        content += `\n- YOU are responsible for posting the finished content. Not Pixel. Not Rolo.`
      }

      return content
    },
  },

  {
    blockId: 'workflow-rules',
    contentFn: (agentId: string, context: ManagedBlockContext) => `## Bakin Workflow Rules

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

When Bakin dispatches a workflow step to you, the dispatch message contains everything you need: step instructions, output schema, and the mcporter command to submit.

1. **The dispatch message is your single source of truth.** Follow it exactly for workflow steps.

2. **Submit output ONLY via mcporter:** \`mcporter call bakin-${agentId}.bakin_exec_submit_step taskId=<id> stepId=<step> --args '<json>'\`. Conversational output does NOT complete the step.

3. **Do NOT move the task, create subtasks, or message ${context.mainAgentName}** for workflow tasks — the workflow engine handles all coordination.

4. **Address rejection feedback specifically.** If re-dispatched with "REVISION REQUIRED", read the feedback and produce genuinely revised output. The server rejects near-duplicate resubmissions.

5. **After submitting, STOP.** Do not generate additional outputs, start work on future steps, or send completion messages.

6. **Respect tool restrictions.** If the dispatch message lists "TOOL RESTRICTIONS", do NOT use those tools. Block the task if you need them.`,
  },

  {
    blockId: 'scheduling-rules',
    contentFn: (agentId: string) => `## Bakin Scheduling Rules

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

**NEVER use \`openclaw cron\` directly for recurring tasks.** Always use Bakin's schedule tools via mcporter. Direct cron jobs bypass Bakin tracking — no agent avatar, no prompt context, no task creation, no run history.

### Creating Scheduled Jobs
\`\`\`bash
mcporter call bakin-${agentId}.bakin_exec_schedule_create name="daily-recipe" schedule="every day at 11am" agentId="basil" taskPrompt="Post a short recipe into #general"
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
- **Recurring work** (daily posts, weekly reports, periodic checks) → \`bakin_exec_schedule_create\`
- **One-time deliverables** → \`bakin_exec_tasks_create\``,
  },

  {
    blockId: 'asset-rules',
    contentFn: (agentId: string) => `## Bakin Asset Rules

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

All created content (images, video, audio, text, plans, data) MUST go to the assets directory. Use the Bakin skill for full conventions, but here's the minimum:

1. **Discover paths via mcporter:** \`mcporter call bakin-${agentId}.bakin_exec_get_paths\`
2. **Organize by task:** \`$ASSETS_DIR/<task-id>/filename.ext\`
   - **No task?** Write to \`$ASSETS_DIR/_unlinked/\` — NEVER place files directly in the type root (e.g. \`assets/text/file.md\` is WRONG, use \`assets/text/_unlinked/file.md\`)
   - **Shared/reusable?** Write to \`$ASSETS_DIR/library/\`
3. **Write sidecar FIRST, then the asset.** Sidecar filename = full asset filename + \`.meta.json\` (e.g. \`20260323-hero.png.meta.json\`, NOT \`hero.meta.json\`)
4. **Sidecar fields — use these EXACT names:**
   - \`agent\` (required, string — NOT \`author\`), \`taskId\` (required, string or null), \`created\` (required, ISO 8601 — NOT \`createdAt\`)
   - Optional: \`tool\`, \`description\`, \`tags\` (string[]), \`originalFilename\`
   - Do NOT add custom fields (e.g. \`prompt\`, \`resolution\`)
5. **Version with timestamps:** \`20260323-hero-image.png\` for revisions.`,
  },
]

/**
 * Apply all managed blocks. Called by the doctor (via the registered
 * `health.managed-blocks` check) and by the CLI's `bakin agent-rules`
 * subcommand directly.
 */
export function applyAllManagedBlocks(autoFix: boolean): HealthCheckResult[] {
  const results: HealthCheckResult[] = []
  for (const block of MANAGED_BLOCKS) {
    results.push(...checkManagedBlock(block, autoFix))
  }
  return results
}

export async function applyAllManagedBlocksForRuntime(
  runtime: AgentRuntimeAdapter,
  autoFix: boolean,
): Promise<HealthCheckResult[]> {
  let agents: RuntimeAgent[]
  try {
    agents = await runtime.agents.list()
  } catch (err) {
    return [error('agent-managed-blocks', `Failed to list runtime agents: ${err instanceof Error ? err.message : String(err)}`)]
  }

  const context = runtimeManagedBlockContext(agents)
  const results: HealthCheckResult[] = []
  for (const block of MANAGED_BLOCKS) {
    results.push(...await checkManagedBlockRuntime(runtime, block, autoFix, agents, context))
  }
  return results
}
