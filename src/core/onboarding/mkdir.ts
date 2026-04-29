/**
 * mkdir component — ensures the ~/.bakin/ directory tree exists.
 *
 * Thin wrapper around `initBakinHome()` from content-dir. Idempotent:
 * re-running against an already-seeded tree is a no-op that returns `ok`.
 */
import { existsSync } from 'fs'
import { createLogger } from '../logger'
import { getBakinPaths, initBakinHome, getContentDir } from '../content-dir'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

const log = createLogger('onboarding:mkdir')

/**
 * Key subdirectories we require present for mkdir to report `ok`. Missing
 * any one of these means the tree has not been seeded (or was partially
 * wiped) and `install()` should rerun `initBakinHome()`.
 */
function requiredDirs(): string[] {
  const paths = getBakinPaths()
  return [
    paths.home,
    paths.assets,
    paths['assets.store'],
    paths['assets.inbox'],
    paths.agents,
    paths.heartbeats,
    paths.workflows,
    paths.team,
  ]
}

async function check(): Promise<CheckResult> {
  const dirs = requiredDirs()
  const missing = dirs.filter((d) => !existsSync(d))
  if (missing.length === 0) {
    return {
      name: 'mkdir',
      status: 'ok',
      message: `Bakin home directory is initialized at ${getContentDir()}`,
    }
  }
  return {
    name: 'mkdir',
    status: 'missing',
    message: `${missing.length} required director${missing.length === 1 ? 'y' : 'ies'} missing under ${getContentDir()}`,
    remediation: 'Run `bakin mkdir` to create the directory tree.',
    details: { missing },
  }
}

async function install(_opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()
  try {
    const result = initBakinHome(getContentDir())
    const durationMs = Date.now() - start
    if (result.created.length === 0 && result.seeded.length === 0) {
      return {
        name: 'mkdir',
        status: 'noop',
        message: `Already initialized at ${getContentDir()}`,
        durationMs,
      }
    }
    log.info('Bakin home initialized', { created: result.created.length, seeded: result.seeded.length })
    return {
      name: 'mkdir',
      status: 'installed',
      message: `Created ${result.created.length} path${result.created.length === 1 ? '' : 's'}, seeded ${result.seeded.length} file${result.seeded.length === 1 ? '' : 's'}`,
      durationMs,
    }
  } catch (err) {
    log.error('Failed to initialize Bakin home', err)
    return {
      name: 'mkdir',
      status: 'failed',
      message: `Failed to create directory tree: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
      durationMs: Date.now() - start,
    }
  }
}

export const mkdirComponent: OnboardingComponent = {
  name: 'mkdir',
  check,
  install,
}
