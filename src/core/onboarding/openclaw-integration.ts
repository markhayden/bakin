import { createLogger } from '../logger'
import { createAppServices, maybeGetAppServices } from '../app-services'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { checkBakinRuntimeSkill, syncBakinRuntimeSkill } from '../bakin-skill'
import type { CheckResult, InstallResult, OnboardingComponent } from './types'

const log = createLogger('onboarding:openclaw-integration')

function projectRoot(): string {
  return process.cwd()
}

async function getRuntimeForOnboarding(): Promise<AgentRuntimeAdapter> {
  const existing = maybeGetAppServices()?.runtime
  if (existing) return existing
  return (await createAppServices()).runtime
}

async function check(): Promise<CheckResult> {
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
    // Tool-access provisioning is now adapter-owned; core reads the drift
    // through the runtime-neutral verifyToolAccess() contract, never the
    // provider's config shape.
    const [skill, toolAccess] = await Promise.all([
      checkBakinRuntimeSkill(projectRoot(), runtime),
      runtime.verifyToolAccess(),
    ])
    const issues = [
      ...(skill.upToDate ? [] : [skill.installed ? 'Bakin runtime skill is outdated' : 'Bakin runtime skill is missing']),
      ...toolAccess.issues,
    ]

    if (issues.length === 0) {
      return {
        name: 'openclaw-integration',
        status: 'ok',
        message: 'OpenClaw has the Bakin skill and native Bakin MCP entries',
        details: { ...toolAccess.details },
      }
    }

    return {
      name: 'openclaw-integration',
      status: 'broken',
      message: issues.join('; '),
      remediation: 'Run `bakin onboard` to install the Bakin runtime skill and sync OpenClaw MCP server entries.',
      details: { issues },
    }
  } catch (err) {
    return {
      name: 'openclaw-integration',
      status: 'broken',
      message: `OpenClaw integration check failed: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Fix OpenClaw config, then rerun `bakin onboard`.',
      details: {},
    }
  }
}

async function install(): Promise<InstallResult> {
  const start = Date.now()
  try {
    const runtime = await getRuntimeForOnboarding()
    // Detect drift before provisioning so we can report noop vs. changed.
    const before = await runtime.verifyToolAccess()
    const [skillResult] = await Promise.all([
      syncBakinRuntimeSkill(projectRoot(), runtime),
      runtime.provisionToolAccess(),
    ])
    const changed = [
      ...(skillResult === 'noop' ? [] : [`Bakin skill ${skillResult}`]),
      ...(before.ok ? [] : before.issues),
    ]
    const message = changed.length > 0
      ? `OpenClaw integration synced (${changed.length} change${changed.length === 1 ? '' : 's'})`
      : 'OpenClaw integration already up to date.'

    log.info('OpenClaw integration ready', { skillResult, toolAccessDrift: before.issues })
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
  supportedAdapters: ['openclaw'],
  name: 'openclaw-integration',
  check,
  install,
}

export const _internals = { projectRoot }
