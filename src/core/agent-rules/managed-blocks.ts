/**
 * Managed-context infrastructure for per-agent AGENTS.md projection.
 *
 * The doctor runs `applyManagedBlocksForRuntime` to keep Bakin-owned
 * logical rule sections in sync inside one marker-fenced managed-context
 * block per runtime agent workspace `AGENTS.md` file. The
 * marker primitives (extractBlock, getBlockState, injectBlock) live in
 * packages/core/src/agent-packages/managed-blocks.ts and are shared
 * with the agent-package installer/projector.
 *
 * Migrated from src/core/doctor.ts in #139 C8 (orchestrator-rules
 * constants + template) and #139 C9 (MANAGED_BLOCKS + check helper +
 * applyAllManagedBlocks). The CLI's `bakin agent-rules` subcommand
 * imports directly from this module.
 */
import {
  extractBlock,
  getBlockState,
  injectBlock,
  removeBlock,
} from '../../../packages/core/src/agent-packages/managed-blocks'
import type { HealthCheckResult } from '../../../packages/core/src/plugin-types'
import type { AgentRuntimeAdapter, RuntimeAgent } from '../../../packages/core/src/adapters/runtime'

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

// ─── Compact AGENTS.md managed-context projection ─────────────────────────

export const MANAGED_CONTEXT_BLOCK_ID = 'managed-context'
export const MANAGED_CONTEXT_BLOCK_START = '<!-- bakin:managed-context:start -->'
export const MANAGED_CONTEXT_BLOCK_END = '<!-- bakin:managed-context:end -->'

// Backward-compatible export names for older internal imports. These now
// identify the physical compact context block, not the old logical
// orchestrator-rules block.
export const AGENT_RULES_BLOCK_START = MANAGED_CONTEXT_BLOCK_START
export const AGENT_RULES_BLOCK_END = MANAGED_CONTEXT_BLOCK_END

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

