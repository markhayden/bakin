/**
 * `bakin status` / `bakin dispatch` — runtime status + manual dispatch trigger.
 * Relocated verbatim from cli/bakin.ts (B5.3 command-module split).
 *
 * printRuntimeActionTui is exported: the lifecycle and agents command modules
 * reuse the same RuntimeActionReport wrapper.
 */
import { apiGet, apiPost, getCliRoster, type CliRoster } from '../http'
import { print } from '../output'
import { renderInkReport } from '../../core/cli/ui/render-report'
import type { RuntimeActionData } from '../../core/cli/ui/readonly'

async function printStatusTui(dispatch: Record<string, unknown>, roster: CliRoster): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.StatusReport, { dispatch, roster })
}

export async function printRuntimeActionTui(action: RuntimeActionData): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.RuntimeActionReport, { action })
}

async function cmdStatus(): Promise<void> {
  const dispatch = await apiGet('/api/dispatch') as Record<string, unknown>
  const roster = await getCliRoster()

  if (process.stdout.isTTY) {
    await printStatusTui(dispatch, roster)
    return
  }

  console.log('=== Bakin Status ===')
  console.log(`Dispatch interval: ${dispatch.intervalMin}min`)
  console.log(`Last run: ${dispatch.lastRun || 'never'}`)
  console.log(`Next run: ${dispatch.nextRun} (${dispatch.secondsUntilNext}s)`)
  console.log(`Tasks dispatched: ${dispatch.dispatchedCount}`)
  console.log(`Agents: ${roster.agentIds.join(', ')}`)
}

async function cmdDispatch(): Promise<void> {
  const result = await apiPost('/api/dispatch')
  if (process.stdout.isTTY) {
    await printRuntimeActionTui({
      action: 'dispatch',
      target: 'task dispatcher',
      result,
    })
    return
  }
  print(result)
}

export async function run(args: string[]): Promise<void> {
  if (args[0] === 'status') await cmdStatus()
  else await cmdDispatch()
}
