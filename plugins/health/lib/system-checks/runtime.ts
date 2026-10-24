/**
 * System check — runtime adapter reachability — and its first repair
 * (self-healing PR1 slice 1.3c, re-homing row 12): `runtime-restart` asks the
 * adapter to restart what it owns (`restart()` — the OpenClaw gateway, Pi's
 * cached registries) and verifies with a ping. A runtime that stays dark is
 * reported as such; the diagnostician lane takes it from there (PR5).
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { healthError, healthHealthy, healthObserved } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthRepairActionDefinition } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'

export const RUNTIME_RESTART_ACTION = 'runtime-restart'
const CHECK_ID = 'health.runtime'

export async function checkRuntime(runtime: Pick<AgentRuntimeAdapter, 'ping'>): Promise<HealthCheckRunInput> {
  try {
    const alive = await runtime.ping()
    if (alive) {
      return healthObserved([healthHealthy({
        key: 'reachability',
        summary: 'Runtime can serve turns.',
        evidence: { reachable: true },
      })])
    }
    return healthObserved([runtimeUnavailable('The runtime health probe returned false.')])
  } catch (err) {
    return healthObserved([runtimeUnavailable(
      err instanceof Error ? err.message : String(err),
    )])
  }
}

function runtimeUnavailable(detail: string) {
  return healthError({
    key: 'reachability',
    summary: 'Runtime cannot serve turns.',
    detail,
    evidence: { reachable: false },
    incident: {
      key: 'unreachable',
      title: 'Runtime is unreachable',
      impact: 'Agents cannot start or continue turns while the runtime is unavailable.',
      disposition: 'action_required',
      resources: [{ kind: 'runtime', id: 'active', label: 'Active runtime' }],
      resolution: { key: RUNTIME_RESTART_ACTION, type: 'repair', label: 'Restart the runtime', actionId: RUNTIME_RESTART_ACTION },
    },
  })
}

export interface RuntimeRestartOptions {
  /** How often to ping after the restart (default 1 s). */
  pollMs?: number
  /** How long to wait for the first successful ping (default 30 s). */
  timeoutMs?: number
}

export function runtimeRestartRepair(runtime: Pick<AgentRuntimeAdapter, 'restart' | 'ping'>, opts: RuntimeRestartOptions = {}): HealthRepairActionDefinition {
  const pollMs = opts.pollMs ?? 1_000
  const timeoutMs = opts.timeoutMs ?? 30_000
  return {
    id: RUNTIME_RESTART_ACTION,
    name: 'Restart the runtime',
    operationPlan: () => ({
      stages: [
        { id: 'restart', kind: 'installing', label: 'Restart the runtime' },
        { id: 'verify', kind: 'verifying', label: 'Wait for it to answer' },
      ],
      pointOfNoReturn: 'restart',
    }),
    async plan(target) {
      return [{
        id: RUNTIME_RESTART_ACTION,
        actionId: RUNTIME_RESTART_ACTION,
        title: 'Restart the runtime',
        reason: 'The runtime did not answer its health probe, so no agent can take a turn.',
        safety: 'safe',
        ...repairTargetSelection(target),
        changes: [{ kind: 'runtime', target: 'active runtime', action: 'update', description: 'Ask the runtime adapter to restart what it owns (the gateway, cached registries), then probe it until it answers.' }],
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      const result = (status: 'applied' | 'failed', message: string) => items.map((item) => ({ itemId: item.id, actionId: item.actionId, status, message, affectedCheckIds: [CHECK_ID], changes: item.changes }))
      op.stage('restart')
      try {
        await runtime.restart()
      } catch (err) {
        return result('failed', `The runtime refused to restart: ${err instanceof Error ? err.message : String(err)}`)
      }
      op.stage('verify')
      const deadline = Date.now() + timeoutMs
      let lastError: string | null = null
      for (;;) {
        op.throwIfCancelled()
        try {
          if (await runtime.ping()) return result('applied', 'The runtime restarted and answers its health probe again.')
          lastError = null
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
        }
        if (Date.now() >= deadline) break
        await new Promise((resolve) => setTimeout(resolve, pollMs))
      }
      return result('failed', `The runtime restarted but still cannot serve turns after ${Math.round(timeoutMs / 1000)}s${lastError ? ` (${lastError})` : ''}. It needs diagnosis.`)
    },
  }
}