12. **MCP tools only. No REST. No CLI. Ever.** All orchestration happens through the \`bakin_exec_*\` MCP tools. Agents reach them by shelling out to **mcporter** — a CLI shim that relays your call to Bakin's MCP server. Your server is \`bakin-AGENT_ID_PLACEHOLDER\`.

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
    const { getHookRegistry } = await import('../../lib/plugin-registry')
    const hooks = getHookRegistry()
    const defs = await hooks.invoke<Array<{ definition: Record<string, unknown>; name: string }>>('workflows.definitions.list', {}) ?? []
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
  const runtime = await getRuntimeForManagedBlocks()
  const context = runtimeManagedBlockContext(await runtime.agents.list())
  return resolveOrchestratorRulesForAgent(context.mainAgentId, context.mainAgentName)
}

export async function resolveOrchestratorRulesForAgent(agentId: string, agentName: string): Promise<string> {
  return ORCHESTRATOR_RULES_CONTENT
    .replace('WORKFLOW_CATALOG_PLACEHOLDER', await buildWorkflowCatalog())
    .replaceAll('AGENT_ID_PLACEHOLDER', agentId)
    .replaceAll('AGENT_NAME_PLACEHOLDER', agentName)
}

// ─── Generic managed-context helper ───────────────────────────────────────

interface ManagedBlockContext {
  mainAgentId: string
  mainAgentName: string
}

export type ManagedBlockScope = 'all' | 'orchestrator' | 'subagents'

export interface ManagedBlockRunOptions {
  scope?: ManagedBlockScope
}

interface ManagedBlockDef {
  blockId: string
  checkId?: string
  label?: string
  target: 'orchestrator' | 'subagent'
  contentFn: (agentId: string, context: ManagedBlockContext) => string | Promise<string>
  agentFilter?: (agentId: string, context: ManagedBlockContext) => boolean
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

interface ExpectedManagedContextSection {
  def: ManagedBlockDef
  checkName: string
  label: string
  expectedBody: string
}

const MANAGED_CONTEXT_SECTION_PATTERN = /^<!-- bakin:managed-context:section ([\w:.-]+) -->$/

function managedContextSectionMarker(blockId: string): string {
  return `<!-- bakin:managed-context:section ${blockId} -->`
}

function managedBlockCheckName(def: ManagedBlockDef): string {
  return def.checkId ?? `agent-${def.blockId}`
}

function managedBlockLabel(def: ManagedBlockDef): string {
  return def.label ?? def.blockId
}

function managedBlockTargetsAgent(
  def: ManagedBlockDef,
  agentId: string,
  context: ManagedBlockContext,
): boolean {
  if (def.target === 'orchestrator' && agentId !== context.mainAgentId) return false
  if (def.target === 'subagent' && agentId === context.mainAgentId) return false
  if (def.agentFilter && !def.agentFilter(agentId, context)) return false
  return true
}

async function expectedManagedContextSections(
  agentId: string,
  scope: ManagedBlockScope,
  context: ManagedBlockContext,
): Promise<ExpectedManagedContextSection[]> {
  const sections: ExpectedManagedContextSection[] = []
  for (const def of MANAGED_BLOCKS) {
    if (!blockMatchesScope(def, scope)) continue
    if (!managedBlockTargetsAgent(def, agentId, context)) continue
    sections.push({
      def,
      checkName: managedBlockCheckName(def),
      label: managedBlockLabel(def),
      expectedBody: (await def.contentFn(agentId, context)).trim(),
    })
  }
  return sections
}

function renderManagedContextBody(sections: ExpectedManagedContextSection[]): string {
  return [
    '## Bakin Managed Context',
    '',
    '> Auto-managed by `bakin doctor`. Do not edit this block manually.',
    '',
    sections
      .map((section) => `${managedContextSectionMarker(section.def.blockId)}\n${section.expectedBody}`)
      .join('\n\n'),
  ].join('\n').trim()
}

function parseManagedContextSections(body: string): Map<string, string> {
  const sections = new Map<string, string>()
  const lines = body.split('\n')
  let currentBlockId: string | null = null
  let currentLines: string[] = []

  const flush = () => {
    if (!currentBlockId) return
    sections.set(currentBlockId, currentLines.join('\n').trim())
  }

  for (const line of lines) {
    const match = line.match(MANAGED_CONTEXT_SECTION_PATTERN)
    if (match) {
      flush()
      currentBlockId = match[1]
      currentLines = []
      continue
    }
    if (currentBlockId) currentLines.push(line)
  }
  flush()

  return sections
}

function legacyBlockStates(content: string): Array<{ def: ManagedBlockDef; state: ReturnType<typeof getBlockState> }> {
  return MANAGED_BLOCKS.map((def) => ({ def, state: getBlockState(content, def.blockId) }))
}

function removeLegacyManagedBlocks(content: string): string {
  let next = content
  for (const { def } of legacyBlockStates(content)) {
    if (getBlockState(next, def.blockId) === 'present') {
      next = removeBlock(next, def.blockId)
    }
  }
  return next
}

async function checkManagedContextRuntime(
  runtime: AgentRuntimeAdapter,
  autoFix: boolean,
  agents: RuntimeAgent[],
  context: ManagedBlockContext,
  scope: ManagedBlockScope,
): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []

  for (const agent of agents) {
    const agentId = agent.id
    const expectedSections = await expectedManagedContextSections(agentId, scope, context)
    if (expectedSections.length === 0) continue

    const file = await runtime.agents.readWorkspaceFile(agentId, 'AGENTS.md')
    if (!file) {
      for (const section of expectedSections) {
        results.push(warn(
          section.checkName,
          `AGENTS.md not found for ${agentId} — cannot verify ${section.label} managed context section`,
        ))
      }
      continue
    }

    const current = file.content
    const compactState = getBlockState(current, MANAGED_CONTEXT_BLOCK_ID)

    if (compactState === 'orphan-start' || compactState === 'orphan-end') {
      results.push(error(
        'agent-managed-context',
        `managed-context block has malformed markers (${compactState}) in ${agentId}/AGENTS.md`,
      ))
      continue
    }

    const malformedLegacy = legacyBlockStates(current)
      .filter(({ state }) => state === 'orphan-start' || state === 'orphan-end')
    if (malformedLegacy.length > 0) {
      for (const { def, state } of malformedLegacy) {
        results.push(error(
          managedBlockCheckName(def),
          `${managedBlockLabel(def)} legacy block has malformed legacy markers (${state}) in ${agentId}/AGENTS.md; refusing to rewrite managed context`,
        ))
      }
      continue
    }

    const legacyPresentIds = new Set(
      legacyBlockStates(current)
        .filter(({ state }) => state === 'present')
        .map(({ def }) => def.blockId),
    )
    const compactBody = compactState === 'present'
      ? extractBlock(current, MANAGED_CONTEXT_BLOCK_ID) ?? ''
      : ''
    const actualSections = compactState === 'present'
      ? parseManagedContextSections(compactBody)
      : new Map<string, string>()
    const expectedBody = renderManagedContextBody(expectedSections)
    const expectedIds = new Set(expectedSections.map((section) => section.def.blockId))
    const unexpectedIds = [...actualSections.keys()].filter((blockId) => !expectedIds.has(blockId))
    let logicalNeedsWrite = compactState !== 'present'

    for (const section of expectedSections) {
      const actualBody = actualSections.get(section.def.blockId)
      if (compactState !== 'present') {
        logicalNeedsWrite = true
        if (autoFix) {
          results.push(fixed(section.checkName, `Added ${section.label} logical section to ${agentId}/AGENTS.md managed context`))
        } else if (legacyPresentIds.has(section.def.blockId)) {
          results.push(warn(section.checkName, `${section.label} logical section is still in legacy block projection in ${agentId}/AGENTS.md; run with --apply to convert to managed context`, true))
        } else {
          results.push(warn(section.checkName, `${section.label} logical section missing from ${agentId}/AGENTS.md managed context`, true))
        }
        continue
      }

      if (actualBody === undefined) {
        logicalNeedsWrite = true
        if (autoFix) {
          results.push(fixed(section.checkName, `Added ${section.label} logical section to ${agentId}/AGENTS.md managed context`))
        } else {
          results.push(warn(section.checkName, `${section.label} logical section missing from ${agentId}/AGENTS.md managed context`, true))
        }
        continue
      }

      if (actualBody !== section.expectedBody) {
        logicalNeedsWrite = true
        if (autoFix) {
          results.push(fixed(section.checkName, `Updated ${section.label} logical section in ${agentId}/AGENTS.md managed context`))
        } else {
          results.push(warn(section.checkName, `${section.label} logical section is outdated in ${agentId}/AGENTS.md managed context`, true))
        }
        continue
      }

      results.push(ok(section.checkName, `${section.label} logical section in ${agentId}/AGENTS.md managed context is up to date`))
    }

    const contextOnlyReasons: string[] = []
    if (legacyPresentIds.size > 0) {
      contextOnlyReasons.push(`legacy block(s): ${[...legacyPresentIds].join(', ')}`)
    }
    if (unexpectedIds.length > 0) {
      contextOnlyReasons.push(`unexpected section(s): ${unexpectedIds.join(', ')}`)
    }
    if (!logicalNeedsWrite && compactState === 'present' && compactBody !== expectedBody) {
      contextOnlyReasons.push('managed context wrapper')
    }
    if (contextOnlyReasons.length > 0) {
      if (autoFix) {
        const message = `Cleaned ${contextOnlyReasons.join('; ')} in ${agentId}/AGENTS.md managed context`
        results.push(fixed('agent-managed-context', message))
      } else {
        const message = `Found ${contextOnlyReasons.join('; ')} in ${agentId}/AGENTS.md managed context; run with --apply to clean up`
        results.push(warn('agent-managed-context', message, true))
      }
    }

    if (autoFix && (logicalNeedsWrite || contextOnlyReasons.length > 0)) {
      const withCompact = injectBlock(current, MANAGED_CONTEXT_BLOCK_ID, expectedBody)
      const cleaned = removeLegacyManagedBlocks(withCompact)
      if (cleaned !== current) {
        await runtime.agents.writeWorkspaceFile(agentId, { path: 'AGENTS.md', content: cleaned })
      }
    }
  }

  return results
}

async function getRuntimeForManagedBlocks(): Promise<AgentRuntimeAdapter> {
  const { createAppServices, maybeGetAppServices } = await import('../app-services')
  const existing = maybeGetAppServices()?.runtime
  if (existing) return existing
  return (await createAppServices()).runtime
}

// ─── Managed block definitions ────────────────────────────────────────────

const MANAGED_BLOCKS: ManagedBlockDef[] = [
  {
    blockId: 'orchestrator-rules',
    checkId: 'orchestrator-rules',
    label: 'orchestrator-rules',
    target: 'orchestrator',
    contentFn: (_agentId: string, context: ManagedBlockContext) =>
      resolveOrchestratorRulesForAgent(context.mainAgentId, context.mainAgentName),
  },

  {
    blockId: 'mission-control',
    target: 'subagent',
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
    target: 'subagent',
    contentFn: (agentId: string) => `## Bakin Hard Rules

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

