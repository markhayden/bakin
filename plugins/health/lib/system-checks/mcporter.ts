/**
 * System check — mcporter installation + per-agent config entries.
 *
 * Migrated out of src/core/doctor.ts (#139 C6). Auto-fixable — safe
 * because it only installs a CLI tool and writes config.
 */
import * as mcporter from '../../../../src/core/mcporter'
import { getSettings } from '../../../../src/core/settings'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

function ok(message: string): HealthCheckResult {
  return { check: 'mcporter', status: 'ok', message, autoFixable: false }
}
function warn(message: string, autoFixable = false): HealthCheckResult {
  return { check: 'mcporter', status: 'warn', message, autoFixable }
}
function error(message: string): HealthCheckResult {
  return { check: 'mcporter', status: 'error', message, autoFixable: false }
}
function fixed(message: string): HealthCheckResult {
  return { check: 'mcporter', status: 'fixed', message, autoFixable: true }
}

export function checkMcporter(): HealthCheckResult[] {
  const port = Number(process.env.PORT || 3737)
  const autoFix = getSettings().doctor.autoFixSkill
  const results: HealthCheckResult[] = []

  if (!mcporter.isMcporterInstalled()) {
    if (!autoFix) {
      return [warn('mcporter not installed — run: bakin setup mcporter', true)]
    }
    if (!mcporter.installMcporter()) {
      return [error('Failed to install mcporter — run: npm i -g mcporter')]
    }
    results.push(fixed('Installed mcporter globally'))
  }

  const status = mcporter.verifyConfig(port)

  const missing = status.agentEntries.filter(e => !e.correct)
  if (missing.length > 0) {
    if (!autoFix) {
      return [
        ...results,
        warn(`${missing.length} agent(s) missing or outdated in mcporter config — run: bakin setup mcporter`, true),
      ]
    }
    const changes = mcporter.syncConfig(port)
    results.push(fixed(`Config updated: ${changes.join(', ')}`))
  } else {
    results.push(ok(`All ${status.agentEntries.length} agent entries configured`))
  }

  if (status.staleEntries.length > 0 && autoFix) {
    mcporter.syncConfig(port) // syncConfig already removes stale
  }

  return results
}
