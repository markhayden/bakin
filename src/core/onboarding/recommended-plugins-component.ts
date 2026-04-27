/**
 * `recommended-plugins` onboarding component (Phase 6).
 *
 * Surfaces the curated list (`recommended-plugins.ts`) as the final
 * step of `bakin onboard`. Three modes mirror the rest of the
 * onboarding components:
 *
 *   - check()      → returns 'ok' if every recommended plugin is
 *                    already in the lockfile (or the list is empty);
 *                    'missing' otherwise.
 *   - install()    → in interactive mode, renders the Ink prompt and
 *                    shells out to `bakin plugins install` for each
 *                    selected id. In autoApprove (--yes) or non-
 *                    interactive (--json) mode, installs every entry
 *                    that has `defaultSelected: true` without
 *                    prompting.
 *
 * Failures during one plugin's install do NOT abort the rest — the
 * component reports a partial-success outcome with details.
 */
import { execFileSync } from 'child_process'
import { readPluginLockfile } from '../../../packages/core/src/plugins/lockfile'
import { RECOMMENDED_PLUGINS } from './recommended-plugins'
import { promptRecommendedPlugins } from './recommended-plugins-prompt'
import type {
  CheckResult,
  InstallResult,
  OnboardingComponent,
  OnboardingOptions,
} from './types'

const COMPONENT_NAME = 'recommended-plugins'

function alreadyInstalled(): Set<string> {
  try {
    const lock = readPluginLockfile()
    return new Set(Object.keys(lock.plugins))
  } catch {
    // Missing/corrupt lockfile → treat as "nothing installed."
    // The install flow will still surface its own errors loudly.
    return new Set()
  }
}

function missingFromLockfile(): typeof RECOMMENDED_PLUGINS {
  const installed = alreadyInstalled()
  return RECOMMENDED_PLUGINS.filter((p) => !installed.has(p.id))
}

async function check(): Promise<CheckResult> {
  if (RECOMMENDED_PLUGINS.length === 0) {
    return {
      name: COMPONENT_NAME,
      status: 'ok',
      message: 'No recommended plugins curated yet.',
    }
  }
  const missing = missingFromLockfile()
  if (missing.length === 0) {
    return {
      name: COMPONENT_NAME,
      status: 'ok',
      message: `All ${RECOMMENDED_PLUGINS.length} recommended plugin(s) already installed.`,
    }
  }
  return {
    name: COMPONENT_NAME,
    status: 'missing',
    message: `${missing.length} recommended plugin(s) not yet installed.`,
    details: { missing: missing.map((p) => p.id) },
    remediation: 'Run `bakin onboard` interactively to pick which to install, or `bakin plugins install <source>` per plugin.',
  }
}

interface PerPluginOutcome {
  id: string
  ok: boolean
  message: string
}

/**
 * Drive `bakin plugins install --yes` for one plugin id. Returns a
 * structured outcome rather than throwing so the caller can aggregate
 * partial-success.
 *
 * Uses execFileSync against the running binary's `bakin` CLI on PATH.
 * This is the same path `bakin onboard` already uses for other
 * components; mocking it in tests is straightforward.
 */
function installOne(id: string, source: string): PerPluginOutcome {
  try {
    execFileSync('bakin', ['plugins', 'install', source, '--yes'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    })
    return { id, ok: true, message: `installed ${id}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { id, ok: false, message }
  }
}

async function install(opts: OnboardingOptions): Promise<InstallResult> {
  const startedAt = Date.now()
  if (RECOMMENDED_PLUGINS.length === 0) {
    return {
      name: COMPONENT_NAME,
      status: 'noop',
      message: 'no recommended plugins curated',
      durationMs: Date.now() - startedAt,
    }
  }

  const candidates = missingFromLockfile()
  if (candidates.length === 0) {
    return {
      name: COMPONENT_NAME,
      status: 'noop',
      message: 'all recommended plugins already installed',
      durationMs: Date.now() - startedAt,
    }
  }

  // Decide selection without rendering the prompt for non-interactive
  // runs. autoApprove + json both bypass UI; respect defaultSelected
  // as the implicit answer.
  let selectedIds: string[]
  if (opts.interactive && !opts.autoApprove && !opts.json) {
    selectedIds = await promptRecommendedPlugins(candidates)
  } else {
    selectedIds = candidates.filter((p) => p.defaultSelected).map((p) => p.id)
  }

  if (selectedIds.length === 0) {
    return {
      name: COMPONENT_NAME,
      status: 'skipped',
      message: opts.interactive ? 'user declined every recommendation' : 'no defaults selected for this mode',
      durationMs: Date.now() - startedAt,
    }
  }

  const sourcesById = new Map(candidates.map((p) => [p.id, p.source]))
  const results: PerPluginOutcome[] = []
  for (const id of selectedIds) {
    const source = sourcesById.get(id)
    if (!source) {
      results.push({ id, ok: false, message: 'no source resolved' })
      continue
    }
    results.push(installOne(id, source))
  }

  const failed = results.filter((r) => !r.ok)
  if (failed.length === 0) {
    return {
      name: COMPONENT_NAME,
      status: 'installed',
      message: `installed ${results.length} plugin(s): ${results.map((r) => r.id).join(', ')}`,
      durationMs: Date.now() - startedAt,
    }
  }
  if (failed.length === results.length) {
    return {
      name: COMPONENT_NAME,
      status: 'failed',
      message: `every install failed: ${failed.map((f) => `${f.id} (${f.message})`).join('; ')}`,
      error: failed,
      durationMs: Date.now() - startedAt,
    }
  }
  // Partial success.
  const ok = results.filter((r) => r.ok).map((r) => r.id)
  return {
    name: COMPONENT_NAME,
    status: 'installed',
    message: `installed ${ok.length}/${results.length} (failed: ${failed.map((f) => f.id).join(', ')})`,
    error: failed,
    durationMs: Date.now() - startedAt,
  }
}

export const recommendedPluginsComponent: OnboardingComponent = {
  name: COMPONENT_NAME,
  check,
  install,
}
