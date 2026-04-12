/**
 * settings component — ensures ~/.bakin/settings.json exists and parses.
 *
 * `initBakinHome()` already drops an empty `{}` settings.json during mkdir,
 * but this component exists as a standalone check because (a) a user could
 * have deleted or corrupted the file after mkdir, and (b) the orchestrator's
 * dependency graph needs a discrete "settings is usable" gate before any
 * later component reads `getSettings()`.
 *
 * install() writes a well-formed (empty override) file via `updateSettings({})`,
 * which forces a full defaults merge on the next `getSettings()` call.
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { createLogger } from '../logger'
import { getBakinPaths } from '../content-dir'
import { resetSettingsCache, updateSettings } from '../settings'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

const log = createLogger('onboarding:settings')

function settingsPath(): string {
  return getBakinPaths().settings
}

async function check(): Promise<CheckResult> {
  const path = settingsPath()
  if (!existsSync(path)) {
    return {
      name: 'settings',
      status: 'missing',
      message: `settings.json not found at ${path}`,
      remediation: 'Run `bakin settings init` to seed the file with defaults.',
    }
  }

  // Zero-byte file counts as missing — deep-merge against `{}` at load time
  // would still "work," but a user who sees an empty file will (rightly)
  // think something is wrong. Force a re-seed.
  try {
    const size = statSync(path).size
    if (size === 0) {
      return {
        name: 'settings',
        status: 'broken',
        message: `settings.json at ${path} is empty`,
        remediation: 'Run `bakin settings init` to rewrite the file.',
      }
    }
  } catch (err) {
    return {
      name: 'settings',
      status: 'broken',
      message: `Failed to stat settings.json: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Run `bakin settings init` to rewrite the file.',
    }
  }

  // Must parse as JSON — a malformed file would cause every later getSettings()
  // call to silently fall back to defaults, which is confusing.
  try {
    JSON.parse(readFileSync(path, 'utf-8'))
    return {
      name: 'settings',
      status: 'ok',
      message: `settings.json is present and parses at ${path}`,
    }
  } catch (err) {
    return {
      name: 'settings',
      status: 'broken',
      message: `settings.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Fix the file manually or run `bakin settings init` to reseed (will overwrite).',
    }
  }
}

async function install(_opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()
  try {
    // updateSettings({}) writes the current override file (or seeds `{}`
    // if missing), invalidates the cache, and returns a fully merged
    // BakinSettings. It is the canonical way to ensure the file exists
    // in a state the rest of the system can read.
    resetSettingsCache()
    updateSettings({})
    log.info('Settings file initialized', { path: settingsPath() })
    return {
      name: 'settings',
      status: 'installed',
      message: `Wrote ${settingsPath()}`,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    log.error('Failed to initialize settings file', err)
    return {
      name: 'settings',
      status: 'failed',
      message: `Failed to write settings.json: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
      durationMs: Date.now() - start,
    }
  }
}

export const settingsComponent: OnboardingComponent = {
  name: 'settings',
  check,
  install,
}
