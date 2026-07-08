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

// ─── bakin runtime {…} — adapter management (P3.2) ─────────────────────────

interface CapabilityReportPayload {
  adapter: string
  adapters: string[]
  runtime: { name: string; version: string }
  capabilities: Record<string, unknown>
  toolAccess: { style: string; ok: boolean; issues: string[] }
}

function printCapabilityReport(report: CapabilityReportPayload): void {
  console.log(`Active runtime: ${report.adapter}${report.runtime.version ? ` (${report.runtime.name}@${report.runtime.version})` : ''}`)
  if (report.adapters.length > 0) console.log(`Available:      ${report.adapters.join(', ')}`)
  console.log('Capabilities:')
  const access = (report.capabilities.toolCalling as { access?: { style?: string } } | undefined)?.access
  console.log(`  ${'toolCalling'.padEnd(16)} native (${access?.style ?? 'unknown'})`)
  for (const [name, value] of Object.entries(report.capabilities)) {
    if (name === 'input' || name === 'toolCalling') continue
    const mode = (value as { mode?: string })?.mode ?? String(value)
    console.log(`  ${name.padEnd(16)} ${mode}`)
  }
  console.log(`Tool access:    ${report.toolAccess.ok ? 'ok' : `ISSUES — ${report.toolAccess.issues.join('; ')}`}`)
}

async function cmdRuntimeCapabilities(): Promise<void> {
  const report = await apiGet('/api/runtime/capabilities') as unknown as CapabilityReportPayload
  printCapabilityReport(report)
}

async function cmdRuntimeUse(target: string | undefined): Promise<void> {
  if (!target) {
    console.error('Usage: bakin runtime use <adapter>')
    process.exit(1)
  }
  console.log(`Switching runtime to '${target}'…`)
  const result = await apiPost('/api/runtime/switch', { target }) as Record<string, unknown>

  if (!result.ok) {
    console.error(`Switch failed: ${result.error}`)
    if (result.restored !== undefined) {
      console.error(result.restored
        ? `Previous runtime (${result.from}) was restored.`
        : `RESTORE FAILED — check settings.json against the backup: ${result.backupPath}`)
    }
    process.exit(1)
  }

  const roster = result.roster as { carried: unknown[]; existing: string[]; unmappedModels: Array<{ agentId: string; sourceModel: string }>; failed: unknown[] } | null
  console.log(`Switched ${result.from} → ${result.to}`)
  if (result.backupPath) console.log(`Settings backup: ${result.backupPath}`)
  if (roster) {
    console.log(`Roster: carried ${roster.carried.length}, existing ${roster.existing.length}, failed ${roster.failed.length}`)
    for (const unmapped of roster.unmappedModels) {
      console.log(`  ⚠ ${unmapped.agentId}: model '${unmapped.sourceModel}' has no equivalent on ${result.to} — falls back to the routing default`)
    }
  }
  const sync = result.sync as { drifted: boolean; syncedAgents: number } | null
  if (sync) console.log(sync.drifted ? `Agents re-projected: ${sync.syncedAgents}` : 'Agent projections already current')
  printCapabilityReport({
    adapter: String(result.to),
    adapters: [],
    runtime: { name: String(result.to), version: '' },
    capabilities: (result.capabilities ?? {}) as CapabilityReportPayload['capabilities'],
    toolAccess: result.toolAccess as CapabilityReportPayload['toolAccess'],
  })
  console.log('')
  console.log('⚠ Restart required: run `bakin restart` so plugins rebind to the new runtime.')
}

export async function run(args: string[]): Promise<void> {
  if (args[0] === 'runtime') {
    if (args[1] === 'use') await cmdRuntimeUse(args[2])
    else await cmdRuntimeCapabilities()
    return
  }
  if (args[0] === 'status') await cmdStatus()
  else await cmdDispatch()
}
