/**
 * Beacon Doctor — health checks, OpenClaw sync, and auto-repair.
 * Runs on startup and on a configurable cadence to keep systems aligned.
 *
 * Auto-fix policy:
 *   SAFE (auto-fix):   Creating new files, installing/updating skill, making dirs
 *   UNSAFE (notify):   Agent roster mismatches, gateway down, taskboard corruption,
 *                      anything requiring human judgment
 *
 * Unsafe issues are reported to main-operator via OpenClaw so they show up in conversation.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'
import { getSettings } from './settings'
import { appendAudit } from './audit'
import { isUsingBeaconHome, getContentDir } from './content-dir'
import * as openclaw from './openclaw-client'
import { readTaskboard, clearDependency } from '../../plugins/tasks/taskboard'
import { listDefinitions } from '../../plugins/workflows/parser'
import { listInstances } from '../../plugins/workflows/runtime'
import * as mcporter from './mcporter'
import { getAllExecTools } from '../../scripts/lib/registry'

const log = createLogger('doctor')

let doctorTimer: NodeJS.Timeout | null = null
let lastDiagnosticResults: DiagnosticResult[] | null = null
let lastDiagnosticTime: number = 0

// Track what we've already notified about to avoid spamming main-operator
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

/**
 * Agent roster: compare Beacon settings vs openclaw.json.
 * NOT auto-fixable — which system is "right" requires human judgment.
 */
function checkAgentRoster(contentDir: string): DiagnosticResult[] {
  const results: DiagnosticResult[] = []
  const settings = getSettings()
  const openclawConfigPath = join(process.env.HOME || '~', '.openclaw', 'openclaw.json')

  if (!existsSync(openclawConfigPath)) {
    results.push(warn('agent-roster', 'openclaw.json not found — cannot verify agent roster'))
    return results
  }

  try {
    const config = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'))
    const openclawAgents = (config.agents?.list || []).map((a: { id: string }) => a.id)
    const beaconAgents = settings.agents

    for (const agent of beaconAgents) {
      const resolved = agent === 'main-operator' ? 'main' : agent
      if (!openclawAgents.includes(resolved)) {
        results.push(warn('agent-roster', `Agent "${agent}" is in Beacon but not in OpenClaw`))
      }
    }

    for (const ocAgent of openclawAgents) {
      const beaconName = ocAgent === 'main' ? 'main-operator' : ocAgent
      if (!beaconAgents.includes(beaconName)) {
        results.push(warn('agent-roster', `Agent "${ocAgent}" is in OpenClaw but not in Beacon settings`))
      }
    }

    if (results.length === 0) {
      results.push(ok('agent-roster', `${beaconAgents.length} agents in sync`))
    }
  } catch (err) {
    results.push(error('agent-roster', `Failed to read openclaw.json: ${err}`))
  }

  return results
}

/**
 * Personas: verify each agent has a persona file.
 * Auto-fixable — creates stub files for missing agents.
 */
