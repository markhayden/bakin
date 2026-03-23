/**
 * Beacon Doctor — health checks, OpenClaw sync, and auto-repair.
 * Runs on startup and on a configurable cadence to keep systems aligned.
 *
 * Auto-fix policy:
 *   SAFE (auto-fix):   Creating new files, installing/updating skill, making dirs
 *   UNSAFE (notify):   Agent roster mismatches, gateway down, taskboard corruption,
 *                      anything requiring human judgment
 *
 * Unsafe issues are reported to roscoe via OpenClaw so they show up in conversation.
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

const log = createLogger('doctor')

let doctorTimer: NodeJS.Timeout | null = null

// Track what we've already notified about to avoid spamming roscoe
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
      const resolved = agent === 'roscoe' ? 'main' : agent
      if (!openclawAgents.includes(resolved)) {
        results.push(warn('agent-roster', `Agent "${agent}" is in Beacon but not in OpenClaw`))
      }
    }

    for (const ocAgent of openclawAgents) {
      const beaconName = ocAgent === 'main' ? 'roscoe' : ocAgent
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

These rules govern Roscoe as orchestrator of the Beacon multi-agent system.

1. **Every task gets logged before work begins.** Use \`beacon tasks create\` before spawning any subagent or producing any deliverable. No exceptions.

2. **Never do subagent work inline.** Roscoe delegates — Roscoe does not generate images, write long-form copy, or produce video. That's what the team is for.

3. **High-level tasks only on the board.** Don't break tasks into subtasks yourself. Create one task, assign it, let the subagent decompose it.

4. **Subagents own their handoffs.** If Basil needs Pixel, Basil creates that task — not Roscoe. Let the pipeline flow naturally.

5. **Approval gates are non-negotiable.** Before publishing, sending, or any external action: pause and confirm with Mark unless pre-approved.

6. **Monitor the pipeline, don't micromanage.** Check heartbeats, watch for blocked tasks, intervene when stuck — but don't shadow-execute tasks that are in flight.

7. **One task per agent per piece of content.** Don't assign the same content to multiple agents in parallel. Let the assigned agent drive.

8. **AGENTS.md is your rulebook, not the subagents'.** The Beacon skill (SKILL.md) governs subagents. AGENTS.md governs you.

9. **Workflow tasks are hands-off.** If a task has a \`workflowId\`, the workflow engine manages step progression. Do not manually move workflow tasks between columns, do not produce step output yourself, and do not interfere with gates outside the Beacon UI.`

function checkOrchestratorRules(autoFix: boolean): DiagnosticResult[] {
  const agentsPath = join(process.env.HOME || '~', '.openclaw', 'workspace', 'AGENTS.md')

  if (!existsSync(agentsPath)) {
    return [warn('orchestrator-rules', 'AGENTS.md not found — cannot verify orchestrator rules')]
  }

  const current = readFileSync(agentsPath, 'utf-8')
  const startIdx = current.indexOf(AGENT_RULES_BLOCK_START)
  const endIdx = current.indexOf(AGENT_RULES_BLOCK_END)
  const hasBlock = startIdx !== -1

  if (!hasBlock) {
    if (!autoFix) {
      return [warn('orchestrator-rules', 'Orchestrator rules block missing from AGENTS.md — run: beacon agent-rules --apply', true)]
    }
    const block = `${AGENT_RULES_BLOCK_START}\n${ORCHESTRATOR_RULES_CONTENT}\n${AGENT_RULES_BLOCK_END}\n`
    writeFileSync(agentsPath, current.trimEnd() + '\n\n' + block, 'utf-8')
    return [fixed('orchestrator-rules', 'Added orchestrator rules block to AGENTS.md')]
  }

  if (endIdx === -1) {
    return [error('orchestrator-rules', 'Orchestrator rules block start marker found but no end marker — AGENTS.md may be corrupt')]
  }

  const blockContent = current.slice(startIdx + AGENT_RULES_BLOCK_START.length, endIdx).trim()
  const expected = ORCHESTRATOR_RULES_CONTENT.trim()

  if (blockContent === expected) {
    return [ok('orchestrator-rules', 'Orchestrator rules block present and up to date')]
  }

  if (!autoFix) {
    return [warn('orchestrator-rules', 'Orchestrator rules block is outdated — run: beacon agent-rules --apply', true)]
  }

  const block = `${AGENT_RULES_BLOCK_START}\n${ORCHESTRATOR_RULES_CONTENT}\n${AGENT_RULES_BLOCK_END}`
  const updated = current.slice(0, startIdx) + block + current.slice(endIdx + AGENT_RULES_BLOCK_END.length)
  writeFileSync(agentsPath, updated, 'utf-8')
  return [fixed('orchestrator-rules', 'Updated orchestrator rules block in AGENTS.md')]
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
      if (task.agent && !knownAgents.has(task.agent) && task.agent !== 'roscoe') {
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
// Notification — escalate unfixable issues to roscoe
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
    log.info('Notified roscoe of unfixable issues', { count: issues.length })
  } catch (err) {
    // Gateway might be the issue — can't notify about that
    log.warn('Could not notify roscoe of doctor issues (gateway may be down)', err)
  }
}

// ---------------------------------------------------------------------------
// Per-agent workflow rules
// ---------------------------------------------------------------------------

const AGENT_WORKFLOW_BLOCK_START = '<!-- beacon:workflow-rules:start -->'
const AGENT_WORKFLOW_BLOCK_END = '<!-- beacon:workflow-rules:end -->'

const AGENT_WORKFLOW_RULES_CONTENT = `## Beacon Workflow Rules

> Auto-managed by \`beacon doctor\`. Do not edit this block manually.

When Beacon dispatches a workflow step to you, the dispatch message contains everything you need: step instructions, output schema, and the exact API call to submit.

1. **The dispatch message is your single source of truth.** Follow it exactly for workflow steps.

2. **Submit output ONLY via the step/complete API.** Include your \`agentId\` in the request. Conversational output does NOT complete the step.

3. **Do NOT move the task, create subtasks, or message roscoe** for workflow tasks — the workflow engine handles all coordination.

4. **Address rejection feedback specifically.** If re-dispatched with "REVISION REQUIRED", read the feedback and produce genuinely revised output. The server rejects near-duplicate resubmissions.

5. **After submitting, STOP.** Do not generate additional outputs, start work on future steps, or send completion messages.

6. **Respect tool restrictions.** If the dispatch message lists "TOOL RESTRICTIONS", do NOT use those tools. Block the task if you need them.`

function checkAgentWorkflowRules(autoFix: boolean): DiagnosticResult[] {
  const settings = getSettings()
  const results: DiagnosticResult[] = []
  const openclawBase = join(process.env.HOME || '~', '.openclaw')

  for (const agentId of settings.agents) {
    // Skip roscoe — orchestrator rules cover that
    if (agentId === 'roscoe') continue

    const agentsPath = join(openclawBase, 'workspaces', agentId, 'AGENTS.md')

    if (!existsSync(agentsPath)) {
      results.push(warn('agent-workflow-rules', `AGENTS.md not found for ${agentId} — cannot verify workflow rules`))
      continue
    }

    const current = readFileSync(agentsPath, 'utf-8')
    const startIdx = current.indexOf(AGENT_WORKFLOW_BLOCK_START)
    const endIdx = current.indexOf(AGENT_WORKFLOW_BLOCK_END)
    const hasBlock = startIdx !== -1

    if (!hasBlock) {
      if (!autoFix) {
        results.push(warn('agent-workflow-rules', `Workflow rules block missing from ${agentId}/AGENTS.md`, true))
        continue
      }
      const block = `${AGENT_WORKFLOW_BLOCK_START}\n${AGENT_WORKFLOW_RULES_CONTENT}\n${AGENT_WORKFLOW_BLOCK_END}\n`
      writeFileSync(agentsPath, current.trimEnd() + '\n\n' + block, 'utf-8')
      results.push(fixed('agent-workflow-rules', `Added workflow rules block to ${agentId}/AGENTS.md`))
      continue
    }

    if (endIdx === -1) {
      results.push(error('agent-workflow-rules', `Workflow rules block start marker found in ${agentId}/AGENTS.md but no end marker`))
      continue
    }

    const blockContent = current.slice(startIdx + AGENT_WORKFLOW_BLOCK_START.length, endIdx).trim()
    const expected = AGENT_WORKFLOW_RULES_CONTENT.trim()

    if (blockContent === expected) {
      results.push(ok('agent-workflow-rules', `Workflow rules in ${agentId}/AGENTS.md are up to date`))
    } else if (autoFix) {
      const block = `${AGENT_WORKFLOW_BLOCK_START}\n${AGENT_WORKFLOW_RULES_CONTENT}\n${AGENT_WORKFLOW_BLOCK_END}`
      const updated = current.slice(0, startIdx) + block + current.slice(endIdx + AGENT_WORKFLOW_BLOCK_END.length)
      writeFileSync(agentsPath, updated, 'utf-8')
      results.push(fixed('agent-workflow-rules', `Updated workflow rules block in ${agentId}/AGENTS.md`))
    } else {
      results.push(warn('agent-workflow-rules', `Workflow rules block is outdated in ${agentId}/AGENTS.md`, true))
    }
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
function checkStaleWorkflowInstances(contentDir: string): DiagnosticResult[] {
  const results: DiagnosticResult[] = []

  try {
    const instances = listInstances('in_progress', contentDir)
    const now = Date.now()
    const staleThreshold = 2 * 60 * 60 * 1000 // 2 hours

    for (const instance of instances) {
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
// Main
// ---------------------------------------------------------------------------

/**
 * Run all health checks with auto-fix for safe issues.
 * Notifies roscoe via OpenClaw about issues that need human judgment.
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
  results.push(...checkAndSyncSkill(projectRoot, autoFix))
  results.push(...checkOrchestratorRules(autoFix))
  results.push(...checkAgentWorkflowRules(autoFix))
  results.push(...checkWorkflowSkills(contentDir))
  results.push(...checkWorkflowDefinitions(contentDir))
  results.push(...checkStaleWorkflowInstances(contentDir))
  results.push(...checkTaskConsistency(contentDir, autoFix))
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

  // Notify roscoe about things we can't auto-fix
  await notifyUnfixableIssues(results)

  return results
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