- **NEVER use runtime-native agent commands to spawn or message other agents directly.** Always create a Bakin task via \`mcporter call bakin-${agentId}.bakin_exec_tasks_create title="<task>" assignee="<agent>"\` instead. Direct spawning bypasses the pipeline.
- **NEVER modify task state directly.** Use Bakin tools via mcporter only.
- **NEVER post to runtime channels without explicit instruction.** Content goes through Mark's review first.
- **NEVER hardcode file paths.** Always discover paths via \`mcporter call bakin-${agentId}.bakin_exec_get_paths\`. Hardcoded paths break when the content directory moves.
- **NEVER run scripts/bin/*.ts directly.** Those are debug wrappers that bypass Bakin tracking — no MCP call, no Health metrics, no audit log. Always use the MCP tool via \`mcporter call bakin-${agentId}.bakin_exec_<tool> ...\` instead.
- **NEVER use runtime-native cron directly for recurring tasks.** Use \`mcporter call bakin-${agentId}.bakin_exec_schedule_create name="..." schedule="every day at 9am" agentId="..." taskPrompt="..."\` instead. Direct cron jobs bypass Bakin — no agent context, no task creation, no audit trail.`,
  },

  {
    blockId: 'dependency-pattern',
    target: 'subagent',
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
    target: 'subagent',
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
    target: 'subagent',
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
    target: 'subagent',
    contentFn: (agentId: string) => `## Bakin Scheduling Rules

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

**NEVER use runtime-native cron directly for recurring tasks.** Always use Bakin's schedule tools via mcporter. Direct cron jobs bypass Bakin tracking — no agent avatar, no prompt context, no task creation, no run history.

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
    target: 'subagent',
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
 * Apply the compact AGENTS.md managed context using the configured runtime
 * adapter. Called by the CLI's `bakin agent-rules` subcommand directly.
 */
export async function applyManagedBlocks(
  autoFix: boolean,
  options: ManagedBlockRunOptions = {},
): Promise<HealthCheckResult[]> {
  return applyManagedBlocksForRuntime(await getRuntimeForManagedBlocks(), autoFix, options)
}

export async function applyAllManagedBlocks(
  autoFix: boolean,
  options: ManagedBlockRunOptions = {},
): Promise<HealthCheckResult[]> {
  return applyManagedBlocks(autoFix, options)
}

function blockMatchesScope(def: ManagedBlockDef, scope: ManagedBlockScope): boolean {
  if (scope === 'all') return true
  if (scope === 'orchestrator') return def.target === 'orchestrator'
  return def.target === 'subagent'
}

export async function applyManagedBlocksForRuntime(
  runtime: AgentRuntimeAdapter,
  autoFix: boolean,
  options: ManagedBlockRunOptions = {},
): Promise<HealthCheckResult[]> {
  let agents: RuntimeAgent[]
  try {
    agents = await runtime.agents.list()
  } catch (err) {
    return [error('agent-managed-blocks', `Failed to list runtime agents: ${err instanceof Error ? err.message : String(err)}`)]
  }

  if (agents.length === 0) {
    return [warn('agent-managed-blocks', 'No runtime agents found — cannot verify managed context')]
  }

  const scope = options.scope ?? 'all'
  const context = runtimeManagedBlockContext(agents)
  return checkManagedContextRuntime(runtime, autoFix, agents, context, scope)
}

export async function applyAllManagedBlocksForRuntime(
  runtime: AgentRuntimeAdapter,
  autoFix: boolean,
  options: ManagedBlockRunOptions = {},
): Promise<HealthCheckResult[]> {
  return applyManagedBlocksForRuntime(runtime, autoFix, options)
}