function checkPersonas(contentDir: string, autoFix: boolean): DiagnosticResult[] {
  const results: DiagnosticResult[] = []
  const settings = getSettings()
  const personasDir = join(contentDir, 'team', 'personas')

  if (!existsSync(personasDir)) {
    if (autoFix) {
      mkdirSync(personasDir, { recursive: true })
      results.push(fixed('personas', 'Created missing personas directory'))
    } else {
      results.push(warn('personas', `No personas directory at ${personasDir}`, true))
      return results
    }
  }

  const existing = new Set(
    readdirSync(personasDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
  )

  let created = 0
  for (const agent of settings.agents) {
    if (!existing.has(agent)) {
      if (autoFix) {
        const stub = `# ${agent.charAt(0).toUpperCase() + agent.slice(1)}\n\n_Persona not yet configured. Update this file with the agent's personality, background, and communication style._\n`
        writeFileSync(join(personasDir, `${agent}.md`), stub, 'utf-8')
        created++
      } else {
        results.push(warn('personas', `Missing persona: ${join(personasDir, `${agent}.md`)}`, true))
      }
    }
  }

  if (autoFix && created > 0) {
    results.push(fixed('personas', `Created ${created} stub persona file(s) — edit them to add real personalities`))
  }

  if (results.filter(r => r.check === 'personas').length === 0) {
    results.push(ok('personas', `All ${settings.agents.length} agents have persona files`))
  }

  return results
}

/**
 * Gateway: ping the OpenClaw gateway.
 * NOT auto-fixable — requires human intervention to start the gateway.
 */
async function checkGateway(): Promise<DiagnosticResult[]> {
  try {
    const alive = await openclaw.ping()
    if (alive) {
      return [ok('gateway', 'OpenClaw gateway is reachable')]
    }
    return [error('gateway', 'OpenClaw gateway is not responding')]
  } catch (err) {
    return [error('gateway', `Gateway check failed: ${err}`)]
  }
}

/**
 * Taskboard: verify TASKBOARD.md structure.
 * Auto-fixable only when file is completely missing — creates a fresh one.
 * Existing files with issues are NOT auto-fixed (could destroy task data).
 */
function checkTaskboard(contentDir: string, autoFix: boolean): DiagnosticResult[] {
  const results: DiagnosticResult[] = []
  const taskboardPath = join(contentDir, 'TASKBOARD.md')

  if (!existsSync(taskboardPath)) {
    if (autoFix) {
      const template = `# Taskboard\n\n## 📋 TODO\n\n## 🔵 In Progress\n\n## 🚫 Blocked\n\n## ✅ Done\n\n## ✔️ Confirmed\n`
      writeFileSync(taskboardPath, template, 'utf-8')
      return [fixed('taskboard', 'Created TASKBOARD.md with standard columns')]
    }
    return [warn('taskboard', 'TASKBOARD.md not found', true)]
  }

  try {
    const content = readFileSync(taskboardPath, 'utf-8')
    const taskLines = content.split('\n').filter(l => l.startsWith('- ['))

    // Duplicate IDs
    const ids = new Set<string>()
    let duplicates = 0
    for (const line of taskLines) {
      const idMatch = line.match(/<!-- id:(\S+) -->/)
      if (idMatch) {
        if (ids.has(idMatch[1])) duplicates++
        ids.add(idMatch[1])
      }
    }
    if (duplicates > 0) {
      results.push(warn('taskboard', `${duplicates} duplicate task IDs in TASKBOARD.md`))
    }

    // Column headers
    const hasInProgress = content.includes('In Progress')
    const hasTodo = content.includes('Todo')
    const hasDone = content.includes('Done')
    if (!hasInProgress || !hasTodo || !hasDone) {
      results.push(warn('taskboard', 'TASKBOARD.md missing standard column headers'))
    }

    if (results.length === 0) {
      results.push(ok('taskboard', `${taskLines.length} tasks, all columns present`))
    }
  } catch (err) {
    results.push(error('taskboard', `Failed to parse TASKBOARD.md: ${err}`))
  }

  return results
}

/**
 * Skill: install/update the Beacon skill in OpenClaw workspace.
 * Auto-fixable — safe because it creates/overwrites only our own skill file.
 */
function checkAndSyncSkill(projectRoot: string, autoFix: boolean): DiagnosticResult[] {
  const sourceSkill = join(projectRoot, 'skill', 'SKILL.md')
  if (!existsSync(sourceSkill)) {
    return [error('skill', 'Beacon skill source not found at skill/SKILL.md')]
  }

  const workspaceSkillDir = join(process.env.HOME || '~', '.openclaw', 'workspace', 'skills', 'beacon')
  const targetSkill = join(workspaceSkillDir, 'SKILL.md')
  const sourceContent = readFileSync(sourceSkill, 'utf-8')

  if (!existsSync(targetSkill)) {
    if (!autoFix) {
      return [warn('skill', 'Beacon skill not installed in OpenClaw', true)]
    }
    try {
      mkdirSync(workspaceSkillDir, { recursive: true })
      writeFileSync(targetSkill, sourceContent, 'utf-8')
      writeFileSync(join(workspaceSkillDir, '_meta.json'), JSON.stringify({
        slug: 'beacon',
        version: '1.0.0',
        installedAt: Date.now(),
        source: 'beacon-doctor',
      }, null, 2), 'utf-8')
      return [fixed('skill', 'Beacon skill installed in OpenClaw workspace')]
    } catch (err) {
      return [error('skill', `Failed to install skill: ${err}`)]
    }
  }

  const currentContent = readFileSync(targetSkill, 'utf-8')
  if (currentContent === sourceContent) {
    return [ok('skill', 'Beacon skill is up to date')]
  }

  if (!autoFix) {
    return [warn('skill', 'Beacon skill is outdated in OpenClaw', true)]
  }

  try {
    writeFileSync(targetSkill, sourceContent, 'utf-8')
    const metaPath = join(workspaceSkillDir, '_meta.json')
    let meta: Record<string, unknown> = {}
    if (existsSync(metaPath)) {
      try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')) } catch { /* fresh */ }
    }
    const currentVersion = String(meta.version || '1.0.0')
    const parts = currentVersion.split('.').map(Number)
    parts[2] = (parts[2] || 0) + 1
    meta.version = parts.join('.')
    meta.updatedAt = Date.now()
    meta.source = 'beacon-doctor'
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    return [fixed('skill', `Beacon skill updated to v${meta.version}`)]
  } catch (err) {
    return [error('skill', `Failed to update skill: ${err}`)]
  }
}

/**
 * Antfly: verify binary installed and connection when enabled.
 * Binary check is informational when disabled, error when enabled and missing.
 */
async function checkAntfly(): Promise<DiagnosticResult[]> {
  const settings = getSettings()
  const { installed, running } = await import('./antfly-server')

  if (!settings.antfly.enabled) {
    if (!installed()) {
      return [warn('antfly', 'Antfly disabled and binary not installed — install with: brew install --cask antflydb/antfly/antfly')]
    }
    return [ok('antfly', 'Antfly disabled — binary installed, enable with: beacon settings set antfly.enabled true')]
  }

  if (!installed()) {
    return [error('antfly', 'Antfly enabled but binary not found — install with: brew install --cask antflydb/antfly/antfly')]
  }

  if (!running()) {
    return [error('antfly', 'Antfly enabled but server not running — it should auto-start on next Beacon restart')]
  }

  try {
    const base = settings.antfly.url.replace(/\/api\/v1\/?$/, '')
    const res = await fetch(`${base}/api/v1/status`, { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      const status = await res.json()
      return [ok('antfly', `Antfly connected (health: ${status?.health})`)]
    }
    return [error('antfly', `Antfly returned status ${res.status}`)]
  } catch (err) {
    return [error('antfly', `Antfly connection failed: ${err}`)]
  }
}

/**
 * Content directory: verify content lives in ~/.beacon/ not ./content/.
 * NOT auto-fixable — migration requires user judgment (moving live data).
 */
function checkContentDir(): DiagnosticResult[] {
  const contentDir = getContentDir()
  if (isUsingBeaconHome()) {
    return [ok('content-dir', `Content directory: ${contentDir}`)]
  }
  return [warn('content-dir',
    `Content lives at ${contentDir} instead of ~/.beacon/ — run: beacon init && move content/* to ~/.beacon/`
  )]
}

/**
 * Orchestrator rules: verify AGENTS.md has the Beacon rules block and it's current.
 * Auto-fixable — safe to write/update our own block in AGENTS.md.
 */
const AGENT_RULES_BLOCK_START = '<!-- beacon:orchestrator-rules:start -->'
const AGENT_RULES_BLOCK_END = '<!-- beacon:orchestrator-rules:end -->'

const ORCHESTRATOR_RULES_CONTENT = `## Beacon Orchestrator Rules

> Auto-managed by \`beacon agent-rules --apply\`. Do not edit this block manually.

These rules govern Main Operator as orchestrator of the Beacon multi-agent system.

1. **Every task gets logged before work begins.** Use \`beacon tasks create\` before spawning any subagent or producing any deliverable. No exceptions.

2. **Never do subagent work inline.** Main Operator delegates — Main Operator does not generate images, write long-form copy, or produce video. That's what the team is for.

3. **High-level tasks only on the board.** Don't break tasks into subtasks yourself. Create one task, assign it, let the subagent decompose it.

4. **Subagents own their handoffs.** If Chef needs Pixel, Chef creates that task — not Main Operator. Let the pipeline flow naturally.

5. **Approval gates are non-negotiable.** Before publishing, sending, or any external action: pause and confirm with Mark unless pre-approved.

6. **Monitor the pipeline, don't micromanage.** Check heartbeats, watch for blocked tasks, intervene when stuck — but don't shadow-execute tasks that are in flight.

7. **One task per agent per piece of content.** Don't assign the same content to multiple agents in parallel. Let the assigned agent drive.

8. **AGENTS.md is your rulebook, not the subagents'.** The Beacon skill (SKILL.md) governs subagents. AGENTS.md governs you.

9. **Workflow tasks are hands-off.** If a task has a \`workflowId\`, the workflow engine manages step progression. Do not manually move workflow tasks between columns, do not produce step output yourself, and do not interfere with gates outside the Beacon UI.

10. **Every task requires a workflow decision.** When creating a task, you MUST either specify a workflow or explain why none applies:
    - With workflow: \`beacon tasks create "<title>" <agent> --workflow=<id>\`
    - Without workflow: \`beacon tasks create "<title>" <agent> --no-workflow="<reason>"\`
    If you forget, Beacon will warn you and suggest a matching workflow if one exists. Use \`beacon workflows list\` to see available workflows. The available workflows are:
WORKFLOW_CATALOG_PLACEHOLDER

The skip reason is logged to the audit trail for debugging. Always check workflows first — most content tasks have one.

11. **Gate approvals go through the UI.** When a workflow gate is reached, a notification is sent and the task card shows "Awaiting Approval" in the Beacon UI. Tell Mark a gate is waiting — do NOT approve or reject gates yourself. Mark handles gates in the task drawer.

### Workflow API Reference (Main Operator only)

These are the ONLY valid workflow endpoints. Do NOT guess at other paths.

| Action | Method | Path |
|--------|--------|------|
| List templates | GET | \`/api/plugins/workflows/list\` |
| Get definition | GET | \`/api/plugins/workflows/definition?name=<id>\` |
| Start workflow | POST | \`/api/plugins/workflows/start\` — body: \`{"taskId":"...","workflowId":"..."}\` |
| List instances | GET | \`/api/plugins/workflows/instances?status=<optional>\` |
| Get instance | GET | \`/api/plugins/workflows/instance?taskId=<id>\` |
| Pending gates | GET | \`/api/plugins/workflows/pending-gates\` |
| Gate status | GET | \`/api/plugins/workflows/gate-status?taskIds=id1,id2\` |

Do NOT use \`/api/tasks\`, \`/api/tasks/list\`, \`/api/plugins/workflows/runs\`, or \`/api/plugins/workflows/run\` — these do not exist.`

/** Build the workflow catalog from available definitions for embedding in rules */
function buildWorkflowCatalog(): string {
  try {
    const defs = listDefinitions()
    if (defs.length === 0) return '   (no workflows defined yet)'
    return defs.map(d => {
      const steps = d.definition.steps || []
      const agents = [...new Set(steps.filter((s) => 'agent' in s && (s as { agent?: string }).agent).map((s) => (s as { agent?: string }).agent))]
      return `   - \`${d.name}\`: ${d.definition.description || d.definition.name}${agents.length ? ` (agents: ${agents.join(', ')})` : ''}`
    }).join('\n')
  } catch {
    return '   (query GET /api/plugins/workflows/list at runtime)'
  }
}

/** Resolve the orchestrator rules template with the current workflow catalog */
function resolveOrchestratorRules(): string {
  return ORCHESTRATOR_RULES_CONTENT.replace('WORKFLOW_CATALOG_PLACEHOLDER', buildWorkflowCatalog())
}

function checkOrchestratorRules(autoFix: boolean): DiagnosticResult[] {
  const agentsPath = join(process.env.HOME || '~', '.openclaw', 'workspace', 'AGENTS.md')

  if (!existsSync(agentsPath)) {
    return [warn('orchestrator-rules', 'AGENTS.md not found — cannot verify orchestrator rules')]
  }

  const resolvedContent = resolveOrchestratorRules()
  const current = readFileSync(agentsPath, 'utf-8')
  const startIdx = current.indexOf(AGENT_RULES_BLOCK_START)
  const endIdx = current.indexOf(AGENT_RULES_BLOCK_END)
  const hasBlock = startIdx !== -1

  if (!hasBlock) {
    if (!autoFix) {
      return [warn('orchestrator-rules', 'Orchestrator rules block missing from AGENTS.md — run: beacon agent-rules --apply', true)]
    }
    const block = `${AGENT_RULES_BLOCK_START}\n${resolvedContent}\n${AGENT_RULES_BLOCK_END}\n`
    writeFileSync(agentsPath, current.trimEnd() + '\n\n' + block, 'utf-8')
    return [fixed('orchestrator-rules', 'Added orchestrator rules block to AGENTS.md')]
  }

  if (endIdx === -1) {
    return [error('orchestrator-rules', 'Orchestrator rules block start marker found but no end marker — AGENTS.md may be corrupt')]
  }

  const blockContent = current.slice(startIdx + AGENT_RULES_BLOCK_START.length, endIdx).trim()
  const expected = resolvedContent.trim()

  if (blockContent === expected) {
    return [ok('orchestrator-rules', 'Orchestrator rules block present and up to date')]
  }

  if (!autoFix) {
    return [warn('orchestrator-rules', 'Orchestrator rules block is outdated — run: beacon agent-rules --apply', true)]
  }

  const block = `${AGENT_RULES_BLOCK_START}\n${resolvedContent}\n${AGENT_RULES_BLOCK_END}`
  const updated = current.slice(0, startIdx) + block + current.slice(endIdx + AGENT_RULES_BLOCK_END.length)
  writeFileSync(agentsPath, updated, 'utf-8')
  return [fixed('orchestrator-rules', 'Updated orchestrator rules block in AGENTS.md')]
}

/**
 * mcporter: verify installation and per-agent config entries.
 * Auto-fixable — safe because it only installs a CLI tool and writes config.
 */
function checkMcporter(port: number, autoFix: boolean): DiagnosticResult[] {
  const results: DiagnosticResult[] = []

  if (!mcporter.isMcporterInstalled()) {
    if (!autoFix) {
      return [warn('mcporter', 'mcporter not installed — run: beacon setup mcporter', true)]
    }
    if (!mcporter.installMcporter()) {
      return [error('mcporter', 'Failed to install mcporter — run: npm i -g mcporter')]
    }
    results.push(fixed('mcporter', 'Installed mcporter globally'))
  }

  const status = mcporter.verifyConfig(port)

  const missing = status.agentEntries.filter(e => !e.correct)
  if (missing.length > 0) {
    if (!autoFix) {
      return [
        ...results,
        warn('mcporter', `${missing.length} agent(s) missing or outdated in mcporter config — run: beacon setup mcporter`, true),
      ]
    }
    const changes = mcporter.syncConfig(port)
    results.push(fixed('mcporter', `Config updated: ${changes.join(', ')}`))
  } else {
    results.push(ok('mcporter', `All ${status.agentEntries.length} agent entries configured`))
  }

  if (status.staleEntries.length > 0 && autoFix) {
    mcporter.syncConfig(port) // syncConfig already removes stale
  }

  return results
}

/**
 * Service: verify the macOS LaunchAgent is installed with correct paths.
 * NOT auto-fixable — stale paths require human judgment.
 */
function checkService(projectRoot: string): DiagnosticResult[] {
  const settings = getSettings()
  if (!settings.service.enabled) {
    return [ok('service', 'Skipped — service management disabled in settings')]
  }

  if (process.platform !== 'darwin') {
    return [ok('service', 'Skipped — macOS only')]
  }

  const results: DiagnosticResult[] = []
  const homedir = process.env.HOME || '~'
  const plistPath = join(homedir, 'Library', 'LaunchAgents', 'com.openclaw.mc.plist')

  if (!existsSync(plistPath)) {
    results.push(warn('service', 'LaunchAgent plist not found — run: beacon setup service'))
    return results
  }

  try {
    const plistContent = readFileSync(plistPath, 'utf-8')

    // Check WorkingDirectory matches current project
    const wdMatch = plistContent.match(/<key>WorkingDirectory<\/key>\s*<string>([^<]+)<\/string>/)
    if (wdMatch && wdMatch[1] !== projectRoot) {
      results.push(error('service',
        `LaunchAgent WorkingDirectory is "${wdMatch[1]}" but project is at "${projectRoot}" — run: beacon setup service`
      ))
    }

    // Check server.ts path matches
    const serverMatch = plistContent.match(/<string>([^<]*server\.ts)<\/string>/)
    if (serverMatch && serverMatch[1] !== join(projectRoot, 'server.ts')) {
      results.push(error('service',
        `LaunchAgent references stale server.ts path — run: beacon setup service`
      ))
    }
  } catch (err) {
    results.push(error('service', `Failed to read plist: ${err}`))
    return results
  }

  // Check service is loaded
  try {
    const { execSync } = require('child_process')
    execSync('launchctl list com.openclaw.mc', { encoding: 'utf-8', stdio: 'pipe' })
  } catch {
    results.push(warn('service', 'LaunchAgent plist exists but service is not loaded — run: beacon setup service'))
  }

  if (results.length === 0) {
    results.push(ok('service', 'LaunchAgent installed and loaded with correct paths'))
  }

  return results
}

/**
 * Task consistency: detect orphaned, overloaded, or stale in-progress tasks.
 * Auto-fixes orphaned dependencies on done tasks (clears dependsOn + re-triggers continuation).
 */
function checkTaskConsistency(contentDir: string, autoFix: boolean): DiagnosticResult[] {
  const results: DiagnosticResult[] = []
  const settings = getSettings()

  try {
    const { columns } = readTaskboard()
    const now = Date.now()

    // Known agents from settings
    const knownAgents = new Set(settings.agents)

    // Count tasks per agent
    const agentTaskCount: Record<string, number> = {}

    for (const task of columns.inProgress) {
      // Track agent load
      if (task.agent) {
        agentTaskCount[task.agent] = (agentTaskCount[task.agent] || 0) + 1
      }

      // In-progress task assigned to unknown agent
      if (task.agent && !knownAgents.has(task.agent) && task.agent !== 'main-operator') {
        results.push(warn('task-consistency', `In-progress task "${task.title}" assigned to unknown agent "${task.agent}"`))
      }

      // In-progress task with no heartbeat file
      const heartbeatPath = join(contentDir, 'heartbeats', `${task.agent || 'unknown'}.json`)
      if (!existsSync(heartbeatPath)) {
        results.push(warn('task-consistency', `In-progress task "${task.title}" — no heartbeat file for agent "${task.agent || 'unassigned'}"`))
      }

      // In-progress task > 2 hours with zero logs
      if (!task.log || task.log.length === 0) {
        // Check if there's metadata suggesting how long it's been in progress
        results.push(warn('task-consistency', `In-progress task "${task.title}" has zero log entries`))
      }
    }

    // Agent with > 3 concurrent in-progress tasks
    for (const [agent, count] of Object.entries(agentTaskCount)) {
      if (count > 3) {
        results.push(warn('task-consistency', `Agent "${agent}" has ${count} concurrent in-progress tasks — may be overloaded`))
      }
    }

    // Done tasks with orphaned dependsOn
    for (const task of columns.done) {
      if (task.dependsOn) {
        if (autoFix) {
          try {
            clearDependency(task.id)
            results.push(fixed('task-consistency', `Cleared orphaned dependsOn on done task "${task.title}"`))
          } catch {
            results.push(warn('task-consistency', `Done task "${task.title}" has orphaned dependsOn="${task.dependsOn}" — failed to clear`))
          }
        } else {
          results.push(warn('task-consistency', `Done task "${task.title}" has orphaned dependsOn="${task.dependsOn}"`, true))
        }
      }
    }

    if (results.length === 0) {
      results.push(ok('task-consistency', `${columns.inProgress.length} in-progress, ${columns.done.length} done — all consistent`))
    }
  } catch (err) {
    results.push(error('task-consistency', `Failed to check task consistency: ${err}`))
  }

  return results
}

// ---------------------------------------------------------------------------
// Notification — escalate unfixable issues to main-operator
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

  const message = `Beacon Doctor found ${issues.length} issue(s) that need your attention:\n\n${lines.join('\n')}\n\nRun \`beacon doctor\` for full details.`

  try {
    await openclaw.sendMessage('main', message)
    log.info('Notified main-operator of unfixable issues', { count: issues.length })
  } catch (err) {
    // Gateway might be the issue — can't notify about that
    log.warn('Could not notify main-operator of doctor issues (gateway may be down)', err)
  }
}

// ---------------------------------------------------------------------------
// Generic managed block helper
// ---------------------------------------------------------------------------

interface ManagedBlockDef {
  blockId: string
  contentFn: (agentId: string) => string
  agentFilter?: (agentId: string) => boolean // defaults to all non-main-operator
}

/**
 * Check/inject/update a managed block in each agent's AGENTS.md.
 * All managed blocks follow the same marker pattern:
 *   <!-- beacon:{blockId}:start -->
 *   {content}
 *   <!-- beacon:{blockId}:end -->
 */
function checkManagedBlock(def: ManagedBlockDef, autoFix: boolean): DiagnosticResult[] {
  const settings = getSettings()
  const results: DiagnosticResult[] = []
  const openclawBase = join(process.env.HOME || '~', '.openclaw')
  const startMarker = `<!-- beacon:${def.blockId}:start -->`
  const endMarker = `<!-- beacon:${def.blockId}:end -->`
  const checkName = `agent-${def.blockId}`

  for (const agentId of settings.agents) {
    if (agentId === 'main-operator') continue
    if (def.agentFilter && !def.agentFilter(agentId)) continue

    const agentsPath = join(openclawBase, 'workspaces', agentId, 'AGENTS.md')

    if (!existsSync(agentsPath)) {
      results.push(warn(checkName, `AGENTS.md not found for ${agentId} — cannot verify ${def.blockId}`))
      continue
    }

    const current = readFileSync(agentsPath, 'utf-8')
    const startIdx = current.indexOf(startMarker)
    const endIdx = current.indexOf(endMarker)
    const expectedContent = def.contentFn(agentId).trim()

    if (startIdx === -1) {
      if (!autoFix) {
        results.push(warn(checkName, `${def.blockId} block missing from ${agentId}/AGENTS.md`, true))
        continue
      }
      const block = `${startMarker}\n${expectedContent}\n${endMarker}\n`
      writeFileSync(agentsPath, current.trimEnd() + '\n\n' + block, 'utf-8')
      results.push(fixed(checkName, `Added ${def.blockId} block to ${agentId}/AGENTS.md`))
      continue
    }

    if (endIdx === -1) {
      results.push(error(checkName, `${def.blockId} block start marker found in ${agentId}/AGENTS.md but no end marker`))
      continue
    }

    const blockContent = current.slice(startIdx + startMarker.length, endIdx).trim()

    if (blockContent === expectedContent) {
      results.push(ok(checkName, `${def.blockId} in ${agentId}/AGENTS.md is up to date`))
    } else if (autoFix) {
      const block = `${startMarker}\n${expectedContent}\n${endMarker}`
      const updated = current.slice(0, startIdx) + block + current.slice(endIdx + endMarker.length)
      writeFileSync(agentsPath, updated, 'utf-8')
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
    contentFn: (agentId: string) => `## Beacon Mission Control

> Auto-managed by \`beacon doctor\`. Do not edit this block manually.

All Beacon interactions use **mcporter**. Your MCP server is \`beacon-${agentId}\`.

### Session Start
1. Check your tasks: \`mcporter call beacon-${agentId}.beacon_get_task taskId=<id>\`
2. Load the Beacon skill for full conventions and tool reference

### Path Discovery
All content paths are resolved via mcporter — never hardcode paths:
\`\`\`bash
mcporter call beacon-${agentId}.beacon_get_paths
\`\`\`

### Task Changes
- Use \`beacon_report_complete\` when done, \`beacon_block_task\` when stuck
- Do NOT write to TASKBOARD.md directly — use Beacon tools via mcporter only

### Heartbeat (every 10 minutes)
- Write your heartbeat JSON to the heartbeats path (discover via \`beacon_get_paths\`)
- Check for new tasks via mcporter`,
  },

  {
    blockId: 'hard-rules',
    contentFn: (agentId: string) => `## Beacon Hard Rules

> Auto-managed by \`beacon doctor\`. Do not edit this block manually.

- **NEVER use \`openclaw agent\` to spawn or message other agents directly.** Always create a Beacon task via \`mcporter call beacon-${agentId}.beacon_create_task title="<task>" assignee="<agent>"\` instead. Direct spawning bypasses the pipeline.
- **NEVER edit TASKBOARD.md directly.** Use Beacon tools via mcporter only.
- **NEVER post to Discord without explicit instruction.** Content goes through Mark's review first.
- **NEVER hardcode file paths.** Always discover paths via \`mcporter call beacon-${agentId}.beacon_get_paths\`. Hardcoded paths break when the content directory moves.
- **NEVER run scripts/bin/*.ts directly.** Those are debug wrappers that bypass Beacon tracking — no MCP call, no Health metrics, no audit log. Always use the MCP tool via \`mcporter call beacon-${agentId}.beacon_exec_<tool> ...\` instead.`,
  },

  {
    blockId: 'dependency-pattern',
    contentFn: (agentId: string) => `## Beacon Dependency Pattern

> Auto-managed by \`beacon doctor\`. Do not edit this block manually.

If your task requires output from another agent, create their task first, note its task ID, then register a dependency:
\`\`\`bash
mcporter call beacon-${agentId}.beacon_register_dependency taskId=<your-task-id> dependsOn=<their-task-id>
\`\`\`
Then exit — you will be automatically re-dispatched when their task completes.`,
  },

  {
    blockId: 'media-delegation',
    contentFn: (agentId: string) => {
      const canImage = agentId === 'pixel'
      const canVideo = agentId === 'rolo'
      const createsSubtasks = !canImage // everyone except pixel creates pixel subtasks

      let content = `## Beacon Media Delegation Rules

> Auto-managed by \`beacon doctor\`. Do not edit this block manually.\n`

      if (!canImage) {
        content += `\n**IMAGES:** You cannot generate images. Ever. Not with nano-banana-pro, not with any other tool. All image generation goes through Pixel. Create a Pixel task via \`mcporter call beacon-${agentId}.beacon_create_task\` and wait.\n`
      }

      if (!canVideo) {
        content += `\n**VIDEO:** You cannot generate video. Ever. Not with Runway, not with any other tool. All video generation goes through Rolo. Create a Rolo task via \`mcporter call beacon-${agentId}.beacon_create_task\` and wait.\n`
      }

      if (!canImage && !canVideo) {
        content += `\nIf you find yourself about to run an image or video generation tool — stop. Create a subtask for the right agent instead.\n`
      }

      if (createsSubtasks) {
        content += `\n### When Creating Pixel or Rolo Tasks\n`
        content += `\n- **NEVER include posting instructions in a Pixel or Rolo brief.** They generate assets only — they do not post.`
        content += `\n- Task descriptions for Pixel/Rolo should end with asset delivery: "Save to the assets directory (discover path via \`beacon_get_paths\`) and report the file path."`
        content += `\n- YOU are responsible for posting the finished content. Not Pixel. Not Rolo.`
      }

      return content
    },
  },

  {
    blockId: 'workflow-rules',
    contentFn: (agentId: string) => `## Beacon Workflow Rules

> Auto-managed by \`beacon doctor\`. Do not edit this block manually.

When Beacon dispatches a workflow step to you, the dispatch message contains everything you need: step instructions, output schema, and the mcporter command to submit.

1. **The dispatch message is your single source of truth.** Follow it exactly for workflow steps.

2. **Submit output ONLY via mcporter:** \`mcporter call beacon-${agentId}.beacon_submit_step taskId=<id> stepId=<step> --args '<json>'\`. Conversational output does NOT complete the step.

3. **Do NOT move the task, create subtasks, or message main-operator** for workflow tasks — the workflow engine handles all coordination.

4. **Address rejection feedback specifically.** If re-dispatched with "REVISION REQUIRED", read the feedback and produce genuinely revised output. The server rejects near-duplicate resubmissions.

5. **After submitting, STOP.** Do not generate additional outputs, start work on future steps, or send completion messages.

6. **Respect tool restrictions.** If the dispatch message lists "TOOL RESTRICTIONS", do NOT use those tools. Block the task if you need them.`,
  },

  {
    blockId: 'asset-rules',
    contentFn: (agentId: string) => `## Beacon Asset Rules

> Auto-managed by \`beacon doctor\`. Do not edit this block manually.

All created content (images, video, audio, text, plans, data) MUST go to the assets directory. Use the Beacon skill for full conventions, but here's the minimum:

1. **Discover paths via mcporter:** \`mcporter call beacon-${agentId}.beacon_get_paths\`
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

/**
 * Workflow skills: warn if skills referenced by workflow steps are missing output_schema.
 * Without output_schema, server-side validation is bypassed.
 */
function checkWorkflowSkills(contentDir: string): DiagnosticResult[] {
  const results: DiagnosticResult[] = []
  const skillsDir = join(contentDir, 'workflows', 'skills')

  if (!existsSync(skillsDir)) return results

  try {
    const files = readdirSync(skillsDir).filter(f => f.endsWith('.md'))
    for (const file of files) {
      try {
        const content = readFileSync(join(skillsDir, file), 'utf-8')
        const match = content.match(/^---\n([\s\S]*?)\n---/)
        if (!match) {
          results.push(warn('workflow-skills', `Skill ${file} has no YAML frontmatter — output will not be validated`))
          continue
        }
        if (!content.includes('output_schema')) {
          results.push(warn('workflow-skills', `Skill ${file} has no output_schema — step output will not be validated server-side`))
        }
      } catch {
        results.push(warn('workflow-skills', `Could not read skill file: ${file}`))
      }
    }
  } catch {
    // skills dir exists but can't be read
  }

  if (results.length === 0) {
    results.push(ok('workflow-skills', 'All workflow skills have output_schema'))
  }

  return results
}

/**
 * Workflow definitions: verify all step skill references resolve to existing skill files.
 */
function checkWorkflowDefinitions(contentDir: string): DiagnosticResult[] {
  const results: DiagnosticResult[] = []
  const skillsDir = join(contentDir, 'workflows', 'skills')

  try {
    const defs = listDefinitions(contentDir)
    for (const { name, definition } of defs) {
      for (const step of definition.steps) {
        const skillName = (step as { skill?: string }).skill
        if (skillName && !existsSync(join(skillsDir, `${skillName}.md`))) {
          results.push(warn('workflow-definitions', `Workflow "${name}" step "${step.id}" references skill "${skillName}" which does not exist`))
        }
        // Check parallel children too
        if (step.type === 'parallel' && 'steps' in step) {
          for (const child of (step as { steps: Array<{ id: string; skill?: string }> }).steps) {
            if (child.skill && !existsSync(join(skillsDir, `${child.skill}.md`))) {
              results.push(warn('workflow-definitions', `Workflow "${name}" parallel step "${child.id}" references skill "${child.skill}" which does not exist`))
            }
          }
        }
      }
    }
  } catch {
    // No definitions or parser error — non-fatal
  }

  if (results.length === 0) {
    results.push(ok('workflow-definitions', 'All workflow skill references resolve'))
  }

  return results
}

/**
 * Stale workflow instances: flag instances stuck in_progress for > 2 hours.
 */
function checkStaleWorkflowInstances(contentDir: string, autoFix: boolean): DiagnosticResult[] {
  const results: DiagnosticResult[] = []

  try {
    // Check all instances (not just in_progress) for orphans
    const allInstances = listInstances(undefined, contentDir)
    const { columns } = readTaskboard()
    const allTaskIds = new Set<string>()
    for (const col of Object.values(columns)) {
      for (const task of (col as Array<{ id: string }>)) {
        allTaskIds.add(task.id)
      }
    }

    const now = Date.now()
    const staleThreshold = 2 * 60 * 60 * 1000 // 2 hours

    for (const instance of allInstances) {
      // Check for orphaned instances — task deleted from board
      if (!allTaskIds.has(instance.taskId)) {
        if (autoFix) {
          const instancePath = join(contentDir, 'workflows', 'instances', `${instance.taskId}.json`)
          try {
            const { unlinkSync } = require('fs')
            unlinkSync(instancePath)
            results.push(fixed('workflow-instances', `Removed orphaned workflow instance for deleted task "${instance.taskId}"`))
          } catch {
            results.push(warn('workflow-instances', `Orphaned workflow instance for deleted task "${instance.taskId}" — could not remove`))
          }
        } else {
          results.push(warn('workflow-instances', `Orphaned workflow instance for deleted task "${instance.taskId}" — task no longer on board`, true))
        }
        continue
      }

      // Check for stale in_progress instances
      if (instance.status !== 'in_progress') continue
      const updated = new Date(instance.updatedAt).getTime()
      if (isNaN(updated)) continue
      const age = now - updated
      if (age > staleThreshold) {
        const hours = Math.round(age / (60 * 60 * 1000) * 10) / 10
        results.push(warn('workflow-instances', `Workflow instance for task "${instance.taskId}" has been in_progress on step "${instance.currentStepId}" for ${hours}h with no updates`))
      }
    }
  } catch {
    // No instances directory — non-fatal
  }

  if (results.length === 0) {
    results.push(ok('workflow-instances', 'No stale workflow instances'))
  }

  return results
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/**
 * Assets: verify directory structure, sidecars, disk usage, and trash cleanup.
 */
function checkAssets(contentDir: string, autoFix: boolean): DiagnosticResult[] {
  const results: DiagnosticResult[] = []
  const assetsRoot = join(contentDir, 'assets')
  const assetTypes = ['text', 'images', 'video', 'audio', 'plans', 'data', 'other']

  // Check assets/ directory exists with all type subdirs
  if (!existsSync(assetsRoot)) {
    if (autoFix) {
      mkdirSync(assetsRoot, { recursive: true })
      results.push(fixed('assets', 'Created assets/ directory'))
    } else {
      results.push(warn('assets', 'assets/ directory not found', true))
      return results
    }
  }

  for (const typeName of assetTypes) {
    const typeDir = join(assetsRoot, typeName)
    if (!existsSync(typeDir)) {
      if (autoFix) {
        mkdirSync(typeDir, { recursive: true })
        mkdirSync(join(typeDir, '_unlinked'), { recursive: true })
        mkdirSync(join(typeDir, 'library'), { recursive: true })
        results.push(fixed('assets', `Created assets/${typeName}/ with _unlinked/ and library/`))
      } else {
        results.push(warn('assets', `Missing assets/${typeName}/ directory`, true))
      }
    }
  }

  // Check for .trash/ directory
  const trashDir = join(assetsRoot, '.trash')
  if (!existsSync(trashDir)) {
    if (autoFix) {
      mkdirSync(trashDir, { recursive: true })
      results.push(fixed('assets', 'Created assets/.trash/ directory'))
    }
  }

  // Scan for missing sidecars, orphaned meta files, and mismatched sidecars
  let missingMetaCount = 0
  let orphanedMetaCount = 0
  let mismatchedMetaCount = 0
  let totalAssets = 0

  for (const typeName of assetTypes) {
    const typeDir = join(assetsRoot, typeName)
    if (!existsSync(typeDir)) continue

    try {
      const subdirs = readdirSync(typeDir).filter(d => {
        if (d.startsWith('.')) return false
        try { return require('fs').statSync(join(typeDir, d)).isDirectory() } catch { return false }
      })

      for (const subdir of subdirs) {
        const dirPath = join(typeDir, subdir)
        try {
          const files = readdirSync(dirPath)
          const assetFiles = files.filter(f => !f.endsWith('.meta.json') && !f.startsWith('.'))
          const metaFiles = files.filter(f => f.endsWith('.meta.json'))

          totalAssets += assetFiles.length

          // Check for assets missing sidecar
          for (const assetFile of assetFiles) {
            const expectedMeta = assetFile + '.meta.json'
            if (!metaFiles.includes(expectedMeta)) {
              missingMetaCount++
              if (autoFix) {
                // Import sidecar module to create stub
                try {
                  const { createStub } = require('../../plugins/assets/lib/sidecar')
                  createStub(join(dirPath, assetFile))
                } catch {
                  // Plugin may not be loaded yet — create minimal stub
                  writeFileSync(
                    join(dirPath, expectedMeta),
                    JSON.stringify({
                      agent: 'unknown',
                      taskId: subdir === '_unlinked' || subdir === 'library' ? null : subdir,
                      created: new Date().toISOString(),
                    }, null, 2),
                    'utf-8'
                  )
                }
              }
            }
          }

          // Check for orphaned or mismatched meta files
          for (const metaFile of metaFiles) {
            const assetName = metaFile.replace('.meta.json', '')
            if (!assetFiles.includes(assetName)) {
              // Check if this is a near-miss: meta basename matches part of an asset filename
              const nearMatch = assetFiles.find(af => {
                // Case 1: asset filename contains the meta base (e.g., "20250727-pop-tart.png" contains "pop-tart")
                if (af.includes(assetName)) return true
                // Case 2: meta base matches asset without extension (e.g., "hero-image" matches "hero-image.png")
                const afBase = af.substring(0, af.lastIndexOf('.'))
                if (afBase === assetName) return true
                return false
              })

              if (nearMatch) {
                mismatchedMetaCount++
                const expectedMeta = nearMatch + '.meta.json'
                log.warn('Mismatched sidecar', { metaFile, likelyAsset: nearMatch, expectedMeta, dir: dirPath })

                if (autoFix) {
                  // Check if the correctly-named sidecar is a stub (agent: "unknown")
                  const correctMetaPath = join(dirPath, expectedMeta)
                  const mismatchedMetaPath = join(dirPath, metaFile)
                  try {
                    let isStub = false
                    if (existsSync(correctMetaPath)) {
                      const correctContent = JSON.parse(readFileSync(correctMetaPath, 'utf-8'))
                      isStub = correctContent.agent === 'unknown'
                    }

                    if (isStub || !existsSync(correctMetaPath)) {
                      // Merge: read mismatched sidecar, normalize field names, write to correct path
                      const richMeta = JSON.parse(readFileSync(mismatchedMetaPath, 'utf-8'))

                      // Normalize common field name mistakes
                      const ALIASES: Record<string, string> = {
                        author: 'agent', createdAt: 'created', created_at: 'created',
                        timestamp: 'created', task: 'taskId', task_id: 'taskId', name: 'agent',
                      }
                      for (const [alias, canonical] of Object.entries(ALIASES)) {
                        if (richMeta[alias] !== undefined && richMeta[canonical] === undefined) {
                          richMeta[canonical] = richMeta[alias]
                          delete richMeta[alias]
                        }
                      }

                      writeFileSync(correctMetaPath, JSON.stringify(richMeta, null, 2), 'utf-8')
                      require('fs').unlinkSync(mismatchedMetaPath)
                      log.info('Merged mismatched sidecar', { from: metaFile, to: expectedMeta })
                    } else {
                      // Correct sidecar has real content — just remove the orphan
                      require('fs').unlinkSync(mismatchedMetaPath)
                      log.info('Removed orphaned mismatched sidecar', { metaFile })
                    }
                  } catch (err) {
                    log.warn('Failed to auto-fix mismatched sidecar', err, { metaFile })
                  }
                }
              } else {
                orphanedMetaCount++
              }
            }
          }
        } catch { /* skip unreadable dirs */ }
      }
    } catch { /* skip unreadable type dirs */ }
  }

  if (missingMetaCount > 0) {
    if (autoFix) {
      results.push(fixed('assets', `Created ${missingMetaCount} stub sidecar(s) for assets missing .meta.json`))
    } else {
      results.push(warn('assets', `${missingMetaCount} asset(s) missing .meta.json sidecar`, true))
    }
  }

  if (orphanedMetaCount > 0) {
    results.push(warn('assets', `${orphanedMetaCount} orphaned .meta.json file(s) with no matching asset`))
  }

  if (mismatchedMetaCount > 0) {
    if (autoFix) {
      results.push(fixed('assets', `Merged ${mismatchedMetaCount} misnamed .meta.json file(s) into correctly-named sidecars`))
    } else {
      results.push(warn('assets', `${mismatchedMetaCount} misnamed .meta.json file(s) — sidecar name doesn't match {filename}.meta.json pattern`, true))
    }
  }

  // Disk usage check
  try {
    let totalSize = 0
    const { statSync: fsStat, readdirSync: fsReaddir } = require('fs')

    function walkSize(dir: string): void {
      try {
        for (const entry of fsReaddir(dir)) {
          const fullPath = join(dir, entry)
          try {
            const stat = fsStat(fullPath)
            if (stat.isFile()) totalSize += stat.size
            else if (stat.isDirectory() && !entry.startsWith('.')) walkSize(fullPath)
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    walkSize(assetsRoot)

    const sizeGB = totalSize / (1024 * 1024 * 1024)
    if (sizeGB > 5) {
      results.push(warn('assets', `Assets directory is ${sizeGB.toFixed(1)} GB — consider cleanup`))
    }
  } catch { /* skip size check */ }

  // Trash cleanup
  try {
    if (existsSync(trashDir)) {
      const trashFiles = readdirSync(trashDir)
      const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000) // 7 days
      let purged = 0
      for (const file of trashFiles) {
        try {
          const stat = require('fs').statSync(join(trashDir, file))
          if (stat.mtimeMs < cutoff) {
            if (autoFix) {
              require('fs').rmSync(join(trashDir, file))
              purged++
            }
          }
        } catch { /* skip */ }
      }
      if (purged > 0) {
        results.push(fixed('assets', `Purged ${purged} expired item(s) from .trash/ (>7 days old)`))
      }
    }
  } catch { /* skip */ }

  if (results.length === 0) {
    results.push(ok('assets', `${totalAssets} asset(s), all sidecars present`))
  }

  return results
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Exec tools block in SKILL.md
// ---------------------------------------------------------------------------

/**
 * Check/update the exec-tools managed block in skill/SKILL.md.
 * Generates the tool table dynamically from the registry so it stays in sync.
 * Auto-fixable — safe because it only overwrites our own managed block.
 */
function checkExecToolsBlock(projectRoot: string, autoFix: boolean): DiagnosticResult[] {
  const skillPath = join(projectRoot, 'skill', 'SKILL.md')
  if (!existsSync(skillPath)) return []

  const checkName = 'skill-exec-tools'
  const startMarker = '<!-- beacon:exec-tools:start -->'
  const endMarker = '<!-- beacon:exec-tools:end -->'

  const tools = getAllExecTools().filter(t => t.source === 'core' || !t.source)
  if (tools.length === 0) return [ok(checkName, 'No core exec tools registered')]

  const toolLines = tools
    .map(t => `| \`${t.name}\` | ${t.description} |`)
    .join('\n')

  const expectedContent = `## Execution Tools

> Auto-managed by \`beacon doctor\`. Do not edit this block manually.

Use these tools to accomplish actual work — saving files, posting content, generating images. Called the same way as MCP tools via mcporter.

| Tool | Purpose |
|------|---------|
${toolLines}

### Quick Reference

\`\`\`bash
# Save a file as a managed asset (handles naming + sidecar automatically)
mcporter call beacon-<agent>.beacon_exec_save_asset taskId=<id> type=<images|text|video|audio|plans|data|other> filePath="<path>" description="<desc>"
# Post to Discord (with optional image/video attachment)
mcporter call beacon-<agent>.beacon_exec_post_discord channel="<name>" content="<msg>" taskId=<id>
# Generate image via Nano Banana
mcporter call beacon-<agent>.beacon_exec_gen_image taskId=<id> prompt="<text>" preset=social-portrait model=flash
# Check workflow gate statuses
mcporter call beacon-<agent>.beacon_exec_check_gates taskId=<id>
\`\`\``

  const current = readFileSync(skillPath, 'utf-8')
  const startIdx = current.indexOf(startMarker)
  const endIdx = current.indexOf(endMarker)

  if (startIdx === -1) {
    if (!autoFix) return [warn(checkName, 'exec-tools block missing from skill/SKILL.md', true)]
    // Insert after "Your agent identity is automatically injected..." line
    const insertAfter = 'you do not need to specify it.'
    const insertIdx = current.indexOf(insertAfter)
    if (insertIdx === -1) return [error(checkName, 'Cannot find insertion point in skill/SKILL.md')]
    const block = `\n\n${startMarker}\n${expectedContent}\n${endMarker}\n`
    const updated = current.slice(0, insertIdx + insertAfter.length) + block + current.slice(insertIdx + insertAfter.length)
    writeFileSync(skillPath, updated, 'utf-8')
    return [fixed(checkName, 'Added exec-tools block to skill/SKILL.md')]
  }

  if (endIdx === -1) {
    return [error(checkName, 'exec-tools start marker found but no end marker in skill/SKILL.md')]
  }

  const blockContent = current.slice(startIdx + startMarker.length, endIdx).trim()
  if (blockContent === expectedContent.trim()) {
    return [ok(checkName, 'exec-tools block in skill/SKILL.md is up to date')]
  }

  if (!autoFix) return [warn(checkName, 'exec-tools block is outdated in skill/SKILL.md', true)]

  const block = `${startMarker}\n${expectedContent}\n${endMarker}`
  const updated = current.slice(0, startIdx) + block + current.slice(endIdx + endMarker.length)
  writeFileSync(skillPath, updated, 'utf-8')
  return [fixed(checkName, 'Updated exec-tools block in skill/SKILL.md')]
}

/**
 * Run all health checks with auto-fix for safe issues.
 * Notifies main-operator via OpenClaw about issues that need human judgment.
 */
export async function runDiagnostics(
  contentDir: string,
  projectRoot: string
): Promise<DiagnosticResult[]> {
  const settings = getSettings()
  const autoFix = settings.doctor.autoFixSkill // reuse as general autoFix flag

  const results: DiagnosticResult[] = []

  // Sync checks (fast, some auto-fixable)
  results.push(...checkContentDir())
  results.push(...checkAgentRoster(contentDir))
  results.push(...checkPersonas(contentDir, autoFix))
  results.push(...checkTaskboard(contentDir, autoFix))
  results.push(...checkExecToolsBlock(projectRoot, autoFix))
  results.push(...checkAndSyncSkill(projectRoot, autoFix))
  results.push(...checkOrchestratorRules(autoFix))
  results.push(...applyAllManagedBlocks(autoFix))
  results.push(...checkWorkflowSkills(contentDir))
  results.push(...checkWorkflowDefinitions(contentDir))
  results.push(...checkStaleWorkflowInstances(contentDir, autoFix))
  results.push(...checkTaskConsistency(contentDir, autoFix))
  results.push(...checkAssets(contentDir, autoFix))
  results.push(...checkMcporter(Number(process.env.PORT || 3737), autoFix))
  results.push(...checkService(projectRoot))

  // Async checks (network, not auto-fixable) — run in parallel
  const [gatewayResults, antflyResults] = await Promise.all([
    checkGateway(),
    checkAntfly(),
  ])
  results.push(...gatewayResults, ...antflyResults)

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

  // Notify main-operator about things we can't auto-fix
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
