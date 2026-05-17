/**
 * System check — mcporter installation + per-agent config entries.
 *
 * Migrated out of src/core/doctor.ts (#139 C6). Auto-fixable — safe
 * because it only installs a CLI tool and writes config.
 */
import * as mcporter from '../../../../src/core/mcporter'
import type { HealthCheckResult, HealthRepairHandler } from '../../../../packages/core/src/plugin-types'

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

export async function checkMcporter(): Promise<HealthCheckResult[]> {
  return checkMcporterInternal(false)
}

async function checkMcporterInternal(autoFix: boolean): Promise<HealthCheckResult[]> {
  const port = Number(process.env.PORT || 3737)
  const results: HealthCheckResult[] = []

  if (!mcporter.isMcporterInstalled()) {
    if (!autoFix) {
      return [warn('mcporter not installed — run: bakin install mcporter', true)]
    }
    if (!mcporter.installMcporter()) {
      return [error('Failed to install mcporter — run: npm i -g mcporter')]
    }
    results.push(fixed('Installed mcporter globally'))
  }

  const status = await mcporter.verifyConfig(port)

  const missing = status.agentEntries.filter(e => !e.correct)
  if (missing.length > 0) {
    if (!autoFix) {
      return [
        ...results,
        warn(`${missing.length} agent(s) missing or outdated in mcporter config — run: bakin install mcporter`, true),
      ]
    }
    const changes = await mcporter.syncConfig(port)
    results.push(fixed(`Config updated: ${changes.join(', ')}`))
  } else {
    results.push(ok(`All ${status.agentEntries.length} agent entries configured`))
  }

  if (status.staleEntries.length > 0 && autoFix) {
    await mcporter.syncConfig(port) // syncConfig already removes stale
  }

  return results
}

export function mcporterRepair(): HealthRepairHandler {
  return {
    async plan(rows) {
      const matching = rows.filter(row => row.check === 'mcporter' && row.autoFixable)
      if (matching.length === 0) return []
      return [{
        id: 'health.repair-mcporter',
        checkId: 'mcporter',
        title: 'Repair mcporter install/config',
        reason: matching.map(row => row.message).join('; '),
        safety: 'safe',
        requiresConfirmation: true,
        changes: [{
          kind: 'service',
          target: 'mcporter',
          action: 'install',
          description: 'Install mcporter if missing and synchronize Bakin agent server entries.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const rows = await checkMcporterInternal(true)
      const failures = rows.filter(row => row.status === 'error')
      return [{
        id: 'health.repair-mcporter',
        checkId: 'mcporter',
        status: failures.length > 0 ? 'failed' : 'applied',
        message: rows.map(row => row.message).join('; '),
        changes: rows
          .filter(row => row.status === 'fixed')
          .map(row => ({
            kind: 'service' as const,
            target: 'mcporter',
            action: 'install' as const,
            description: row.message,
          })),
      }]
    },
  }
}
