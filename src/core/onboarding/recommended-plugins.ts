import { existsSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../content-dir'
import { readPluginLockfile } from '@bakin/core/plugins/lockfile'
import { askYesNo } from './prompts'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

export interface RecommendedPlugin {
  id: string
  name: string
  source: string
  description: string
  defaultSelected: boolean
}

export const RECOMMENDED_PLUGINS = [
  {
    id: 'messaging',
    name: 'Messaging',
    source: 'github:madeinwyo/bakin-bits-official#plugins/messaging',
    description: 'Content planning, calendar items, brainstorming sessions, approvals, and channel delivery.',
    defaultSelected: true,
  },
  {
    id: 'projects',
    name: 'Projects',
    source: 'github:madeinwyo/bakin-bits-official#plugins/projects',
    description: 'Project specs, checklists, task links, assets, and project-context agent tools.',
    defaultSelected: true,
  },
] as const satisfies readonly RecommendedPlugin[]

function isInstalled(id: string): boolean {
  if (existsSync(join(getContentDir(), 'plugins', id, 'bakin-plugin.json'))) return true
  try {
    return Boolean(readPluginLockfile().plugins[id])
  } catch {
    return false
  }
}

function missingPlugins(): RecommendedPlugin[] {
  return RECOMMENDED_PLUGINS.filter(plugin => !isInstalled(plugin.id))
}

async function installSource(source: string): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  const { post } = await import('../../../packages/host/src/api/plugins/install')
  const type = source.startsWith('github:') || (source.includes('/') && !source.startsWith('.') && !source.startsWith('/'))
    ? 'github'
    : 'local'
  const preflight = await post(new Request('http://localhost/api/plugins/install', {
    method: 'POST',
    body: JSON.stringify({ source, type, accepted: false }),
  }), new URL('http://localhost/api/plugins/install'))
  const preflightBody = await preflight.json() as {
    ok?: boolean
    error?: string
    awaitingConsent?: boolean
    consentToken?: string
    id?: string
  }

  if (preflightBody.awaitingConsent) {
    const commit = await post(new Request('http://localhost/api/plugins/install', {
      method: 'POST',
      body: JSON.stringify({
        source,
        type,
        accepted: true,
        consentToken: preflightBody.consentToken,
      }),
    }), new URL('http://localhost/api/plugins/install'))
    const commitBody = await commit.json() as { ok?: boolean; error?: string; id?: string }
    return commitBody.ok
      ? { ok: true, id: commitBody.id }
      : { ok: false, error: commitBody.error ?? `install failed with HTTP ${commit.status}` }
  }

  return preflightBody.ok
    ? { ok: true, id: preflightBody.id }
    : { ok: false, error: preflightBody.error ?? `install failed with HTTP ${preflight.status}` }
}

async function check(): Promise<CheckResult> {
  const missing = missingPlugins()
  if (missing.length === 0) {
    return {
      name: 'recommended-plugins',
      status: 'ok',
      message: 'Recommended official plugins are installed',
    }
  }
  return {
    name: 'recommended-plugins',
    status: 'missing',
    message: `${missing.length} recommended official plugin${missing.length === 1 ? '' : 's'} not installed`,
    remediation: 'Install during onboarding or later with `bakin plugins install github:madeinwyo/bakin-bits-official#plugins/<id> --yes`.',
    details: { missing: missing.map(plugin => plugin.id) },
  }
}

async function install(opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()
  const missing = missingPlugins()
  if (missing.length === 0) {
    return {
      name: 'recommended-plugins',
      status: 'noop',
      message: 'Recommended official plugins are already installed',
      durationMs: Date.now() - start,
    }
  }

  const selected: RecommendedPlugin[] = []
  for (const plugin of missing) {
    if (opts.autoApprove) {
      selected.push(plugin)
      continue
    }
    if (!opts.interactive) continue
    if (await askYesNo(`Install official plugin ${plugin.name}?`, plugin.defaultSelected)) {
      selected.push(plugin)
    }
  }

  if (selected.length === 0) {
    return {
      name: 'recommended-plugins',
      status: 'skipped',
      message: 'No recommended official plugins selected',
      durationMs: Date.now() - start,
    }
  }

  const failures: string[] = []
  const installed: string[] = []
  for (const plugin of selected) {
    const result = await installSource(plugin.source)
    if (result.ok) installed.push(plugin.id)
    else failures.push(`${plugin.id}: ${result.error}`)
  }

  if (failures.length > 0) {
    return {
      name: 'recommended-plugins',
      status: 'failed',
      message: `Failed to install recommended plugin${failures.length === 1 ? '' : 's'}: ${failures.join('; ')}`,
      durationMs: Date.now() - start,
    }
  }

  return {
    name: 'recommended-plugins',
    status: 'installed',
    message: `Installed recommended official plugin${installed.length === 1 ? '' : 's'}: ${installed.join(', ')}`,
    durationMs: Date.now() - start,
  }
}

export const recommendedPluginsComponent: OnboardingComponent = {
  name: 'recommended-plugins',
  check,
  install,
}
