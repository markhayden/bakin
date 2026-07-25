/**
 * Runtime switch orchestrator (P3.1) — the first-class lifecycle for moving
 * this Bakin install between runtime adapters (Pi ↔ OpenClaw):
 *
 *   validate → backup settings → snapshot source roster → deprovision old →
 *   flip settings → initialize target (fresh app services) → provision →
 *   reconcile roster (best-effort carry, honest unmapped report) →
 *   drift-gated agent re-projection → capability + tool-access report.
 *
 * Reversible: any step failure restores the settings backup and rebuilds app
 * services on the ORIGINAL adapter; the result says whether restore worked.
 *
 * IN-PROCESS SCOPE: activated plugins captured `ctx.runtime` at activation,
 * so a completed switch requires a server RESTART to rebind them — the
 * result carries `restartRequired: true` and callers (CLI/REST/UI) surface
 * it. Everything durable (settings, provisioning, roster, projections) is
 * done before the restart; the restart is a rebind, not a migration step.
 */
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

import { z } from 'zod'

import type {
  AgentRuntimeAdapter,
  CapabilitySet,
  RuntimeAgent,
  RuntimeCredentialStatus,
  ToolAccessProvisioningStatus,
} from '@bakin/core/adapters/runtime'
import type { RuntimeAdapterName } from '@bakin/core/settings'

import { createAppServices, maybeGetAppServices } from './app-services'
import { createRuntimeAdapter, getSupportedRuntimeAdapterNames } from './runtime-adapter-factory'
import { syncBakinRuntimeSkill } from './bakin-skill'
import { getContentDir } from './content-dir'
import { getInFlightTurnCount } from './dispatch-registry'
import { resetSameAgentTurnsModeCache } from './dispatch-turns'
import { createLogger } from './logger'
import { reconcileRoster, type RosterCarryReport } from './roster-reconcile'
import { getSettings, updateSettings } from './settings'
import { snapshotAgentContent, carryAgentContent, previewWorkspaceCarry, type AgentContentSnapshot, type WorkspaceCarryReport } from './workspace-carry'
import { snapshotSourceCapabilities, buildCantCarryReport, type CantCarryLine, type SourceCapabilitySnapshot } from './switch-report'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'

const log = createLogger('runtime-switch')

export const RUNTIME_ADAPTER_NAMES: readonly RuntimeAdapterName[] = getSupportedRuntimeAdapterNames()

/**
 * REST boundary schema for POST /api/runtime/switch. STRICT + boolean-only:
 * a type-confused body (`dryRun: "true"`, a typo'd key) must 400 — the
 * preview flag failing open into a REAL switch is the one mistake this
 * endpoint cannot make.
 */
export const RuntimeSwitchRequestSchema = z
  .object({
    target: z.string().min(1),
    dryRun: z.boolean().optional(),
    copyWorkspaces: z.boolean().optional(),
    adoptCron: z.boolean().optional(),
  })
  .strict()

export type SwitchPhase =
  | 'validate'
  | 'backup'
  | 'snapshot-roster'
  | 'deprovision'
  | 'flip'
  | 'initialize'
  | 'provision'
  | 'reconcile-roster'
  | 'adopt-cron'
  | 'carry-workspaces'
  | 'sync-agents'
  | 'validate-capabilities'
  | 'restore'

export interface SwitchProgressEvent {
  phase: SwitchPhase
  status: 'start' | 'ok' | 'skip' | 'error'
  detail?: string
}

