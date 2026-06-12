/**
 * System check — runtime session-store growth (#435).
 *
 * OpenClaw's built-in maintenance (session.maintenance) prunes store
 * entries on writes, but unreferenced transcript/trajectory artifacts only
 * get GC'd by explicit cleanup runs or a configured disk budget. This check
 * is the early warning when accumulation outruns maintenance. Read-only:
 * remediation mutates runtime-owned data, so it is never auto-fixed.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

// First-guess thresholds, sized against observed reality on 2026-06-11
// (main at 321MB / 1,812 files / 74 entries — a 24x orphan ratio).
export const SESSION_STORE_WARN_BYTES = 500 * 1024 * 1024
export const SESSION_STORE_ERROR_BYTES = 1024 * 1024 * 1024
export const SESSION_STORE_ORPHAN_RATIO = 10
export const SESSION_STORE_ORPHAN_MIN_FILES = 100

const REMEDIATION =
  'Run `openclaw sessions cleanup --enforce` and consider setting `session.maintenance.maxDiskBytes` so the gateway self-maintains.'

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export async function checkSessionStore(
  runtime: Pick<AgentRuntimeAdapter, 'sessions'>,
): Promise<HealthCheckResult[]> {
  const check = 'session-store'
  if (!runtime.sessions.storeStats) {
    return [{ check, status: 'ok', message: 'Session-store stats not available for this runtime', autoFixable: false }]
  }

  let stats
  try {
    stats = await runtime.sessions.storeStats()
  } catch (err) {
    return [{ check, status: 'error', message: `Session-store stats failed: ${err}`, autoFixable: false }]
  }

  const results: HealthCheckResult[] = []
  for (const agent of stats) {
    const orphanRatio = agent.fileCount / Math.max(agent.storeEntries, 1)
    const detail = `${agent.agentId}: ${formatMb(agent.diskBytes)}, ${agent.fileCount} files, ${agent.storeEntries} store entries`
    if (agent.diskBytes > SESSION_STORE_ERROR_BYTES) {
      results.push({ check, status: 'error', message: `Session store oversized — ${detail}. ${REMEDIATION}`, autoFixable: false })
    } else if (agent.diskBytes > SESSION_STORE_WARN_BYTES) {
      results.push({ check, status: 'warn', message: `Session store growing — ${detail}. ${REMEDIATION}`, autoFixable: false })
    } else if (agent.fileCount >= SESSION_STORE_ORPHAN_MIN_FILES && orphanRatio > SESSION_STORE_ORPHAN_RATIO) {
      results.push({
        check,
        status: 'warn',
        message: `Orphaned session artifacts accumulating — ${detail} (${orphanRatio.toFixed(0)}x files per entry). ${REMEDIATION}`,
        autoFixable: false,
      })
    }
  }

  if (results.length === 0) {
    const totalBytes = stats.reduce((sum, s) => sum + s.diskBytes, 0)
    return [{
      check,
      status: 'ok',
      message: `Session stores healthy across ${stats.length} agents (${formatMb(totalBytes)} total)`,
      autoFixable: false,
    }]
  }
  return results
}
