import { createLogger } from '../logger'
import { createAppServices, maybeGetAppServices } from '../app-services'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { checkBakinRuntimeSkill, syncBakinRuntimeSkill } from '../bakin-skill'
import { syncOpenClawMcpConfig, verifyOpenClawMcpConfig } from '../openclaw-integration'
import type { CheckResult, InstallResult, OnboardingComponent } from './types'

const log = createLogger('onboarding:openclaw-integration')

function getPort(): number {
  return Number(process.env.PORT || 3737)
}

function projectRoot(): string {
  return process.cwd()
}

async function getRuntimeForOnboarding(): Promise<AgentRuntimeAdapter> {
  const existing = maybeGetAppServices()?.runtime
  if (existing) return existing
  return (await createAppServices()).runtime
}

async function check(): Promise<CheckResult> {
  const port = getPort()
  let runtime: AgentRuntimeAdapter
  try {
    runtime = await getRuntimeForOnboarding()
  } catch (err) {
    return {
      name: 'openclaw-integration',
      status: 'missing',
      message: `Runtime adapter could not initialize: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  try {
    const [skill, mcp] = await Promise.all([
      checkBakinRuntimeSkill(projectRoot(), runtime),
      verifyOpenClawMcpConfig(port),
    ])
    const missingMcpEntries = mcp.agentEntries.filter((entry) => !entry.correct)
    const issues = [
      ...(skill.upToDate ? [] : [skill.installed ? 'Bakin runtime skill is outdated' : 'Bakin runtime skill is missing']),
      ...(missingMcpEntries.length > 0 ? [`${missingMcpEntries.length} Bakin MCP entr${missingMcpEntries.length === 1 ? 'y is' : 'ies are'} missing or outdated in OpenClaw config`] : []),
      ...(mcp.staleEntries.length > 0 ? [`${mcp.staleEntries.length} stale Bakin MCP entr${mcp.staleEntries.length === 1 ? 'y' : 'ies'} in OpenClaw config`] : []),
    ]

    if (issues.length === 0) {
      return {
        name: 'openclaw-integration',
        status: 'ok',
        message: 'OpenClaw has the Bakin skill and native Bakin MCP entries',
        details: { port, mcpServers: mcp.agentEntries.map((entry) => entry.name) },
      }
    }

    return {
      name: 'openclaw-integration',
      status: 'broken',
      message: issues.join('; '),
      remediation: 'Run `bakin onboard` to install the Bakin runtime skill and sync OpenClaw MCP server entries.',
      details: { port, issues },
    }
  } catch (err) {
    return {
      name: 'openclaw-integration',
      status: 'broken',
      message: `OpenClaw integration check failed: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Fix OpenClaw config, then rerun `bakin onboard`.',
      details: { port },
    }
  }
}

async function install(): Promise<InstallResult> {
  const start = Date.now()
  const port = getPort()
  try {
    const runtime = await getRuntimeForOnboarding()
    const [skillResult, mcpChanges] = await Promise.all([
      syncBakinRuntimeSkill(projectRoot(), runtime),
      syncOpenClawMcpConfig(port),
    ])
    const changed = [
      ...(skillResult === 'noop' ? [] : [`Bakin skill ${skillResult}`]),
      ...mcpChanges,
    ]
    const message = changed.length > 0
      ? `OpenClaw integration synced (${changed.length} change${changed.length === 1 ? '' : 's'})`
      : 'OpenClaw integration already up to date.'

    log.info('OpenClaw integration ready', { skillResult, mcpChanges, port })
    return {
      name: 'openclaw-integration',
      status: changed.length > 0 ? 'installed' : 'noop',
      message,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    log.error('Failed to sync OpenClaw integration', err)
    return {
      name: 'openclaw-integration',
      status: 'failed',
      message: `OpenClaw integration sync failed: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
      durationMs: Date.now() - start,
    }
  }
}

export const openClawIntegrationComponent: OnboardingComponent = {
  name: 'openclaw-integration',
  check,
  install,
}

export const _internals = { getPort, projectRoot }
