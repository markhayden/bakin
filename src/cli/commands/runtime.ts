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
  /** Null when the run never verified tool access (dry-run preview). */
  toolAccess: { style: string; ok: boolean; issues: string[] } | null
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
  console.log(`Tool access:    ${report.toolAccess === null ? 'not verified (dry run)' : report.toolAccess.ok ? 'ok' : `ISSUES — ${report.toolAccess.issues.join('; ')}`}`)
}

async function cmdRuntimeCapabilities(): Promise<void> {
  const report = await apiGet('/api/runtime/capabilities') as unknown as CapabilityReportPayload
  printCapabilityReport(report)
}

interface RuntimeUseFlags {
  dryRun: boolean
  copyWorkspaces: boolean
  adoptCron: boolean
}

async function cmdRuntimeUse(target: string | undefined, flags: RuntimeUseFlags): Promise<void> {
  if (!target) {
    console.error('Usage: bakin runtime use <adapter> [--dry-run] [--no-copy-workspaces] [--adopt-cron]')
    process.exit(1)
  }
  console.log(flags.dryRun
    ? `Dry run — previewing a switch to '${target}' (nothing will be changed)…`
    : `Switching runtime to '${target}'…`)
  const result = await apiPost('/api/runtime/switch', {
    target,
    ...(flags.dryRun ? { dryRun: true } : {}),
    ...(flags.copyWorkspaces ? {} : { copyWorkspaces: false }),
    ...(flags.adoptCron ? { adoptCron: true } : {}),
  }) as Record<string, unknown>

  if (!result.ok) {
    console.error(`${flags.dryRun ? 'Dry run' : 'Switch'} failed: ${result.error}`)
    if (result.restored !== undefined) {
      console.error(result.restored
        ? `Previous runtime (${result.from}) was restored.`
        : `RESTORE FAILED — check settings.json against the backup: ${result.backupPath}`)
    }
    process.exit(1)
  }

  const would = flags.dryRun ? 'Would carry' : 'Carried'
  const roster = result.roster as { carried: unknown[]; existing: string[]; unmappedModels: Array<{ agentId: string; sourceModel: string; field?: string }>; preserved?: Array<{ agentId: string; sourceModel: string }>; failed: Array<{ agentId: string; error: string }> } | null
  console.log(flags.dryRun ? `Would switch ${result.from} → ${result.to}` : `Switched ${result.from} → ${result.to}`)
  if (result.backupPath) console.log(`Settings backup: ${result.backupPath}`)
  if (roster) {
    console.log(`Roster: ${would.toLowerCase()} ${roster.carried.length}, existing ${roster.existing.length}, failed ${roster.failed.length}`)
    for (const unmapped of roster.unmappedModels) {
      const what = unmapped.field === 'subagentModel' ? 'subagent model' : 'model'
      console.log(`  ⚠ ${unmapped.agentId}: ${what} '${unmapped.sourceModel}' has no equivalent on ${result.to} — falls back to the routing default`)
    }
    for (const kept of roster.preserved ?? []) {
      console.log(`  ○ ${kept.agentId}: subagent model '${kept.sourceModel}' preserved (not active on ${result.to}) — restored on switch back`)
    }
  }
  const cron = result.cron as { adopted: string[]; skipped: string[]; failed: Array<{ jobId: string; error: string }> } | null
  if (cron) {
    console.log(`Cron: ${flags.dryRun ? 'would adopt' : 'adopted'} ${cron.adopted.length}, already Bakin ${cron.skipped.length}, failed ${cron.failed.length}`)
    for (const failure of cron.failed) {
      console.log(`  ✗ ${failure.jobId}: ${failure.error}`)
    }
  }
  if (roster) {
    for (const failure of roster.failed) {
      console.log(`  ✗ ${failure.agentId}: ${failure.error}`)
    }
  }

  const workspaces = result.workspaces as {
    carried: Array<{ agentId: string; files: number; bytes: number }>
    skills: Array<{ agentId: string; carried: number; skippedPackageManaged: number }>
    skippedExisting: string[]
    failed: Array<{ agentId: string; path: string; error: string }>
  } | null
  if (workspaces) {
    const files = workspaces.carried.reduce((sum, c) => sum + c.files, 0)
    const skills = workspaces.skills.reduce((sum, s) => sum + s.carried, 0)
    console.log(`Workspace content: ${would.toLowerCase()} ${files} file(s) + ${skills} skill(s) across ${workspaces.carried.length} agent(s)`)
    if (workspaces.skippedExisting.length > 0) {
      console.log(`  existing on target (workspaces untouched): ${workspaces.skippedExisting.join(', ')}`)
    }
    for (const failure of workspaces.failed) {
      console.log(`  ✗ ${failure.agentId} ${failure.path}: ${failure.error}`)
    }
  }

  const cantCarry = result.cantCarry as Array<{ concern: string; detail: string; count?: number }> | null
  if (cantCarry && cantCarry.length > 0) {
    console.log('Stays behind:')
    for (const line of cantCarry) {
      console.log(`  ✗ ${line.concern}${line.count !== undefined ? ` (${line.count})` : ''}: ${line.detail}`)
    }
  }

  const credentials = result.credentials as { llmProviders: string[] } | null
  if (credentials) {
    if (credentials.llmProviders.length === 0) {
      console.log(`⚠ '${result.to}' has NO provider credentials — agents cannot dispatch until you configure auth on the target runtime.`)
    } else {
      console.log(`Target credentials: ${credentials.llmProviders.join(', ')}`)
    }
  }

  const sync = result.sync as { drifted: boolean; syncedAgents: number } | null
  if (sync) console.log(sync.drifted ? `Agents re-projected: ${sync.syncedAgents}` : 'Agent projections already current')
  printCapabilityReport({
    adapter: String(result.to),
    adapters: [],
    runtime: { name: String(result.to), version: '' },
    capabilities: (result.capabilities ?? {}) as CapabilityReportPayload['capabilities'],
    toolAccess: (result.toolAccess ?? null) as CapabilityReportPayload['toolAccess'],
  })
  if (flags.dryRun) {
    console.log('')
    console.log('Dry run — nothing was changed. Run without --dry-run to switch.')
  } else {
    console.log('')
    console.log('⚠ Restart required: run `bakin restart` so plugins rebind to the new runtime.')
  }
}

