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
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

import { getSettings } from '../../../src/core/settings'
import { agentAssetsComponent } from '../../../src/core/onboarding/agent-assets'
import type { HealthCheckResult } from '../../../packages/core/src/plugin-types'

type RuntimeAgentReader = Pick<AgentRuntimeAdapter['agents'], 'list'>

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

// ─── Agent roster: runtime agents exposed to Bakin ─────────────────────────

/**
 * Verify the runtime adapter can provide a coherent agent roster.
 * NOT auto-fixable - which runtime condition is "right" requires human
 * judgment.
 */
export async function checkAgentRoster(runtime: RuntimeAgentReader): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []
  let agents: Awaited<ReturnType<RuntimeAgentReader['list']>>
  try {
    agents = await runtime.list()
  } catch (err) {
    return [error('agent-roster', `Failed to read runtime agent roster: ${err}`)]
  }

  const seen = new Set<string>()
  for (const agent of agents) {
    if (!agent.id) {
      results.push(warn('agent-roster', 'Runtime returned an agent without an id'))
      continue
    }
    if (seen.has(agent.id)) {
      results.push(warn('agent-roster', `Duplicate runtime agent id "${agent.id}"`))
    }
    seen.add(agent.id)
  }

  if (results.length === 0) {
    results.push(ok('agent-roster', `${agents.length} runtime agent(s) available`))
  }

  return results
}

// ─── Personas: each agent has a persona file under {contentDir}/team/personas

/**
 * Verify each agent has a persona file. Auto-fixable — creates stub
 * files for missing agents when settings.doctor.autoFixSkill is true.
 */
export async function checkPersonas(
  contentDir: string,
  runtime: RuntimeAgentReader,
): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []
  const autoFix = getSettings().doctor.autoFixSkill
  let agentIds: string[]
  try {
    agentIds = (await runtime.list()).map(agent => agent.id).filter(Boolean)
  } catch (err) {
    return [warn('personas', `Failed to read runtime agents: ${err}`, true)]
  }
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
