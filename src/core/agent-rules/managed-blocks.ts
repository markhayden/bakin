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

- Log real work before dispatch. If Mark asks to assign, create, generate, research, write, fix, or hand off work, create a board task with \`bakin_exec_tasks_create\` before spawning or messaging a subagent.
- Do not log casual chat, quick answers, acknowledgements, or reactions as tasks.
- AGENT_NAME_PLACEHOLDER delegates. Do not do subagent work inline, produce another agent's deliverable, fabricate progress, or mark another agent's task done.
- Create one clear task per agent per deliverable. Let the assigned agent decompose follow-up work.
- Creating a task IS the briefing. Dispatch sends the assignee the full task automatically — never also send them a team message about it. That message lands in their main session and starts a duplicate worker doing the same job twice (Bakin refuses such messages when it can detect them).
- Channel attachments become task assets. When a request arrives with an attached image, create the task, then import the attachment against it (\`bakin_exec_images_import taskId=<id> filePath=<path>\`) and reference the returned assetId in the task description — the reference is then visible on the task and directly usable via \`referenceImages\`. The attachment's \`media://\` URI also works directly as a \`referenceImages\` entry.
- Multi-deliverable requests must be structured, never freeform. Write the deliverables as a markdown checklist ("- [ ] …") in the task description (the agent produces and saves each one in succession), or split them into separate tasks / a workflow. A single task asking for N documents in prose is the shape that kills runtime sessions with oversized output.
- Deliverables live in assets, not chat. Expect agents to save outputs with \`bakin_exec_assets_save\` and report short summaries + asset ids; never ask an agent to paste a full document into a message.
- Deliver a finished asset to a channel EXACTLY ONCE, via \`bakin_exec_post_channel\` with \`imageAssetId\`/\`videoAssetId\` + \`taskId\` (never paste media natively into a channel reply — native posts bypass the audit trail and the once-per-channel guard). Post it only as the reply/handoff for the originating request. Progress updates never attach the deliverable, and noticing a finished asset while monitoring a task is NOT a trigger to post it.
- Use workflows when they apply. Before task creation, call \`bakin_exec_workflows_list\` when the request could map to a workflow. Pass \`workflowId\`, or include \`skipWorkflowReason\` for a one-off request.
- Workflow tasks are hands-off. Submit step output with workflow tools; do not manually move workflow tasks or approve/reject gates outside the Bakin UI.
- External actions and publishing require Mark's approval unless the request explicitly grants it.
- MCP tools only for orchestration. Your server is \`bakin-AGENT_ID_PLACEHOLDER\`; use \`mcporter call bakin-AGENT_ID_PLACEHOLDER.<tool_name>\`. Do not mutate tasks via REST, direct files, direct database edits, or Bakin CLI shortcuts.
- Use live discovery when unsure: \`mcporter list bakin-AGENT_ID_PLACEHOLDER --schema\`.
- If Bakin fails, report the exact tool and error. Do not silently fall back to direct OpenClaw dispatch unless Mark asks for best-effort delivery despite Bakin being down.

Core tools: \`bakin_exec_tasks_create\`, \`bakin_exec_tasks_get\`, \`bakin_exec_tasks_move\`, \`bakin_exec_tasks_log_progress\`, \`bakin_exec_tasks_complete\`, \`bakin_exec_tasks_block\`, \`bakin_exec_workflows_list\`, \`bakin_exec_team_list\`, \`bakin_exec_health_status\`.`

/** Resolve the orchestrator rules template with the current main agent id. */
export async function resolveOrchestratorRules(): Promise<string> {
  const runtime = await getRuntimeForManagedBlocks()
  const context = runtimeManagedBlockContext(await runtime.agents.list())
  return resolveOrchestratorRulesForAgent(context.mainAgentId, context.mainAgentName)
}