interface ExtensionsReport {
  supported: boolean
  mode: string
  extensions: Array<{ id: string; label: string; source: string; path: string; status: string }>
}

/** `bakin runtime extensions [list|allow <id>|revoke <id>]` — trust lane (WS4). */
async function cmdRuntimeExtensions(sub: string | undefined, id: string | undefined): Promise<void> {
  if (sub === 'allow' || sub === 'revoke') {
    if (!id) {
      console.error(`Usage: bakin runtime extensions ${sub} <id>`)
      process.exit(1)
    }
    const report = await apiPost(`/api/runtime/extensions/${sub}`, { id }) as ExtensionsReport
    console.log(`${sub === 'allow' ? 'Allowed' : 'Revoked'} "${id}".`)
    printExtensions(report)
    return
  }
  if (sub !== undefined && sub !== 'list') {
    console.error(`Unknown subcommand: runtime extensions ${sub}. Supported: list, allow <id>, revoke <id>`)
    process.exit(1)
  }
  printExtensions(await apiGet('/api/runtime/extensions') as ExtensionsReport)
}

function printExtensions(report: ExtensionsReport): void {
  if (!report.supported) {
    console.log('The active runtime has no extension mechanism.')
    return
  }
  console.log(`Extension policy: ${report.mode}`)
  if (report.extensions.length === 0) {
    console.log('No extensions discovered. Install with `pi install npm:<pkg>` (they stay inert until allowed here).')
    return
  }
  for (const ext of report.extensions) {
    console.log(`  ${ext.status === 'allowed' ? '✓' : ext.status === 'blocked' ? '✗' : '…'} ${ext.id.padEnd(32)} ${ext.status.padEnd(8)} ${ext.source}`)
  }
  if (report.extensions.some((e) => e.status === 'pending')) {
    console.log('Pending extensions do NOT load into agent turns. Approve with `bakin runtime extensions allow <id>` —')
    console.log('an allowed extension is trusted code running in the Bakin server process, and any API keys it uses spend outside Bakin budget caps.')
  }
}

export async function run(args: string[]): Promise<void> {
  if (args[0] === 'runtime') {
    if (args[1] === 'use') {
      const rest = args.slice(2)
      // Fail CLOSED on unknown flags: `--dryrun` silently ignored would run
      // a REAL switch where the user intended a preview.
      const KNOWN_FLAGS = ['--dry-run', '--no-copy-workspaces', '--adopt-cron']
      const unknown = rest.filter((arg) => arg.startsWith('--') && !KNOWN_FLAGS.includes(arg))
      if (unknown.length > 0) {
        console.error(`Unknown flag(s): ${unknown.join(', ')}. Supported: ${KNOWN_FLAGS.join(', ')}`)
        process.exit(1)
      }
      const target = rest.find((arg) => !arg.startsWith('--'))
      await cmdRuntimeUse(target, {
        dryRun: rest.includes('--dry-run'),
        copyWorkspaces: !rest.includes('--no-copy-workspaces'),
        adoptCron: rest.includes('--adopt-cron'),
      })
    } else if (args[1] === 'extensions') {
      await cmdRuntimeExtensions(args[2], args[3])
    } else await cmdRuntimeCapabilities()
    return
  }
  if (args[0] === 'status') await cmdStatus()
  else await cmdDispatch()
}
