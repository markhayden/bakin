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

import { agentAssetsComponent } from '../../../src/core/onboarding/agent-assets'
import type { HealthCheckResult, HealthRepairHandler } from '../../../packages/core/src/plugin-types'

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
 * Verify each agent has a persona file. Report-only; personaRepair creates
 * missing stub files explicitly through the doctor repair workflow.
 */
export async function checkPersonas(
  contentDir: string,
  runtime: RuntimeAgentReader,
): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []
  let agentIds: string[]
  try {
    agentIds = (await runtime.list()).map(agent => agent.id).filter(Boolean)
  } catch (err) {
    return [warn('personas', `Failed to read runtime agents: ${err}`, true)]
  }
  const personasDir = join(contentDir, 'team', 'personas')

  if (!existsSync(personasDir)) {
    results.push(warn('personas', `No personas directory at ${personasDir}`, true))
    return results
  }

  const existing = new Set(
    readdirSync(personasDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
  )

  for (const agent of agentIds) {
    if (!existing.has(agent)) {
      results.push(warn('personas', `Missing persona: ${join(personasDir, `${agent}.md`)}`, true))
    }
  }

  if (results.filter(r => r.check === 'personas').length === 0) {
    results.push(ok('personas', `All ${agentIds.length} agents have persona files`))
  }

  return results
}

function personaStub(agent: string): string {
  return `# ${agent.charAt(0).toUpperCase() + agent.slice(1)}\n\n_Persona not yet configured. Update this file with the agent's personality, background, and communication style._\n`
}

export function personaRepair(contentDir: string, runtime: RuntimeAgentReader): HealthRepairHandler {
  return {
    async plan(rows) {
      const matching = rows.filter(row => row.check === 'personas' && row.autoFixable)
      if (matching.length === 0) return []
      return [{
        id: 'team.create-personas',
        checkId: 'personas',
        title: 'Create missing persona files',
        reason: matching.map(row => row.message).join('; '),
        safety: 'safe',
        requiresConfirmation: true,
        changes: [{
          kind: 'file',
          target: join(contentDir, 'team', 'personas'),
          action: 'create',
          description: 'Create the personas directory and stub markdown files for runtime agents missing personas.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const agentIds = (await runtime.list()).map(agent => agent.id).filter(Boolean)
      const personasDir = join(contentDir, 'team', 'personas')
      mkdirSync(personasDir, { recursive: true })
      const existing = new Set(
        existsSync(personasDir)
          ? readdirSync(personasDir).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''))
          : [],
      )
      const changes = []
      for (const agent of agentIds) {
        if (existing.has(agent)) continue
        const path = join(personasDir, `${agent}.md`)
        writeFileSync(path, personaStub(agent), 'utf-8')
        changes.push({
          kind: 'file' as const,
          target: path,
          action: 'create' as const,
          description: `Created stub persona for ${agent}.`,
        })
      }
      return [{
        id: 'team.create-personas',
        checkId: 'personas',
        status: 'applied',
        message: `Created ${changes.length} stub persona file(s).`,
        changes,
      }]
    },
  }
}

// ─── Agent-package projections: drift / missing / broken-marker findings ──

/**
 * Surface drift / missing / broken-marker findings from the
 * agent-assets onboarding component. Report-only; agentAssetsRepair runs the
 * same install() flow as `bakin install agent-assets` explicitly.
 *
 * Doctor sweep companion to the user-facing `bakin doctor` view; the
 * onboarding component (src/core/onboarding/agent-assets.ts) drives
 * the CLI surface, this wrapper reuses its scan + install paths so
 * the two views never disagree.
 */
export async function checkAgentAssets(): Promise<HealthCheckResult[]> {
  try {
    const checkResult = await agentAssetsComponent.check()
    if (checkResult.status === 'ok') {
      return [ok('agent-assets', checkResult.message)]
    }

    const reminder = checkResult.remediation ?? 'Run `bakin install agent-assets` to repair.'
    return [warn('agent-assets', `${checkResult.message} — ${reminder}`, true)]
  } catch (err) {
    return [warn('agent-assets', `agent-assets check failed: ${err}`)]
  }
}

export function agentAssetsRepair(): HealthRepairHandler {
  return {
    async plan(rows) {
      const matching = rows.filter(row => row.check === 'agent-assets' && row.autoFixable)
      if (matching.length === 0) return []
      return [{
        id: 'team.install-agent-assets',
        checkId: 'agent-assets',
        title: 'Repair agent-package projections',
        reason: matching.map(row => row.message).join('; '),
        safety: 'safe',
        requiresConfirmation: true,
        changes: [{
          kind: 'runtime',
          target: 'agent-package projections',
          action: 'invoke',
          description: 'Run the agent-assets install flow to repair missing or drifted projected files.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const installResult = await agentAssetsComponent.install({
        interactive: false,
        autoApprove: true,
        json: false,
        checkOnly: false,
        force: false,
      })
      return [{
        id: 'team.install-agent-assets',
        checkId: 'agent-assets',
        status: installResult.status === 'failed' ? 'failed' : 'applied',
        message: installResult.message,
        changes: [{
          kind: 'runtime',
          target: 'agent-package projections',
          action: 'invoke',
          description: `agent-assets install returned ${installResult.status}.`,
        }],
      }]
    },
  }
}
