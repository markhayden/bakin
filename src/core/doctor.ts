/**
 * Bakin Doctor — health checks, OpenClaw sync, and auto-repair.
 * Runs on startup and on a configurable cadence to keep systems aligned.
 *
 * Auto-fix policy:
 *   SAFE (auto-fix):   Creating new files, installing/updating skill, making dirs
 *   UNSAFE (notify):   Agent roster mismatches, gateway down, task DB issues,
 *                      anything requiring human judgment
 *
 * Unsafe issues are reported to the main agent via OpenClaw so they show up in conversation.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'
import {
  extractBlock,
  getBlockState,
  injectBlock,
} from '../../packages/core/src/agent-packages/managed-blocks'
import { getSettings } from './settings'
import { getAgentIds } from '@bakin/core/openclaw-config'
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import { appendAudit } from './audit'
import * as openclaw from './openclaw-client'
import { isOnboarded } from './onboarding/state'
import { getMainAgentId, getMainAgentName } from './main-agent'
import { listHealthChecks } from '../../plugins/health/lib/health-check-registry'

// Transitional re-exports — `cli/bakin.ts`'s `bakin agent-rules` subcommand
// still imports these names from `src/core/doctor.ts`. C9 swings the CLI
// imports to point directly at `plugins/health/lib/managed-blocks.ts` and
// these re-exports get deleted along with `applyAllManagedBlocks` and the
// MANAGED_BLOCKS array. One-commit bridge; not a backward-compat shim.
export {
  AGENT_RULES_BLOCK_START,
  AGENT_RULES_BLOCK_END,
  resolveOrchestratorRules,
} from '../../plugins/health/lib/managed-blocks'

/**
 * Run every plugin-registered health check in parallel. Per-check try/catch
 * isolates failures — a single bad handler yields one synthetic error result
 * and never crashes the doctor sweep. Exported separately from runDiagnostics
 * so the isolation behavior can be tested without mocking every builtin
 * check's dependency tree.
 */
export async function runPluginHealthChecks(): Promise<DiagnosticResult[]> {
  const defs = listHealthChecks()
  const arrays = await Promise.all(
    defs.map(async (def) => {
      try {
        return await def.run()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return [{
          check: def.id,
          status: 'error' as const,
          message: `Plugin health check threw: ${message}`,
          autoFixable: false,
        }]
      }
    }),
  )
  return arrays.flat()
}

const log = createLogger('doctor')

let doctorTimer: NodeJS.Timeout | null = null
let lastDiagnosticResults: DiagnosticResult[] | null = null
let lastDiagnosticTime: number = 0

// Track what we've already notified about to avoid spamming the main agent
const notifiedIssues = new Set<string>()

export interface DiagnosticResult {
  check: string
  status: 'ok' | 'warn' | 'error' | 'fixed'
  message: string
  autoFixable: boolean
}

function ok(check: string, message: string): DiagnosticResult {
  return { check, status: 'ok', message, autoFixable: false }
}

function warn(check: string, message: string, autoFixable = false): DiagnosticResult {
  return { check, status: 'warn', message, autoFixable }
}

function error(check: string, message: string): DiagnosticResult {
  return { check, status: 'error', message, autoFixable: false }
}

function fixed(check: string, message: string): DiagnosticResult {
  return { check, status: 'fixed', message, autoFixable: true }
}

// ---------------------------------------------------------------------------
// Individual checks — each returns diagnostics AND applies safe fixes
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Notification — escalate unfixable issues to the main agent
// ---------------------------------------------------------------------------

async function notifyUnfixableIssues(results: DiagnosticResult[]): Promise<void> {
  const issues = results.filter(r =>
    (r.status === 'warn' || r.status === 'error') && !r.autoFixable
  )

  if (issues.length === 0) return

  // Build a dedup key from the issues so we don't spam
  const issueKey = issues.map(i => `${i.check}:${i.status}`).sort().join('|')
  if (notifiedIssues.has(issueKey)) return
  notifiedIssues.add(issueKey)

  const lines = issues.map(i => {
    const icon = i.status === 'error' ? 'ERROR' : 'WARN'
    return `[${icon}] ${i.check}: ${i.message}`
  })

  const message = `Bakin Doctor found ${issues.length} issue(s) that need your attention:\n\n${lines.join('\n')}\n\nRun \`bakin doctor\` for full details.`

  try {
    await openclaw.sendMessage(getMainAgentId(), message)
    log.info('Notified main agent of unfixable issues', { count: issues.length })
  } catch (err) {
    // Gateway might be the issue — can't notify about that
    log.warn('Could not notify main agent of doctor issues (gateway may be down)', err)
  }
}