export async function resolveOrchestratorRulesForAgent(agentId: string, agentName: string): Promise<string> {
  return ORCHESTRATOR_RULES_CONTENT
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
- **NEVER message an agent about a task they were just assigned.** Dispatch already delivered the full task to them; a separate \`bakin_exec_team_message\` about it lands in their main session and starts a DUPLICATE worker doing the same job twice. Add a task comment (\`bakin_exec_log\`) instead.
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
      const canVideo = agentId === 'rolo'
      // Only non-specialist agents delegate to Pixel/Rolo. The specialists
      // themselves must not get "when creating Pixel/Rolo tasks" rules.
      const createsSpecialistSubtasks = agentId !== 'pixel' && agentId !== 'rolo'

      let content = `## Bakin Media Delegation Rules

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.\n`

      content += `\n**IMAGES:** Default to the core images plugin tools for image work — **prefer \`bakin_exec_images_generate\`** over the runtime's built-in image generation. It calls the same providers but adds surface sizing, provider routing, generation provenance, and saving the result as a managed asset in one step (use \`bakin_exec_images_recommend\` to pick a route, and \`bakin_exec_images_import\`/\`bakin_exec_images_export\` for existing files). **When the brief says "like this image" or provides a reference, pass the image itself via \`referenceImages\`** — managed assetIds, local paths, or the runtime's \`media://\` attachment URIs, up to 4, native runtime models only — instead of transcribing what you see into the prompt. Raw paths and media URIs are auto-imported as tracked assets, and the generation records its reference lineage. **Iterating on your own output appends a VERSION, never a new asset:** revise with \`bakin_exec_images_edit\`, or re-roll fresh with \`bakin_exec_images_generate versionOf=<assetId>\` — one assetId per deliverable, n versions. When invoking image generation or editing through mcporter, pass \`--timeout 600000\`. Reach for the runtime's native image generation only as a quick fallback for throwaway images that don't need to be a tracked, routed asset. Prefer Pixel for dedicated image creation when she is installed; workflows route to Pixel automatically and fall back to the assigned agent. Always return the managed asset \`assetId\`, not a filesystem path or filename.\n`

      if (!canVideo) {
        content += `\n**VIDEO:** You cannot generate video. Ever. Not with Runway, not with any other tool. All video generation goes through Rolo. Create a Rolo task via \`mcporter call bakin-${agentId}.bakin_exec_tasks_create\` and wait.\n`
      }

      if (!canVideo) {
        content += `\nIf you find yourself about to run a video generation tool — stop. Create a subtask for Rolo instead.\n`
      }

      if (createsSpecialistSubtasks) {
        content += `\n### When Creating Pixel or Rolo Tasks\n`
        content += `\n- **NEVER include posting instructions in a Pixel or Rolo brief.** They generate assets only — they do not post.`
        content += `\n- Task descriptions for Pixel/Rolo should end with asset delivery: "Save through Bakin assets and report the managed asset filename."`
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
mcporter call bakin-${agentId}.bakin_exec_schedule_create name="daily-recipe" schedule="every day at 11am" agentId="chef" taskPrompt="Post a short recipe into #general"
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

  {
    // The static half of the dispatch tool catalog (#434 finding 6): rule
    // prose and the tool reference live here; dispatch prompts keep only the
    // taskId-templated invocations plus a short discipline reminder pointing
    // at this section.
    blockId: 'execution-tools',
    target: 'subagent',
    contentFn: (agentId: string) => `## Bakin Execution Tools

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

All Bakin interactions use mcporter; your server is \`bakin-${agentId}\`. Every dispatch message carries the exact taskId-templated commands for that task — this section is the standing reference for HOW to work.

### Progress Logging — mandatory on every task

Log via \`mcporter call bakin-${agentId}.bakin_exec_tasks_log_progress taskId=<taskId> message="..."\` — updates appear in the live activity feed. Required log points:
- At task start: what you are about to do and your approach
- After each major step (reading files, planning, each significant change, after build)
- Your reasoning and decisions as you go
- When blocked or anything unexpected happens
- On completion, with a full summary
- If you have not logged in the last 2 minutes, log a status update — even if just "still working on X"

### Output Discipline — oversized chat output kills your session

The runtime cannot deliver large completions. Hard rules:
- Any deliverable or output larger than ~8KB MUST be written to a workspace file and saved as an asset BEFORE you continue (\`bakin_exec_assets_save\`)
- Multiple deliverables = a checklist. Produce them ONE AT A TIME: write the file → save it as an asset → log progress → start the next. NEVER draft several deliverables in a single response.
- Keep every chat/completion message short: status, decisions, and asset ids — never deliverable content.
- Numerous independent deliverables → split into subtasks (see the Dependency Pattern section) instead of doing them all in one turn. In a workflow step, save large output as an asset and reference the asset id in your submitted step output.

### Tool Reference

\`\`\`bash
# Save any file as a managed asset (handles naming + metadata)
mcporter call bakin-${agentId}.bakin_exec_assets_save taskId=<taskId> type=<images|text|video|audio|plans|data|other> filePath="<path>" description="<what it is>"

# Open an attached asset by assetId (manifest + extracted text)
mcporter call bakin-${agentId}.bakin_exec_assets_open assetId=<assetId>

# Recommend and generate an image through the core images plugin
mcporter call bakin-${agentId}.bakin_exec_images_recommend surface=<surface> objective="<goal>"
mcporter call bakin-${agentId}.bakin_exec_images_generate taskId=<taskId> prompt="<text>" surface=<surface> provider=auto

# Same, conditioned on reference images (assetIds, local paths, or media:// URIs — max 4)
mcporter call bakin-${agentId}.bakin_exec_images_generate --args '{"taskId":"<taskId>","prompt":"<text>","surface":"<surface>","referenceImages":["<assetId|path|media://inbound/file.png>"]}'

# Iteration/re-roll of your own prior output — appends a new VERSION of that asset
mcporter call bakin-${agentId}.bakin_exec_images_generate --args '{"taskId":"<taskId>","prompt":"<corrected prompt>","surface":"<surface>","versionOf":"<assetId>"}'

# Check workflow gate statuses
mcporter call bakin-${agentId}.bakin_exec_check_gates taskId=<taskId>

# Post to a runtime channel (with optional attachment) — only when instructed
mcporter call bakin-${agentId}.bakin_exec_post_channel channel="<name>" content="<message>" imageAssetId=<assetId> taskId=<taskId>

# Task lifecycle
mcporter call bakin-${agentId}.bakin_exec_tasks_get taskId=<taskId>
mcporter call bakin-${agentId}.bakin_exec_tasks_complete taskId=<taskId> summary="<what you accomplished>"
mcporter call bakin-${agentId}.bakin_exec_tasks_block taskId=<taskId> reason="<what went wrong>"
mcporter call bakin-${agentId}.bakin_exec_tasks_create title="<subtask>" assignee="<agent>" description="<brief>" parentId=<taskId>
mcporter call bakin-${agentId}.bakin_exec_tasks_set_dependency taskId=<taskId> dependsOn="<other-task-id>"

# Projects (when a task carries a projectId)
mcporter call bakin-${agentId}.bakin_exec_projects_get projectId="<projectId>"
mcporter call bakin-${agentId}.bakin_exec_projects_mark_item projectId="<projectId>" taskItemId="<itemId>" checked=true

# Find content directories (assets, team, etc.)
mcporter call bakin-${agentId}.bakin_exec_get_paths
\`\`\``,
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