export interface RuntimeSwitchResult {
  ok: boolean
  from: RuntimeAdapterName
  to: RuntimeAdapterName
  /** Settings backup — the rollback artifact (null only if validate failed). */
  backupPath: string | null
  roster: RosterCarryReport | null
  /** Workspace/skill content carried for switch-created agents (null when the phase didn't run). */
  workspaces: WorkspaceCarryReport | null
  /** Drift-gated re-projection outcome (null when the phase didn't run). */
  sync: { drifted: boolean; findings: number; syncedAgents: number } | null
  capabilities: CapabilitySet | null
  toolAccess: ToolAccessProvisioningStatus | null
  /** Opt-in cron adoption outcome (null when not requested / nothing to adopt). */
  cron: { adopted: string[]; skipped: string[]; failed: Array<{ jobId: string; error: string }> } | null
  /** What stays behind, honestly (capability diff + counts; null when the phase didn't run). */
  cantCarry: CantCarryLine[] | null
  /** The TARGET's credential presence — a carried roster with no provider auth dispatches nothing. */
  credentials: RuntimeCredentialStatus | null
  /** True for a preview run: nothing was written anywhere. */
  dryRun?: boolean
  /** Plugins hold the old adapter until the server restarts. */
  restartRequired: boolean
  error?: string
  /** On failure: whether the original adapter was restored successfully. */
  restored?: boolean
}

export interface SwitchRuntimeOptions {
  onProgress?: (event: SwitchProgressEvent) => void
  /**
   * Carry source workspace content (canonical files, memory, agent-authored
   * skills) onto agents the switch creates. Default true — a switch that
   * silently strands agent memory is the failure mode this exists to fix.
   */
  copyWorkspaces?: boolean
  /**
   * Preview the full switch report (roster carry, workspace content,
   * can't-carry lines, target credentials) with ZERO writes: no backup, no
   * flip, no provisioning, no target-home mutation. The target adapter is
   * constructed as a read-only secondary instance and shut down after.
   */
  dryRun?: boolean
  /**
   * Adopt the source runtime's native cron jobs into Bakin schedules
   * (schedule plugin hook, idempotent per job id). Opt-in — never automatic;
   * dry runs preview the would-adopt list.
   */
  adoptCron?: boolean
}

type CronAdoptionResult = NonNullable<RuntimeSwitchResult['cron']>

/**
 * Hand snapshotted source cron jobs to the schedule plugin's adoption hook.
 * Absent hook (schedule plugin inactive) and empty snapshots are honest
 * skips; failures never abort the switch — the flip already happened.
 */
async function runCronAdoption(
  provider: string,
  sourceCapabilities: SourceCapabilitySnapshot | null,
  dryRun: boolean,
  emit: (event: SwitchProgressEvent) => void,
): Promise<CronAdoptionResult | null> {
  const jobs = sourceCapabilities?.cronJobs ?? []
  if (jobs.length === 0) {
    emit({ phase: 'adopt-cron', status: 'skip', detail: sourceCapabilities?.hasCron ? 'no runtime cron jobs in the source snapshot' : 'source runtime has no cron surface' })
    return null
  }
  try {
    const outcome = await getHookRegistry().invoke<CronAdoptionResult>('schedule.adoptCronJobs', {
      provider,
      jobs,
      dryRun,
    })
    if (!outcome) {
      emit({ phase: 'adopt-cron', status: 'error', detail: 'schedule plugin hook unavailable — jobs NOT adopted (adopt individually from the Schedule page)' })
      return { adopted: [], skipped: [], failed: jobs.map((j) => ({ jobId: j.job.id, error: 'schedule.adoptCronJobs hook unavailable' })) }
    }
    emit({
      phase: 'adopt-cron',
      status: 'ok',
      detail: `${dryRun ? 'would adopt' : 'adopted'} ${outcome.adopted.length}, already Bakin ${outcome.skipped.length}, failed ${outcome.failed.length}`,
    })
    return outcome
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit({ phase: 'adopt-cron', status: 'error', detail: message })
    return { adopted: [], skipped: [], failed: jobs.map((j) => ({ jobId: j.job.id, error: message })) }
  }
}

/** Fold the adoption outcome into the cron can't-carry line, honestly. */
function adjustCantCarryForAdoption(lines: CantCarryLine[], cron: CronAdoptionResult | null, dryRun: boolean): CantCarryLine[] {
  if (!cron || cron.adopted.length === 0) return lines
  return lines.map((line) => {
    if (line.concern !== 'cron') return line
    const verb = dryRun ? 'would be adopted' : 'adopted'
    const remaining = (line.count ?? cron.adopted.length + cron.failed.length) - cron.adopted.length - cron.skipped.length
    return {
      ...line,
      detail: remaining > 0
        ? `${cron.adopted.length} runtime cron job(s) ${verb} into Bakin schedules; ${remaining} stay(s) behind`
        : `runtime cron jobs ${verb} into Bakin schedules — nothing stays behind`,
    }
  })
}

