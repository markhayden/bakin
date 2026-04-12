/**
 * Bakin Doctor — health checks, OpenClaw sync, and auto-repair.
 * Runs on startup and on a configurable cadence to keep systems aligned.
 *
 * Auto-fix policy:
 *   SAFE (auto-fix):   Creating new files, installing/updating skill, making dirs
 *   UNSAFE (notify):   Agent roster mismatches, gateway down, task DB issues,
 *                      anything requiring human judgment
 *
 * Unsafe issues are reported to main-operator via OpenClaw so they show up in conversation.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { createLogger } from './logger'
import { getSettings } from './settings'
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import { appendAudit } from './audit'
import { isUsingBakinHome, getContentDir } from './content-dir'
import * as openclaw from './openclaw-client'
import * as mcporter from './mcporter'
import { isOnboarded } from './onboarding/state'
import { getAllExecTools } from '../../scripts/lib/registry'
import { getHookRegistry } from '../lib/plugin-registry'

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
 * Agent roster: compare Bakin settings vs openclaw.json.
 * NOT auto-fixable — which system is "right" requires human judgment.
 */
function checkAgentRoster(contentDir: string): DiagnosticResult[] {
  const results: DiagnosticResult[] = []
  const settings = getSettings()
  const openclawConfigPath = getOpenClawPath('openclaw.json')

  if (!existsSync(openclawConfigPath)) {
    results.push(warn('agent-roster', 'openclaw.json not found — cannot verify agent roster'))
    return results
  }

  try {
    const config = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'))
    const openclawAgents = (config.agents?.list || []).map((a: { id: string }) => a.id)
    const bakinAgents = settings.agents

    for (const agent of bakinAgents) {
      const resolved = agent === 'main-operator' ? 'main' : agent
      if (!openclawAgents.includes(resolved)) {
        results.push(warn('agent-roster', `Agent "${agent}" is in Bakin but not in OpenClaw`))
      }
    }

    for (const ocAgent of openclawAgents) {
      const bakinName = ocAgent === 'main' ? 'main-operator' : ocAgent
      if (!bakinAgents.includes(bakinName)) {
        results.push(warn('agent-roster', `Agent "${ocAgent}" is in OpenClaw but not in Bakin settings`))
      }
    }

    if (results.length === 0) {
      results.push(ok('agent-roster', `${bakinAgents.length} agents in sync`))
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
 * Taskboard: verify flow_runs SQLite table is accessible.
 */
function checkTaskboard(_contentDir: string, _autoFix: boolean): DiagnosticResult[] {
  try {
    const Database = require('better-sqlite3')
    const dbPath = getOpenClawPath('flows', 'registry.sqlite')
    if (!existsSync(dbPath)) {
      return [warn('taskboard', 'OpenClaw flow_runs database not found at ' + dbPath)]
    }
    const db = new Database(dbPath)
    const count = db.prepare(`SELECT count(*) as n FROM flow_runs WHERE owner_key LIKE 'bakin:task:%'`).get() as { n: number }
    db.close()
    return [ok('taskboard', `${count.n} tasks in flow_runs (SQLite)`)]
  } catch (err) {
    return [error('taskboard', `Failed to query flow_runs: ${err}`)]
  }
}

/**
 * Skill: install/update the Bakin skill in OpenClaw workspace.
 * Auto-fixable — safe because it creates/overwrites only our own skill file.
 */
function checkAndSyncSkill(projectRoot: string, autoFix: boolean): DiagnosticResult[] {
  const sourceSkill = join(projectRoot, 'skill', 'SKILL.md')
  if (!existsSync(sourceSkill)) {
    return [error('skill', 'Bakin skill source not found at skill/SKILL.md')]
  }

  const workspaceSkillDir = getOpenClawPath('workspace', 'skills', 'bakin')
  const targetSkill = join(workspaceSkillDir, 'SKILL.md')
  const sourceContent = readFileSync(sourceSkill, 'utf-8')

  if (!existsSync(targetSkill)) {
    if (!autoFix) {
      return [warn('skill', 'Bakin skill not installed in OpenClaw', true)]
    }
    try {
      mkdirSync(workspaceSkillDir, { recursive: true })
      writeFileSync(targetSkill, sourceContent, 'utf-8')
      writeFileSync(join(workspaceSkillDir, '_meta.json'), JSON.stringify({
        slug: 'bakin',
        version: '1.0.0',
        installedAt: Date.now(),
        source: 'bakin-doctor',
      }, null, 2), 'utf-8')
      return [fixed('skill', 'Bakin skill installed in OpenClaw workspace')]
    } catch (err) {
      return [error('skill', `Failed to install skill: ${err}`)]
    }
  }

  const currentContent = readFileSync(targetSkill, 'utf-8')
  if (currentContent === sourceContent) {
    return [ok('skill', 'Bakin skill is up to date')]
  }

  if (!autoFix) {
    return [warn('skill', 'Bakin skill is outdated in OpenClaw', true)]
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
    meta.source = 'bakin-doctor'
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    return [fixed('skill', `Bakin skill updated to v${meta.version}`)]
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
  const { installed } = await import('./antfly-server')

  if (!settings.antfly.enabled) {
    if (!installed()) {
      return [warn('antfly', 'Antfly disabled and binary not installed — install with: brew install --cask antflydb/antfly/antfly')]
    }
    return [ok('antfly', 'Antfly disabled — binary installed, enable with: bakin settings set antfly.enabled true')]
  }

  if (!installed()) {
    return [error('antfly', 'Antfly enabled but binary not found — install with: brew install --cask antflydb/antfly/antfly')]
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
 * Search tables: verify registered content types have tables with data.
 * Runs only when Antfly is enabled and connected.
 */
async function checkSearchTables(): Promise<DiagnosticResult[]> {
  const settings = getSettings()
  if (!settings.antfly.enabled) return []

  try {
    const antfly = await import('./antfly')
    await antfly.initialize()

    const { getSearchHealth } = await import('./search-registry')
    const health = await getSearchHealth()

    if (!health.enabled) return []

    const results: DiagnosticResult[] = []

    if (health.tables.length === 0) {
      results.push(warn('search-tables', 'Antfly enabled but no content types registered — plugins may not have activated'))
      return results
    }

    let emptyTables = 0
    let failedTables = 0

    for (const t of health.tables) {
      if (!t.stats) {
        failedTables++
        results.push(error('search-tables', `Table "${t.table}" (${t.pluginId}) — could not read stats`))
        continue
      }

      const rawNumDocs = Number((t.stats as Record<string, unknown>).num_docs)
      if (Number.isFinite(rawNumDocs)) {
        if (rawNumDocs === 0) {
          if (t.pluginId === 'schedule') {
            results.push(ok('search-tables', `Table "${t.table}" (${t.pluginId}) has 0 persisted documents; schedule jobs are indexed at runtime`))
          } else {
            emptyTables++
            results.push(ok('search-tables', `Table "${t.table}" (${t.pluginId}) has 0 documents — reindex via POST /api/reindex?table=${t.table}`))
          }
        }
        continue
      }

      const storage = (t.stats as Record<string, unknown>).storage_status as Record<string, unknown> | undefined
      if (storage?.empty === true) {
        emptyTables++
        results.push(ok('search-tables', `Table "${t.table}" (${t.pluginId}) appears empty — reindex via POST /api/reindex?table=${t.table}`))
      }
    }

    if (results.length === 0) {
      const totals = health.tables
        .map(t => Number((t.stats as Record<string, unknown>)?.num_docs))
        .filter(n => Number.isFinite(n))

      if (totals.length > 0) {
        const total = totals.reduce((sum, n) => sum + n, 0)
        results.push(ok('search-tables', `${health.tables.length} tables, ${total} total documents indexed`))
      } else {
        results.push(ok('search-tables', `${health.tables.length} tables registered; table metadata readable (document counts unavailable from current Antfly API)`))
      }
    }

    return results
  } catch (err) {
    return [error('search-tables', `Failed to check search tables: ${err}`)]
  }
}

/**
 * Content directory: verify content lives in ~/.bakin/ not ./content/.
 * NOT auto-fixable — migration requires user judgment (moving live data).
 */
function checkContentDir(): DiagnosticResult[] {
  const contentDir = getContentDir()
  if (isUsingBakinHome()) {
    return [ok('content-dir', `Content directory: ${contentDir}`)]
  }
  return [warn('content-dir',
    `Content lives at ${contentDir} instead of ~/.bakin/ — run: bakin init && move content/* to ~/.bakin/`
  )]
}

/**
 * Orchestrator rules: verify AGENTS.md has the Bakin rules block and it's current.
 * Auto-fixable — safe to write/update our own block in AGENTS.md.
 */
const AGENT_RULES_BLOCK_START = '<!-- bakin:orchestrator-rules:start -->'
const AGENT_RULES_BLOCK_END = '<!-- bakin:orchestrator-rules:end -->'

const ORCHESTRATOR_RULES_CONTENT = `## Bakin Orchestrator Rules

> Auto-managed by \`bakin agent-rules --apply\`. Do not edit this block manually.

These rules govern Main Operator as orchestrator of the Bakin multi-agent system.

1. **Every task gets logged before work begins.** Use \`bakin tasks create\` before spawning any subagent or producing any deliverable. No exceptions.

2. **Never do subagent work inline.** Main Operator delegates — Main Operator does not generate images, write long-form copy, or produce video. That's what the team is for.

3. **High-level tasks only on the board.** Don't break tasks into subtasks yourself. Create one task, assign it, let the subagent decompose it.

4. **Subagents own their handoffs.** If Chef needs Pixel, Chef creates that task — not Main Operator. Let the pipeline flow naturally.

5. **Approval gates are non-negotiable.** Before publishing, sending, or any external action: pause and confirm with Mark unless pre-approved.

6. **Monitor the pipeline, don't micromanage.** Check heartbeats, watch for blocked tasks, intervene when stuck — but don't shadow-execute tasks that are in flight.

7. **One task per agent per piece of content.** Don't assign the same content to multiple agents in parallel. Let the assigned agent drive.

8. **AGENTS.md is your rulebook, not the subagents'.** The Bakin skill (SKILL.md) governs subagents. AGENTS.md governs you.

9. **Workflow tasks are hands-off.** If a task has a \`workflowId\`, the workflow engine manages step progression. Do not manually move workflow tasks between columns, do not produce step output yourself, and do not interfere with gates outside the Bakin UI.

10. **Every task requires a workflow decision.** When creating a task, you MUST either specify a workflow or explain why none applies:
    - With workflow: \`bakin tasks create "<title>" <agent> --workflow=<id>\`
    - Without workflow: \`bakin tasks create "<title>" <agent> --no-workflow="<reason>"\`
    If you forget, Bakin will warn you and suggest a matching workflow if one exists. Use \`bakin workflows list\` to see available workflows. The available workflows are:
WORKFLOW_CATALOG_PLACEHOLDER

The skip reason is logged to the audit trail for debugging. Always check workflows first — most content tasks have one.

11. **Gate approvals go through the UI.** When a workflow gate is reached, a notification is sent and the task card shows "Awaiting Approval" in the Bakin UI. Tell Mark a gate is waiting — do NOT approve or reject gates yourself. Mark handles gates in the task drawer.

### Workflow API Reference (Main Operator only)

These are the ONLY valid workflow endpoints. Do NOT guess at other paths.

| Action | Method | Path |
|--------|--------|------|
| List templates | GET | \`/api/plugins/workflows/definitions\` |
| Get definition | GET | \`/api/plugins/workflows/definitions/:name\` |
| Start workflow | POST | \`/api/plugins/workflows/instances/start\` — body: \`{"taskId":"...","workflowId":"..."}\` |
| List instances | GET | \`/api/plugins/workflows/instances?status=<optional>\` |
| Get instance | GET | \`/api/plugins/workflows/instances/:taskId\` |
| Pending gates | GET | \`/api/plugins/workflows/gates/pending\` |
| Gate status | GET | \`/api/plugins/workflows/gates/status?taskIds=id1,id2\` |

Do NOT use \`/api/tasks\`, \`/api/tasks/list\`, \`/api/plugins/workflows/runs\`, or \`/api/plugins/workflows/run\` — these do not exist. All task operations are via MCP exec tools (bakin_exec_tasks_*).`

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

/** Resolve the orchestrator rules template with the current workflow catalog */
async function resolveOrchestratorRules(): Promise<string> {
  return ORCHESTRATOR_RULES_CONTENT.replace('WORKFLOW_CATALOG_PLACEHOLDER', await buildWorkflowCatalog())
}

async function checkOrchestratorRules(autoFix: boolean): Promise<DiagnosticResult[]> {
  const agentsPath = getOpenClawPath('workspace', 'AGENTS.md')

  if (!existsSync(agentsPath)) {
    return [warn('orchestrator-rules', 'AGENTS.md not found — cannot verify orchestrator rules')]
  }

  const resolvedContent = await resolveOrchestratorRules()
  const current = readFileSync(agentsPath, 'utf-8')
  const startIdx = current.indexOf(AGENT_RULES_BLOCK_START)
  const endIdx = current.indexOf(AGENT_RULES_BLOCK_END)
  const hasBlock = startIdx !== -1

  if (!hasBlock) {
    if (!autoFix) {
      return [warn('orchestrator-rules', 'Orchestrator rules block missing from AGENTS.md — run: bakin agent-rules --apply', true)]
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
    return [warn('orchestrator-rules', 'Orchestrator rules block is outdated — run: bakin agent-rules --apply', true)]
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
      return [warn('mcporter', 'mcporter not installed — run: bakin setup mcporter', true)]
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
        warn('mcporter', `${missing.length} agent(s) missing or outdated in mcporter config — run: bakin setup mcporter`, true),
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
    results.push(warn('service', 'LaunchAgent plist not found — run: bakin setup service'))
    return results
  }

  try {
    const plistContent = readFileSync(plistPath, 'utf-8')

    // Check WorkingDirectory matches current project
    const wdMatch = plistContent.match(/<key>WorkingDirectory<\/key>\s*<string>([^<]+)<\/string>/)
    if (wdMatch && wdMatch[1] !== projectRoot) {
      results.push(error('service',
        `LaunchAgent WorkingDirectory is "${wdMatch[1]}" but project is at "${projectRoot}" — run: bakin setup service`
      ))
    }

    // Check server.ts path matches
    const serverMatch = plistContent.match(/<string>([^<]*server\.ts)<\/string>/)
    if (serverMatch && serverMatch[1] !== join(projectRoot, 'server.ts')) {
      results.push(error('service',
        `LaunchAgent references stale server.ts path — run: bakin setup service`
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
    results.push(warn('service', 'LaunchAgent plist exists but service is not loaded — run: bakin setup service'))
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
async function checkTaskConsistency(contentDir: string, autoFix: boolean): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = []
  const settings = getSettings()
  const hooks = getHookRegistry()

  try {
    interface TaskEntry { id: string; title: string; agent?: string; dependsOn?: string; log?: unknown[] }
    const board = await hooks.invoke<{ columns: { inProgress: TaskEntry[]; done: TaskEntry[]; todo: TaskEntry[]; blocked: TaskEntry[] } }>('tasks.readTaskboard', {})
    if (!board) { return [warn('task-consistency', 'Taskboard not available (tasks plugin not loaded)')] }
    const { columns } = board
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
            await hooks.invoke<void>('tasks.clearDependency', { taskId: task.id })
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

  const message = `Bakin Doctor found ${issues.length} issue(s) that need your attention:\n\n${lines.join('\n')}\n\nRun \`bakin doctor\` for full details.`

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
 *   <!-- bakin:{blockId}:start -->
 *   {content}
 *   <!-- bakin:{blockId}:end -->
 */
function checkManagedBlock(def: ManagedBlockDef, autoFix: boolean): DiagnosticResult[] {
  const settings = getSettings()
  const results: DiagnosticResult[] = []
  const openclawBase = getOpenClawPath()
  const startMarker = `<!-- bakin:${def.blockId}:start -->`
  const endMarker = `<!-- bakin:${def.blockId}:end -->`
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
    contentFn: (agentId: string) => `## Bakin Mission Control

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

All Bakin interactions use **mcporter**. Your MCP server is \`bakin-${agentId}\`.

### Session Start
1. Check your tasks: \`mcporter call bakin-${agentId}.bakin_get_task taskId=<id>\`
2. Load the Bakin skill for full conventions and tool reference

### Path Discovery
All content paths are resolved via mcporter — never hardcode paths:
\`\`\`bash
mcporter call bakin-${agentId}.bakin_get_paths
\`\`\`

### Task Changes
- Use \`bakin_report_complete\` when done, \`bakin_block_task\` when stuck
- Use Bakin tools via mcporter for all task operations

### Heartbeat (every 10 minutes)
- Write your heartbeat JSON to the heartbeats path (discover via \`bakin_get_paths\`)
- Check for new tasks via mcporter`,
  },

  {
    blockId: 'hard-rules',
    contentFn: (agentId: string) => `## Bakin Hard Rules

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

- **NEVER use \`openclaw agent\` to spawn or message other agents directly.** Always create a Bakin task via \`mcporter call bakin-${agentId}.bakin_create_task title="<task>" assignee="<agent>"\` instead. Direct spawning bypasses the pipeline.
- **NEVER modify task state directly.** Use Bakin tools via mcporter only.
- **NEVER post to Discord without explicit instruction.** Content goes through Mark's review first.
- **NEVER hardcode file paths.** Always discover paths via \`mcporter call bakin-${agentId}.bakin_get_paths\`. Hardcoded paths break when the content directory moves.
- **NEVER run scripts/bin/*.ts directly.** Those are debug wrappers that bypass Bakin tracking — no MCP call, no Health metrics, no audit log. Always use the MCP tool via \`mcporter call bakin-${agentId}.bakin_exec_<tool> ...\` instead.
- **NEVER use \`openclaw cron\` directly for recurring tasks.** Use \`mcporter call bakin-${agentId}.bakin_exec_schedule_create name="..." schedule="every day at 9am" agentId="..." taskPrompt="..."\` instead. Direct cron jobs bypass Bakin — no agent context, no task creation, no audit trail.`,
  },

  {
    blockId: 'dependency-pattern',
    contentFn: (agentId: string) => `## Bakin Dependency Pattern

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

If your task requires output from another agent, create their task first, note its task ID, then register a dependency:
\`\`\`bash
mcporter call bakin-${agentId}.bakin_register_dependency taskId=<your-task-id> dependsOn=<their-task-id>
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
        content += `\n**IMAGES:** You cannot generate images. Ever. Not with nano-banana-pro, not with any other tool. All image generation goes through Pixel. Create a Pixel task via \`mcporter call bakin-${agentId}.bakin_create_task\` and wait.\n`
      }

      if (!canVideo) {
        content += `\n**VIDEO:** You cannot generate video. Ever. Not with Runway, not with any other tool. All video generation goes through Rolo. Create a Rolo task via \`mcporter call bakin-${agentId}.bakin_create_task\` and wait.\n`
      }

      if (!canImage && !canVideo) {
        content += `\nIf you find yourself about to run an image or video generation tool — stop. Create a subtask for the right agent instead.\n`
      }

      if (createsSubtasks) {
        content += `\n### When Creating Pixel or Rolo Tasks\n`
        content += `\n- **NEVER include posting instructions in a Pixel or Rolo brief.** They generate assets only — they do not post.`
        content += `\n- Task descriptions for Pixel/Rolo should end with asset delivery: "Save to the assets directory (discover path via \`bakin_get_paths\`) and report the file path."`
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

2. **Submit output ONLY via mcporter:** \`mcporter call bakin-${agentId}.bakin_submit_step taskId=<id> stepId=<step> --args '<json>'\`. Conversational output does NOT complete the step.

3. **Do NOT move the task, create subtasks, or message main-operator** for workflow tasks — the workflow engine handles all coordination.

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
- **Recurring work** (daily posts, weekly reports, periodic checks) → \`bakin_exec_schedule_create\`
- **One-time deliverables** → \`bakin_create_task\``,
  },

  {
    blockId: 'asset-rules',
    contentFn: (agentId: string) => `## Bakin Asset Rules

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

All created content (images, video, audio, text, plans, data) MUST go to the assets directory. Use the Bakin skill for full conventions, but here's the minimum:

1. **Discover paths via mcporter:** \`mcporter call bakin-${agentId}.bakin_get_paths\`
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
async function checkWorkflowDefinitions(contentDir: string): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = []
  const skillsDir = join(contentDir, 'workflows', 'skills')

  try {
    const defs = await getHookRegistry().invoke<Array<{ name: string; definition: { steps: Array<Record<string, unknown>> } }>>('workflows.listDefinitions', {}) ?? []
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
async function checkStaleWorkflowInstances(contentDir: string, autoFix: boolean): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = []
  const hooks = getHookRegistry()

  try {
    // Check all instances (not just in_progress) for orphans
    interface WfInstance { taskId: string; status: string; currentStepId: string; updatedAt: string }
    const allInstances = await hooks.invoke<WfInstance[]>('workflows.listInstances', {}) ?? []
    interface BoardTask { id: string }
    const board = await hooks.invoke<{ columns: Record<string, BoardTask[]> }>('tasks.readTaskboard', {})
    if (!board) { return [warn('workflow-instances', 'Taskboard not available')] }
    const { columns } = board
    const allTaskIds = new Set<string>()
    for (const col of Object.values(columns)) {
      for (const task of col) {
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
// Schedule sync — detect orphaned OpenClaw cron jobs not tracked in sidecar
// ---------------------------------------------------------------------------

function checkScheduleSync(autoFix: boolean): DiagnosticResult[] {
  const checkName = 'schedule-sync'
  const results: DiagnosticResult[] = []

  // Resolve OpenClaw jobs path — configurable, absent on fresh installs
  let jobsPath: string
  try {
    const configPath = getOpenClawPath('config.json')
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      jobsPath = config?.cron?.store ?? getOpenClawPath('cron', 'jobs.json')
    } else {
      jobsPath = getOpenClawPath('cron', 'jobs.json')
    }
  } catch {
    jobsPath = getOpenClawPath('cron', 'jobs.json')
  }

  if (!existsSync(jobsPath)) {
    // Fresh install or no cron jobs yet — nothing to sync
    return [ok(checkName, 'No OpenClaw cron jobs file found (fresh install)')]
  }

  let openclawJobs: Array<{ id: string; name: string; payload?: Record<string, unknown> }>
  try {
    const raw = JSON.parse(readFileSync(jobsPath, 'utf-8'))
    openclawJobs = raw?.jobs ?? []
  } catch (err) {
    return [warn(checkName, `Failed to read OpenClaw jobs: ${err}`)]
  }

  if (openclawJobs.length === 0) {
    return [ok(checkName, 'No OpenClaw cron jobs to sync')]
  }

  // Read Bakin sidecar
  let sidecar: { version: number; jobs: Record<string, unknown> }
  try {
    const sidecarPath = join(getContentDir(), 'schedule', 'sidecar.json')
    if (existsSync(sidecarPath)) {
      sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    } else {
      sidecar = { version: 1, jobs: {} }
    }
  } catch {
    sidecar = { version: 1, jobs: {} }
  }

  const orphans: typeof openclawJobs = []
  for (const job of openclawJobs) {
    if (!sidecar.jobs[job.id]) {
      orphans.push(job)
    }
  }

  if (orphans.length === 0) {
    return [ok(checkName, `${openclawJobs.length} cron job(s), all tracked in Bakin sidecar`)]
  }

  for (const orphan of orphans) {
    if (autoFix) {
      // Auto-adopt: create minimal sidecar entry flagged for manual triage
      const now = new Date().toISOString()
      const entry = {
        jobId: orphan.id,
        isBakinJob: false,
        displayName: orphan.name,
        agentId: undefined, // Don't guess — flag for triage
        owner: 'main-operator',
        requireTriage: true,
        createdAt: now,
        updatedAt: now,
      }
      sidecar.jobs[orphan.id] = entry
      results.push(fixed(checkName, `Auto-adopted orphan cron job "${orphan.name}" (id: ${orphan.id})`))
      log.info('Auto-adopted orphan cron job', { jobId: orphan.id, name: orphan.name })
    } else {
      results.push(warn(checkName, `Orphan cron job "${orphan.name}" (id: ${orphan.id}) — not tracked in Bakin sidecar`, true))
    }
  }

  // Write updated sidecar if we adopted anything
  if (autoFix && results.some(r => r.status === 'fixed')) {
    try {
      const sidecarPath = join(getContentDir(), 'schedule', 'sidecar.json')
      const dir = dirname(sidecarPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf-8')
    } catch (err) {
      results.push(error(checkName, `Failed to write updated sidecar: ${err}`))
    }
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
  const startMarker = '<!-- bakin:exec-tools:start -->'
  const endMarker = '<!-- bakin:exec-tools:end -->'

  const tools = getAllExecTools()
  if (tools.length === 0) return [ok(checkName, 'No exec tools registered')]

  const toolLines = tools
    .map(t => `| \`${t.name}\` | ${t.description} |`)
    .join('\n')

  const expectedContent = `## Execution Tools

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

Use these tools to accomplish actual work — saving files, posting content, generating images, scheduling jobs. Called the same way as MCP tools via mcporter.

| Tool | Purpose |
|------|---------|
${toolLines}

### Quick Reference

\`\`\`bash
# Save a file as a managed asset (handles naming + sidecar automatically)
mcporter call bakin-<agent>.bakin_exec_save_asset taskId=<id> type=<images|text|video|audio|plans|data|other> filePath="<path>" description="<desc>"
# Post to Discord (with optional image/video attachment)
mcporter call bakin-<agent>.bakin_exec_post_discord channel="<name>" content="<msg>" taskId=<id>
# Generate image via Nano Banana
mcporter call bakin-<agent>.bakin_exec_gen_image taskId=<id> prompt="<text>" preset=social-portrait model=flash
# Check workflow gate statuses
mcporter call bakin-<agent>.bakin_exec_check_gates taskId=<id>
# Create a recurring scheduled job (NEVER use openclaw cron directly)
mcporter call bakin-<agent>.bakin_exec_schedule_create name="daily-recipe" schedule="every day at 11am" agentId="chef" taskPrompt="Post a short recipe"
# List all scheduled jobs
mcporter call bakin-<agent>.bakin_exec_schedule_list
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
// ---------------------------------------------------------------------------
// Task order integrity
// ---------------------------------------------------------------------------

function checkTaskPositionIntegrity(autoFix: boolean): DiagnosticResult[] {
  const CHECK = 'tasks.order_integrity'
  try {
    const Database = require('better-sqlite3')
    const dbPath = getOpenClawPath('flows', 'registry.sqlite')
    if (!existsSync(dbPath)) return [ok(CHECK, 'No task database found (OK for fresh install)')]

    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')

    try {
      const rows = db.prepare(
        `SELECT flow_id, status, state_json, blocked_task_id, updated_at FROM flow_runs WHERE owner_key LIKE 'bakin:task:%'`
      ).all() as Array<{ flow_id: string; status: string; state_json: string | null; blocked_task_id: string | null; updated_at: number }>

      if (rows.length === 0) return [ok(CHECK, 'No tasks to check')]

      // Check for missing or invalid order values
      let missingCount = 0
      const byColumn = new Map<string, Array<{ flowId: string; order: number | null; updatedAt: number }>>()

      for (const row of rows) {
        const state = row.state_json ? JSON.parse(row.state_json) : {}
        const ord = typeof state.order === 'number' ? state.order : null

        // Derive column (inlined from flow-store.ts)
        let col: string
        switch (row.status) {
          case 'queued': col = state.column === 'backlog' ? 'backlog' : 'todo'; break
          case 'running': col = 'inProgress'; break
          case 'waiting': col = row.blocked_task_id ? 'blocked' : 'review'; break
          case 'succeeded': col = (state.archived || state.confirmed) ? 'archived' : 'done'; break
          default: col = 'backlog'
        }

        if (ord === null) missingCount++
        if (!byColumn.has(col)) byColumn.set(col, [])
        byColumn.get(col)!.push({ flowId: row.flow_id, order: ord, updatedAt: row.updated_at })
      }

      // Check for duplicates within columns
      let duplicateCount = 0
      for (const [, colTasks] of byColumn) {
        const orders = colTasks.filter(t => t.order !== null).map(t => t.order!)
        const unique = new Set(orders)
        if (unique.size < orders.length) duplicateCount += orders.length - unique.size
      }

      if (missingCount === 0 && duplicateCount === 0) {
        return [ok(CHECK, `All ${rows.length} tasks have valid unique order values`)]
      }

      const issues = []
      if (missingCount > 0) issues.push(`${missingCount} missing`)
      if (duplicateCount > 0) issues.push(`${duplicateCount} duplicates`)

      if (!autoFix) {
        return [warn(CHECK, `Order issues: ${issues.join(', ')} across ${rows.length} tasks`, true)]
      }

      // Auto-fix: reassign order per column (zero-indexed) based on updated_at order
      const stmt = db.prepare(`UPDATE flow_runs SET state_json = json_set(state_json, '$.order', ?) WHERE flow_id = ?`)
      const tx = db.transaction(() => {
        for (const [, colTasks] of byColumn) {
          colTasks.sort((a, b) => b.updatedAt - a.updatedAt)
          for (let i = 0; i < colTasks.length; i++) {
            stmt.run(i, colTasks[i].flowId)
          }
        }
      })
      tx()

      return [fixed(CHECK, `Fixed order issues (${issues.join(', ')}) across ${rows.length} tasks`)]
    } finally {
      db.close()
    }
  } catch (err) {
    return [error(CHECK, `Order check failed: ${(err as Error).message}`)]
  }
}

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
  results.push(...checkContentDir())
  results.push(...checkAgentRoster(contentDir))
  results.push(...checkPersonas(contentDir, autoFix))
  results.push(...checkTaskboard(contentDir, autoFix))
  results.push(...checkExecToolsBlock(projectRoot, autoFix))
  results.push(...checkAndSyncSkill(projectRoot, autoFix))
  results.push(...await checkOrchestratorRules(autoFix))
  results.push(...applyAllManagedBlocks(autoFix))
  results.push(...checkWorkflowSkills(contentDir))
  results.push(...await checkWorkflowDefinitions(contentDir))
  results.push(...await checkStaleWorkflowInstances(contentDir, autoFix))
  results.push(...await checkTaskConsistency(contentDir, autoFix))
  results.push(...checkAssets(contentDir, autoFix))
  results.push(...checkScheduleSync(autoFix))
  results.push(...checkMcporter(Number(process.env.PORT || 3737), autoFix))
  results.push(...checkService(projectRoot))
  results.push(...checkTaskPositionIntegrity(autoFix))

  // Async checks (network, not auto-fixable) — run in parallel
  const [gatewayResults, antflyResults, searchTableResults] = await Promise.all([
    checkGateway(),
    checkAntfly(),
    checkSearchTables(),
  ])
  results.push(...gatewayResults, ...antflyResults, ...searchTableResults)

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