// ---------------------------------------------------------------------------
// Generic managed block helper
// ---------------------------------------------------------------------------

interface ManagedBlockDef {
  blockId: string
  contentFn: (agentId: string) => string
  agentFilter?: (agentId: string) => boolean // defaults to all non-main-agent
}

/**
 * Check/inject/update a managed block in each agent's AGENTS.md.
 *
 * The marker primitives — `getBlockState`, `extractBlock`, `injectBlock` —
 * live in `packages/core/src/agent-packages/managed-blocks.ts` and are
 * shared with the agent-package installer/projector. This function is the
 * doctor-shaped wrapper around them: it translates marker state into
 * DiagnosticResult shapes and applies the autoFix policy.
 *
 * All managed blocks follow the same marker pattern:
 *   <!-- bakin:{blockId}:start -->
 *   {content}
 *   <!-- bakin:{blockId}:end -->
 */
function checkManagedBlock(def: ManagedBlockDef, autoFix: boolean): DiagnosticResult[] {
  const results: DiagnosticResult[] = []
  const openclawBase = getOpenClawPath()
  const checkName = `agent-${def.blockId}`

  const mainId = getMainAgentId()
  for (const agentId of getAgentIds()) {
    if (agentId === mainId) continue
    if (def.agentFilter && !def.agentFilter(agentId)) continue

    const agentsPath = join(openclawBase, 'workspaces', agentId, 'AGENTS.md')

    if (!existsSync(agentsPath)) {
      results.push(warn(checkName, `AGENTS.md not found for ${agentId} — cannot verify ${def.blockId}`))
      continue
    }

    const current = readFileSync(agentsPath, 'utf-8')
    const expectedBody = def.contentFn(agentId).trim()
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

  return results
}

// ---------------------------------------------------------------------------
// Managed block definitions
// ---------------------------------------------------------------------------

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
    contentFn: (agentId: string) => `## Bakin Workflow Rules

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

When Bakin dispatches a workflow step to you, the dispatch message contains everything you need: step instructions, output schema, and the mcporter command to submit.

1. **The dispatch message is your single source of truth.** Follow it exactly for workflow steps.

2. **Submit output ONLY via mcporter:** \`mcporter call bakin-${agentId}.bakin_exec_submit_step taskId=<id> stepId=<step> --args '<json>'\`. Conversational output does NOT complete the step.

3. **Do NOT move the task, create subtasks, or message ${getMainAgentName()}** for workflow tasks — the workflow engine handles all coordination.

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
2. **Organize by task:** \`\$ASSETS_DIR/<task-id>/filename.ext\`
   - **No task?** Write to \`\$ASSETS_DIR/_unlinked/\` — NEVER place files directly in the type root (e.g. \`assets/text/file.md\` is WRONG, use \`assets/text/_unlinked/file.md\`)
   - **Shared/reusable?** Write to \`\$ASSETS_DIR/library/\`
3. **Write sidecar FIRST, then the asset.** Sidecar filename = full asset filename + \`.meta.json\` (e.g. \`20260323-hero.png.meta.json\`, NOT \`hero.meta.json\`)
4. **Sidecar fields — use these EXACT names:**
   - \`agent\` (required, string — NOT \`author\`), \`taskId\` (required, string or null), \`created\` (required, ISO 8601 — NOT \`createdAt\`)
   - Optional: \`tool\`, \`description\`, \`tags\` (string[]), \`originalFilename\`
   - Do NOT add custom fields (e.g. \`prompt\`, \`resolution\`)
5. **Version with timestamps:** \`20260323-hero-image.png\` for revisions.`,
  },
]

/**
 * Apply all managed blocks. Called by both doctor and the CLI.
 */