function isRuntimeAdapterName(value: string): value is RuntimeAdapterName {
  return (RUNTIME_ADAPTER_NAMES as readonly string[]).includes(value)
}

async function currentRuntime(): Promise<AgentRuntimeAdapter> {
  return maybeGetAppServices()?.runtime ?? (await createAppServices()).runtime
}

/** Drift-gated re-projection: recompose/sync only when the scan finds drift. */
async function syncAgentsIfDrifted(): Promise<{ drifted: boolean; findings: number; syncedAgents: number }> {
  const { scanAgentSync } = await import('./agent-packages/sync-scanner')
  const before = await scanAgentSync()
  if (before.findings.length === 0) return { drifted: false, findings: 0, syncedAgents: 0 }
  const { syncAllAgents } = await import('./agent-packages/sync')
  const results = await syncAllAgents({ fetch: false, trigger: 'system' })
  return { drifted: true, findings: before.findings.length, syncedAgents: results.length }
}

/**
 * Single-flight: two interleaved switches would deprovision/flip/provision
 * in arbitrary order. Concurrent callers get an immediate error result.
 */
let switchInFlight = false

export async function switchRuntime(
  target: string,
  opts: SwitchRuntimeOptions = {},
): Promise<RuntimeSwitchResult> {
  const emit = (event: SwitchProgressEvent) => {
    opts.onProgress?.(event)
    log.info(`switch ${event.phase}: ${event.status}`, event.detail ? { detail: event.detail } : undefined)
  }
  const from = getSettings().runtime.adapter

  const result: RuntimeSwitchResult = {
    ok: false,
    from,
    to: target as RuntimeAdapterName,
    backupPath: null,
    roster: null,
    workspaces: null,
    sync: null,
    cron: null,
    capabilities: null,
    toolAccess: null,
    cantCarry: null,
    credentials: null,
    restartRequired: false,
  }

  // ── validate ──────────────────────────────────────────────────────────
  emit({ phase: 'validate', status: 'start' })
  if (switchInFlight) {
    result.error = 'A runtime switch is already in progress'
    emit({ phase: 'validate', status: 'error', detail: result.error })
    return result
  }
  if (!isRuntimeAdapterName(target)) {
    result.error = `Unknown runtime adapter '${target}' (supported: ${RUNTIME_ADAPTER_NAMES.join(', ')})`
    emit({ phase: 'validate', status: 'error', detail: result.error })
    return result
  }
  if (target === from) {
    result.error = `Runtime '${target}' is already active`
    emit({ phase: 'validate', status: 'error', detail: result.error })
    return result
  }
  // In-flight dispatch turns hold live sessions on the OLD adapter — a
  // switch would shutdown() under them (exposure doubles at per-agent cap
  // 2). Refuse honestly; the operator retries when the board is quiet.
  // Dry runs are read-only against a secondary adapter and stay allowed.
  const inFlight = getInFlightTurnCount()
  if (!opts.dryRun && inFlight > 0) {
    result.error = `${inFlight} dispatch turn(s) are in flight — wait for them to settle (or abort their tasks) before switching runtimes`
    emit({ phase: 'validate', status: 'error', detail: result.error })
    return result
  }
  emit({ phase: 'validate', status: 'ok', detail: `${from} → ${target}${opts.dryRun ? ' (dry run)' : ''}` })
  switchInFlight = true

  try {

  // ── dry run: full preview, zero writes, no restore semantics ──────────
  if (opts.dryRun) {
    result.dryRun = true
    try {
      return await dryRunSwitch(result, target, opts, emit)
    } catch (err) {
      // Nothing was changed — a dry-run failure needs no restore, only honesty.
      result.error = err instanceof Error ? err.message : String(err)
      log.error('Runtime switch dry run failed', err, { from, to: target })
      return result
    }
  }

  // ── backup ────────────────────────────────────────────────────────────
  emit({ phase: 'backup', status: 'start' })
  const settingsPath = join(getContentDir(), 'settings.json')
  const backupDir = join(getContentDir(), '.backups')
  const backupPath = join(backupDir, `settings-pre-switch-${target}-${Date.now()}.json`)
  try {
    if (existsSync(settingsPath)) {
      mkdirSync(backupDir, { recursive: true })
      copyFileSync(settingsPath, backupPath)
      result.backupPath = backupPath
      emit({ phase: 'backup', status: 'ok', detail: backupPath })
    } else {
      // No settings file yet — nothing to back up; the flip below creates it.
      emit({ phase: 'backup', status: 'skip', detail: 'no settings.json present' })
    }
  } catch (err) {
    result.error = `Settings backup failed: ${err instanceof Error ? err.message : String(err)}`
    emit({ phase: 'backup', status: 'error', detail: result.error })
    return result
  }

  // Set once the old runtime has been deprovisioned/shut down: from that
  // point plugins hold a dead adapter instance, so even a restored failure
  // needs a restart to rebind them.
  let teardownRan = false
  // The partially-initialized target (set after `initialize`) — restore must
  // tear it down or its provisioned entries/watchers leak.
  let targetRuntime: AgentRuntimeAdapter | null = null

  const restore = async (): Promise<boolean> => {
    emit({ phase: 'restore', status: 'start' })
    try {
      // Best-effort: strip the half-provisioned target's tool access and
      // shut it down before rebuilding on the original adapter.
      if (targetRuntime) {
        try {
          await targetRuntime.deprovisionToolAccess()
          await targetRuntime.shutdown()
        } catch (err) {
          log.warn('target runtime teardown failed during restore', { error: String(err) })
        }
      }
      if (result.backupPath) copyFileSync(result.backupPath, settingsPath)
      else updateSettings({ runtime: { adapter: from } })
      const { resetSettingsCache } = await import('./settings')
      resetSettingsCache()
      const services = await createAppServices()
      // The old runtime was deprovisioned before the flip — without this,
      // a restored OpenClaw loses every bakin-<agent> MCP entry until the
      // next server boot and agents silently lose their Bakin tools.
      try {
        await services.runtime.provisionToolAccess()
        await syncBakinRuntimeSkill(process.cwd(), services.runtime)
      } catch (err) {
        log.warn('re-provisioning the restored runtime failed; next server boot heals it', { error: String(err) })
      }
      emit({ phase: 'restore', status: 'ok', detail: `restored ${from}` })
      return true
    } catch (err) {
      emit({ phase: 'restore', status: 'error', detail: err instanceof Error ? err.message : String(err) })
      return false
    }
  }

  try {
    // ── snapshot the source roster (before any teardown) ────────────────
    emit({ phase: 'snapshot-roster', status: 'start' })
    const oldRuntime = await currentRuntime()
    let sourceRoster: RuntimeAgent[] = []
    let contentSnapshot: AgentContentSnapshot | null = null
    let sourceCapabilities: SourceCapabilitySnapshot | null = null
    const copyWorkspaces = opts.copyWorkspaces !== false
    try {
      // Optional-surface presence + counts must be read pre-teardown too.
      sourceCapabilities = await snapshotSourceCapabilities(oldRuntime, { captureCronJobs: opts.adoptCron === true })
      sourceRoster = await oldRuntime.agents.list()
      // Workspace content must be captured NOW — the source runtime is torn
      // down before the target exists (snapshotAgentContent degrades read
      // failures to per-agent notes; it never throws).
      if (copyWorkspaces && sourceRoster.length > 0) {
        contentSnapshot = await snapshotAgentContent(oldRuntime, sourceRoster)
      }
      const snapshotFiles = contentSnapshot
        ? [...contentSnapshot.agents.values()].reduce((sum, c) => sum + c.files.length + c.skills.length, 0)
        : 0
      emit({
        phase: 'snapshot-roster',
        status: 'ok',
        detail: `${sourceRoster.length} agent(s)${contentSnapshot ? `, ${snapshotFiles} content file(s)/skill(s)` : ''}`,
      })
    } catch (err) {
      // A dead source runtime must not block LEAVING it — carry nothing.
      emit({ phase: 'snapshot-roster', status: 'skip', detail: `source roster unreadable: ${err instanceof Error ? err.message : String(err)}` })
    }

    // ── deprovision the old runtime's tool access (best-effort) ─────────
    emit({ phase: 'deprovision', status: 'start' })
    teardownRan = true
    try {
      await oldRuntime.deprovisionToolAccess()
      emit({ phase: 'deprovision', status: 'ok' })
    } catch (err) {
      emit({ phase: 'deprovision', status: 'skip', detail: err instanceof Error ? err.message : String(err) })
    }
    try {
      await oldRuntime.shutdown()
    } catch (err) {
      // Best-effort teardown; the new services replace it regardless.
      log.warn('old runtime shutdown failed during switch', { error: String(err) })
    }

    // ── flip ─────────────────────────────────────────────────────────────
    emit({ phase: 'flip', status: 'start' })
    updateSettings({ runtime: { adapter: target } })
    // The dispatch gate's per-process concurrency-mode cache belongs to the
    // OLD adapter — without this reset, a Pi→OpenClaw switch would keep
    // firing two same-agent turns at a serialized runtime until the restart
    // (review F1: the exact shared-workspace collision the gate prevents).
    resetSameAgentTurnsModeCache()
    emit({ phase: 'flip', status: 'ok' })

    // ── initialize target (fresh app services off the flipped settings) ──
    emit({ phase: 'initialize', status: 'start' })
    const services = await createAppServices()
    const newRuntime = services.runtime
    targetRuntime = newRuntime
    emit({ phase: 'initialize', status: 'ok', detail: `${newRuntime.name}@${newRuntime.version}` })

    // ── provision tool access ─────────────────────────────────────────────
    emit({ phase: 'provision', status: 'start' })
    await newRuntime.provisionToolAccess()
    // The Bakin runtime skill is transport-carrying content rendered from
    // the ACTIVE runtime's tool access — a switch without a refresh strands
    // a skill that still teaches the PREVIOUS runtime's invocation style
    // (observed live in P5.3). Idempotent; a failure degrades to
    // onboarding's `broken` state instead of failing the switch.
    let skillDetail: string | undefined
    try {
      const skillResult = await syncBakinRuntimeSkill(process.cwd(), newRuntime)
      if (skillResult !== 'noop') skillDetail = `runtime skill ${skillResult}`
    } catch (err) {
      skillDetail = `runtime skill sync failed: ${err instanceof Error ? err.message : String(err)}`
      log.warn('runtime skill sync failed during switch', { error: String(err) })
    }
    emit({ phase: 'provision', status: 'ok', ...(skillDetail ? { detail: skillDetail } : {}) })

    // ── reconcile roster (best-effort carry) ──────────────────────────────
    emit({ phase: 'reconcile-roster', status: 'start' })
    result.roster = await reconcileRoster(sourceRoster, newRuntime)
    // New agents need MCP entries on mcp-style runtimes; create() provisions
    // per-agent, but a no-op carry still deserves a coherent final state.
    await newRuntime.provisionToolAccess()
    emit({
      phase: 'reconcile-roster',
      status: 'ok',
      detail: `carried ${result.roster.carried.length}, existing ${result.roster.existing.length}, unmapped models ${result.roster.unmappedModels.length}, failed ${result.roster.failed.length}`,
    })

    // ── adopt source cron jobs into Bakin schedules (opt-in) ─────────────
    emit({ phase: 'adopt-cron', status: 'start' })
    if (!opts.adoptCron) {
      emit({ phase: 'adopt-cron', status: 'skip', detail: 'not requested (--adopt-cron)' })
    } else {
      result.cron = await runCronAdoption(from, sourceCapabilities, false, emit)
    }

    // ── workspace content carry (switch-created agents only) ─────────────
    emit({ phase: 'carry-workspaces', status: 'start' })
    if (!copyWorkspaces) {
      emit({ phase: 'carry-workspaces', status: 'skip', detail: 'disabled by caller (copyWorkspaces: false)' })
    } else if (!contentSnapshot) {
      emit({ phase: 'carry-workspaces', status: 'skip', detail: 'no source content snapshot' })
    } else {
      // Content-copy failures degrade to report entries on a completed flip
      // (D9) — they never trigger the restore path.
      result.workspaces = await carryAgentContent(
        contentSnapshot,
        newRuntime,
        result.roster.carried.map((c) => c.agentId),
        result.roster.existing,
      )
      const filesCarried = result.workspaces.carried.reduce((sum, c) => sum + c.files, 0)
      const skillsCarried = result.workspaces.skills.reduce((sum, s) => sum + s.carried, 0)
      emit({
        phase: 'carry-workspaces',
        status: 'ok',
        detail: `${filesCarried} file(s) + ${skillsCarried} skill(s) for ${result.workspaces.carried.length} agent(s), skipped existing ${result.workspaces.skippedExisting.length}, failed ${result.workspaces.failed.length}`,
      })
    }

    // ── drift-gated re-projection ─────────────────────────────────────────
    emit({ phase: 'sync-agents', status: 'start' })
    result.sync = await syncAgentsIfDrifted()
    emit({
      phase: 'sync-agents',
      status: result.sync.drifted ? 'ok' : 'skip',
      detail: result.sync.drifted
        ? `${result.sync.findings} finding(s) → synced ${result.sync.syncedAgents} agent(s)`
        : 'no drift — projections untouched',
    })

    // ── validate capabilities + tool access ───────────────────────────────
    emit({ phase: 'validate-capabilities', status: 'start' })
    result.capabilities = await newRuntime.capabilities()
    result.toolAccess = await newRuntime.verifyToolAccess()
    if (sourceCapabilities) {
      result.cantCarry = adjustCantCarryForAdoption(buildCantCarryReport(sourceCapabilities, newRuntime), result.cron, false)
    }
    try {
      result.credentials = await newRuntime.credentialStatus()
    } catch (err) {
      // Preflight is advisory — an unreadable credential store never fails
      // the switch, it just can't warn.
      log.warn('target credentialStatus unavailable during switch', { error: String(err) })
    }
    emit({
      phase: 'validate-capabilities',
      status: result.toolAccess.ok ? 'ok' : 'error',
      detail: result.toolAccess.ok ? undefined : result.toolAccess.issues.join('; '),
    })

    result.ok = true
    result.restartRequired = true
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    log.error('Runtime switch failed — restoring previous adapter', err, { from, to: target })
    result.restored = await restore()
    // Plugins captured the pre-switch adapter, which we shut down — even a
    // clean restore built a NEW instance, so a restart is still required.
    result.restartRequired = teardownRan
    return result
  }
  } finally {
    switchInFlight = false
  }
}

