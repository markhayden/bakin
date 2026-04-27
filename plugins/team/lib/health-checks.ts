/**
 * Team-plugin-owned doctor checks.
 *
 * Migrated out of src/core/doctor.ts (#139) — these three checks operate
 * on team-plugin data (agent roster sync, persona files, agent-package
 * projection drift) so they belong with the plugin that owns those
 * concerns.
 *
 * Registered in plugins/team/index.ts activate() via
 * ctx.registerHealthCheck. runDiagnostics() picks them up through the
 * plugin-check loop in src/core/doctor.ts's runPluginHealthChecks().
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { getSettings } from '../../../src/core/settings'
import { getAgentIds } from '../../../packages/core/src/openclaw-config'
import { getOpenClawPath } from '../../../packages/core/src/openclaw-home'
import { agentAssetsComponent } from '../../../src/core/onboarding/agent-assets'
import type { HealthCheckResult } from '../../../packages/core/src/plugin-types'

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

// ─── Agent roster: Bakin agents vs OpenClaw agents ─────────────────────────

/**
 * Compare Bakin's agent ids (from openclaw.json) with OpenClaw's own
 * agents.list. NOT auto-fixable — which system is "right" requires
 * human judgment.
 */
export function checkAgentRoster(): HealthCheckResult[] {
  const results: HealthCheckResult[] = []
  const openclawConfigPath = getOpenClawPath('openclaw.json')

  if (!existsSync(openclawConfigPath)) {
    results.push(warn('agent-roster', 'openclaw.json not found — cannot verify agent roster'))
    return results
  }

  try {
    const config = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'))
    const openclawAgents = (config.agents?.list || []).map((a: { id: string }) => a.id)
    const bakinAgents = getAgentIds()

    for (const agent of bakinAgents) {
      if (!openclawAgents.includes(agent)) {
        results.push(warn('agent-roster', `Agent "${agent}" is in Bakin but not in OpenClaw`))
      }
    }

    for (const ocAgent of openclawAgents) {
      if (!bakinAgents.includes(ocAgent)) {
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

// ─── Personas: each agent has a persona file under {contentDir}/team/personas

/**
 * Verify each agent has a persona file. Auto-fixable — creates stub
 * files for missing agents when settings.doctor.autoFixSkill is true.
 */
export function checkPersonas(contentDir: string): HealthCheckResult[] {
  const results: HealthCheckResult[] = []
  const autoFix = getSettings().doctor.autoFixSkill
  const agentIds = getAgentIds()
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
  for (const agent of agentIds) {
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
    results.push(ok('personas', `All ${agentIds.length} agents have persona files`))
  }

  return results
}

// ─── Agent-package projections: drift / missing / broken-marker findings ──

/**
 * Surface drift / missing / broken-marker findings from the
 * agent-assets onboarding component. With autoFix enabled
 * (settings.doctor.autoFixSkill), runs the same install() flow as
 * `bakin install agent-assets` to repair detected drift in-place.
 *
 * Doctor sweep companion to the user-facing `bakin doctor` view; the
 * onboarding component (src/core/onboarding/agent-assets.ts) drives
 * the CLI surface, this wrapper reuses its scan + install paths so
 * the two views never disagree.
 */
export async function checkAgentAssets(): Promise<HealthCheckResult[]> {
  const autoFix = getSettings().doctor.autoFixSkill
  try {
    const checkResult = await agentAssetsComponent.check()
    if (checkResult.status === 'ok') {
      return [ok('agent-assets', checkResult.message)]
    }

    if (autoFix) {
      const installResult = await agentAssetsComponent.install({
        interactive: false,
        autoApprove: true,
        json: false,
        checkOnly: false,
        force: false,
      })
      if (installResult.status === 'installed') {
        return [fixed('agent-assets', installResult.message)]
      }
      if (installResult.status === 'noop') {
        return [ok('agent-assets', installResult.message)]
      }
      return [error('agent-assets', `Repair failed: ${installResult.message}`)]
    }

    const reminder = checkResult.remediation ?? 'Run `bakin install agent-assets` to repair.'
    return [warn('agent-assets', `${checkResult.message} — ${reminder}`, true)]
  } catch (err) {
    return [warn('agent-assets', `agent-assets check failed: ${err}`)]
  }
}
