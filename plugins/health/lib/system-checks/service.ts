/**
 * System check — macOS LaunchAgent plist health.
 *
 * Migrated out of src/core/doctor.ts (#139 C6). Verifies the bakin
 * service plist exists, references the current project root + server.ts
 * path, and is loaded into launchd. macOS-only; gated on
 * settings.service.enabled. NOT auto-fixable — stale paths require
 * human judgment.
 */
import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import { getSettings } from '../../../../src/core/settings'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

const SERVICE_LABEL = 'com.bakin.mc'

function ok(message: string): HealthCheckResult {
  return { check: 'service', status: 'ok', message, autoFixable: false }
}
function warn(message: string): HealthCheckResult {
  return { check: 'service', status: 'warn', message, autoFixable: false }
}
function error(message: string): HealthCheckResult {
  return { check: 'service', status: 'error', message, autoFixable: false }
}

export function checkService(projectRoot: string): HealthCheckResult[] {
  const settings = getSettings()
  if (!settings.service.enabled) {
    return [ok('Skipped — service management disabled in settings')]
  }

  if (process.platform !== 'darwin') {
    return [ok('Skipped — macOS only')]
  }

  const results: HealthCheckResult[] = []
  const homedir = process.env.HOME || '~'
  const plistPath = join(homedir, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)

  if (!existsSync(plistPath)) {
    results.push(warn('LaunchAgent plist not found — run: bakin setup service'))
    return results
  }

  try {
    const plistContent = readFileSync(plistPath, 'utf-8')

    // Check WorkingDirectory matches current project
    const wdMatch = plistContent.match(/<key>WorkingDirectory<\/key>\s*<string>([^<]+)<\/string>/)
    if (wdMatch && wdMatch[1] !== projectRoot) {
      results.push(error(
        `LaunchAgent WorkingDirectory is "${wdMatch[1]}" but project is at "${projectRoot}" — run: bakin setup service`
      ))
    }

    // Check server.ts path matches
    const serverMatch = plistContent.match(/<string>([^<]*server\.ts)<\/string>/)
    if (serverMatch && serverMatch[1] !== join(projectRoot, 'server.ts')) {
      results.push(error('LaunchAgent references stale server.ts path — run: bakin setup service'))
    }
  } catch (err) {
    results.push(error(`Failed to read plist: ${err}`))
    return results
  }

  // Check service is loaded
  try {
    execSync(`launchctl list ${SERVICE_LABEL}`, { encoding: 'utf-8', stdio: 'pipe' })
  } catch {
    results.push(warn('LaunchAgent plist exists but service is not loaded — run: bakin setup service'))
  }

  if (results.length === 0) {
    results.push(ok('LaunchAgent installed and loaded with correct paths'))
  }

  return results
}
