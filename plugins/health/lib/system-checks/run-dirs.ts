/**
 * System check — per-run workspace disk usage (same-agent-concurrency D5).
 *
 * Evidence comes EXCLUSIVELY from the sweep's sidecar-summed aggregate
 * (`getRunWorkspaceStats`) — this check NEVER walks the run-workspaces tree:
 * at backlog steady-state a walk blows the 30s check timeout and blinds the
 * only alarm exactly when it matters. No sweep yet this boot = Unknown,
 * never healthy. The aggregate is blind to in-flight growth by design
 * (sizes stamp at settle / lazy-stamp) — stated in the detail line.
 */
import { getSettings } from '../../../../src/core/settings'
import { getRunWorkspaceStats, sweepRunWorkspaces } from '../../../../src/core/run-workspace'
import { getInFlightTurn } from '../../../../src/core/dispatch-registry'
import { getTask } from '../../../../src/core/task-store'
import { healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthRepairActionDefinition } from '@makinbakin/sdk'

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.ceil(n / 1024)} KB`
}

export async function checkRunDirs(): Promise<HealthCheckRunInput> {
  const stats = getRunWorkspaceStats()
  const budget = getSettings().dispatch.runDirMaxTotalGb * 1024 * 1024 * 1024

  if (!stats) {
    return healthObserved([healthUnknown({
      key: 'aggregate',
      summary: 'Run-workspace usage has not been measured yet this boot.',
      detail: 'The watchdog sweep maintains the sidecar-summed aggregate; it has not completed a pass since the server started.',
      incident: {
        key: 'no-sweep-yet',
        title: 'Run-workspace usage unknown',
        impact: 'Disk growth from per-run agent working directories is unmonitored until the first watchdog sweep completes — it runs on its own shortly after boot; Sweep now measures immediately.',
        // Boot-warming state: the watchdog's first pass resolves this on
        // its own within minutes — advisory keeps it out of the Fix first
        // banner that lit up after every restart (aggressiveness pass,
        // 2026-07-23; same treatment as the transcript-scan warm-up).
        disposition: 'advisory',
        class: 'cleanup_backlog',
        resources: [{ kind: 'system', id: 'run-workspaces', label: '~/.bakin/run-workspaces' }],
        resolution: { key: 'sweep', type: 'repair', actionId: 'sweep-run-dirs', label: 'Sweep now' },
      },
    })])
  }

  const overBudget = budget > 0 && stats.sizeBytes > budget
  const detail = `${stats.count} run dir(s), ${fmtBytes(stats.sizeBytes)} scratch (repo checkouts excluded — they follow their own time windows; in-flight growth stamps at settle). Last sweep removed ${stats.sweptLastTick} dir(s).`
  if (overBudget) {
    return healthObserved([healthWarning({
      key: 'aggregate',
      summary: `Run workspaces exceed the disk budget even after eviction: ${fmtBytes(stats.sizeBytes)} of ${fmtBytes(budget)}.`,
      detail,
      incident: {
        key: 'over-budget',
        title: 'Run-workspace disk budget exceeded',
        impact: 'Evictable dirs are already drained — live turns or salvage-window dirs hold the remainder, so another sweep will not free it. Raise the disk budget in Settings → System & Alerts, or wait for live turns to settle and salvage windows to expire. Disk pressure can cascade into the ledger and search databases on the same volume.',
        disposition: 'action_required',
        class: 'cleanup_backlog',
        resources: [{ kind: 'system', id: 'run-workspaces', label: '~/.bakin/run-workspaces' }],
        resolution: { key: 'sweep', type: 'repair', actionId: 'sweep-run-dirs', label: 'Sweep now' },
      },
    })])
  }
  return healthObserved([healthHealthy({ key: 'aggregate', summary: detail })])
}

/** Deterministic mutation: one bounded sweep pass, same engine as the tick. */
export function runDirsSweepRepair(): HealthRepairActionDefinition {
  return {
    id: 'sweep-run-dirs',
    name: 'Sweep run workspaces',
    async plan() {
      return [{
        id: 'sweep-run-dirs',
        actionId: 'sweep-run-dirs',
        title: 'Sweep expired run workspaces now',
        reason: 'Remove expired per-run scratch dirs and enforce the disk budget without waiting for the next watchdog tick.',
        safety: 'safe',
        incidentIds: [],
        observationIds: [],
        preconditions: [],
        changes: [{
          kind: 'file',
          target: '~/.bakin/run-workspaces',
          action: 'delete',
          description: 'Delete run dirs past their retention windows (bounded batch); live turns and salvage-window dirs are never touched.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      try {
        const settings = getSettings()
        const stats = await sweepRunWorkspaces({
          isTurnLive: (threadId) => getInFlightTurn(threadId) !== undefined,
          taskExists: (taskId) => Boolean(getTask(taskId)),
          retentionDays: settings.dispatch.runDirRetentionDays,
          maxTotalBytes: settings.dispatch.runDirMaxTotalGb * 1024 * 1024 * 1024,
          graceMs: settings.watchdog.intervalMs * 2,
        })
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'applied' as const,
          message: `Swept ${stats?.sweptLastTick ?? 0} dir(s); ${stats?.count ?? 0} remain (${fmtBytes(stats?.sizeBytes ?? 0)}).`,
          affectedCheckIds: ['health.dispatch.run-dirs'],
          changes: (stats?.sweptLastTick ?? 0) > 0 ? item.changes : [],
        }))
      } catch (error) {
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: error instanceof Error ? error.message : String(error),
          affectedCheckIds: ['health.dispatch.run-dirs'],
          changes: [],
        }))
      }
    },
  }
}