export function applyAllManagedBlocks(autoFix: boolean): DiagnosticResult[] {
  const results: DiagnosticResult[] = []
  for (const block of MANAGED_BLOCKS) {
    results.push(...checkManagedBlock(block, autoFix))
  }
  return results
}

// ---------------------------------------------------------------------------
// Workflow health checks
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run all health checks with auto-fix for safe issues.
 * Notifies the main agent via OpenClaw about issues that need human judgment.
 */

export async function runDiagnostics(
  contentDir: string,
  projectRoot: string
): Promise<DiagnosticResult[]> {
  const settings = getSettings()

  // Gate: if the machine has never been through first-run onboarding and
  // the config says to enforce it, return a single actionable error and
  // skip all the normal checks. Keeps doctor quiet on a fresh machine
  // and points the user at `bakin onboard` instead of drowning them in
  // unrelated errors about missing personas, gateway down, etc.
  if (settings.doctor.requireOnboard && !isOnboarded()) {
    return [{
      check: 'onboarded',
      status: 'error',
      message: 'Bakin is not onboarded on this machine. Run `bakin onboard` to complete first-run setup.',
      autoFixable: false,
    }]
  }

  const autoFix = settings.doctor.autoFixSkill // reuse as general autoFix flag

  const results: DiagnosticResult[] = []

  // Sync checks (fast, some auto-fixable)
  results.push(...applyAllManagedBlocks(autoFix))
  // Migrated checks (live in their owner plugins, picked up via the
  // plugin-check loop at the end of this function):
  //   workflows: workflow-skills / workflow-definitions / workflow-instances (#137)
  //   team: agent-roster / personas / agent-assets (#139 C1)
  //   tasks: taskboard / task-consistency / order-integrity (#139 C2)
  //   assets: assets (#139 C3)
  //   schedule: schedule-sync (#139 C4)
  //   memory: search-tables (#139 C5)
  //   health: content-dir / service / mcporter (#139 C6)
  //   health: gateway / antfly (#139 C7)
  //   health: orchestrator-rules / skill / plugin-assets (#139 C8)

  // Plugin-contributed health checks (#137). Results appended to the same
  // list as builtins; the UI groups by status so ordering doesn't matter.
  results.push(...await runPluginHealthChecks())

  // Summarize
  const errors = results.filter(r => r.status === 'error').length
  const warnings = results.filter(r => r.status === 'warn').length
  const fixes = results.filter(r => r.status === 'fixed').length

  if (errors > 0 || warnings > 0) {
    log.warn('Doctor found issues', { errors, warnings, fixes })
  } else {
    log.info('Doctor: all checks passed', { fixes })
  }

  appendAudit(contentDir, 'doctor.run', 'system', {
    total: results.length,
    errors,
    warnings,
    fixes,
  })

  // Notify the main agent about things we can't auto-fix
  await notifyUnfixableIssues(results)

  // Cache results for lightweight reads (e.g. health plugin polling)
  lastDiagnosticResults = results
  lastDiagnosticTime = Date.now()

  return results
}

/**
 * Return the most recent diagnostic results without re-running checks.
 * Returns null if diagnostics have never run.
 */
export function getLastResults(): { results: DiagnosticResult[]; timestamp: number } | null {
  if (!lastDiagnosticResults) return null
  return { results: lastDiagnosticResults, timestamp: lastDiagnosticTime }
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

export function start(contentDir: string, projectRoot: string): void {
  const settings = getSettings()

  // Run immediately on startup
  runDiagnostics(contentDir, projectRoot).catch(err => {
    log.error('Doctor startup check failed', err)
  })

  // Then run on interval
  doctorTimer = setInterval(() => {
    // Clear notification cache each cycle so recurring issues get re-reported
    // (but not within the same cycle)
    notifiedIssues.clear()
    runDiagnostics(contentDir, projectRoot).catch(err => {
      log.error('Doctor periodic check failed', err)
    })
  }, settings.doctor.intervalMs)

  log.info('Doctor started', { intervalMs: settings.doctor.intervalMs })
}

export function stop(): void {
  if (doctorTimer) {
    clearInterval(doctorTimer)
    doctorTimer = null
    log.info('Doctor stopped')
  }
}