/**
 * The dry-run secondary target: constructed and initialized (write-free by
 * conformance-pinned contract) with the same opts a real flip would hand it
 * — but NEVER registered as app services, NEVER provisioned, and with a
 * no-op audit sink (a preview leaves no trace anywhere, audit.jsonl
 * included). Callers own shutdown().
 */
async function createSecondaryTargetRuntime(target: RuntimeAdapterName): Promise<AgentRuntimeAdapter> {
  const { createRuntimeExecToolProvider } = await import('./exec-tools/provider')
  const { resolveBakinMcpBaseUrl } = await import('./app-services')
  const runtime = createRuntimeAdapter(target)
  await runtime.initialize({
    contentDir: getContentDir(),
    logger: log,
    audit: () => {},
    settings: getSettings().runtime.settings,
    execTools: createRuntimeExecToolProvider(),
    bakinMcpBaseUrl: resolveBakinMcpBaseUrl(),
  })
  return runtime
}

/** The preview pipeline — mirrors the real phases it stands in for. */
async function dryRunSwitch(
  result: RuntimeSwitchResult,
  target: RuntimeAdapterName,
  opts: SwitchRuntimeOptions,
  emit: (event: SwitchProgressEvent) => void,
): Promise<RuntimeSwitchResult> {
  const source = await currentRuntime()
  const copyWorkspaces = opts.copyWorkspaces !== false

  emit({ phase: 'snapshot-roster', status: 'start' })
  let sourceRoster: RuntimeAgent[] = []
  let contentSnapshot: AgentContentSnapshot | null = null
  let sourceCapabilities: SourceCapabilitySnapshot | null = null
  try {
    sourceCapabilities = await snapshotSourceCapabilities(source, { captureCronJobs: opts.adoptCron === true })
    sourceRoster = await source.agents.list()
    if (copyWorkspaces && sourceRoster.length > 0) {
      contentSnapshot = await snapshotAgentContent(source, sourceRoster)
    }
    emit({ phase: 'snapshot-roster', status: 'ok', detail: `${sourceRoster.length} agent(s)` })
  } catch (err) {
    emit({ phase: 'snapshot-roster', status: 'skip', detail: `source roster unreadable: ${err instanceof Error ? err.message : String(err)}` })
  }

  emit({ phase: 'initialize', status: 'start' })
  const targetRuntime = await createSecondaryTargetRuntime(target)
  emit({ phase: 'initialize', status: 'ok', detail: `${targetRuntime.name}@${targetRuntime.version} (read-only secondary)` })

  try {
    emit({ phase: 'reconcile-roster', status: 'start' })
    result.roster = await reconcileRoster(sourceRoster, targetRuntime, { dryRun: true })
    emit({
      phase: 'reconcile-roster',
      status: 'ok',
      detail: `would carry ${result.roster.carried.length}, existing ${result.roster.existing.length}, unmapped models ${result.roster.unmappedModels.length}`,
    })

    emit({ phase: 'adopt-cron', status: 'start' })
    if (!opts.adoptCron) {
      emit({ phase: 'adopt-cron', status: 'skip', detail: 'not requested (--adopt-cron)' })
    } else {
      result.cron = await runCronAdoption(result.from, sourceCapabilities, true, emit)
    }

    emit({ phase: 'carry-workspaces', status: 'start' })
    if (!copyWorkspaces) {
      emit({ phase: 'carry-workspaces', status: 'skip', detail: 'disabled by caller (copyWorkspaces: false)' })
    } else if (!contentSnapshot) {
      emit({ phase: 'carry-workspaces', status: 'skip', detail: 'no source content snapshot' })
    } else {
      result.workspaces = previewWorkspaceCarry(
        contentSnapshot,
        result.roster.carried.map((c) => c.agentId),
        result.roster.existing,
      )
      const files = result.workspaces.carried.reduce((sum, c) => sum + c.files, 0)
      const skills = result.workspaces.skills.reduce((sum, s) => sum + s.carried, 0)
      emit({
        phase: 'carry-workspaces',
        status: 'ok',
        detail: `would carry ${files} file(s) + ${skills} skill(s) for ${result.workspaces.carried.length} agent(s)`,
      })
    }

    emit({ phase: 'validate-capabilities', status: 'start' })
    result.capabilities = await targetRuntime.capabilities()
    if (sourceCapabilities) {
      result.cantCarry = adjustCantCarryForAdoption(buildCantCarryReport(sourceCapabilities, targetRuntime), result.cron, true)
    }
    try {
      result.credentials = await targetRuntime.credentialStatus()
    } catch (err) {
      log.warn('target credentialStatus unavailable during dry run', { error: String(err) })
    }
    emit({ phase: 'validate-capabilities', status: 'ok' })

    result.ok = true
    result.restartRequired = false
    return result
  } finally {
    try {
      await targetRuntime.shutdown()
    } catch (err) {
      log.warn('secondary target shutdown failed after dry run', { error: String(err) })
    }
  }
}
