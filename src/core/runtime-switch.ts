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

import type {
  AgentRuntimeAdapter,
  CapabilitySet,
  RuntimeAgent,
  ToolAccessProvisioningStatus,
} from '@bakin/core/adapters/runtime'
import type { RuntimeAdapterName } from '@bakin/core/settings'

import { createAppServices, maybeGetAppServices } from './app-services'
import { getSupportedRuntimeAdapterNames } from './runtime-adapter-factory'
import { syncBakinRuntimeSkill } from './bakin-skill'
import { getContentDir } from './content-dir'
import { createLogger } from './logger'
import { reconcileRoster, type RosterCarryReport } from './roster-reconcile'
import { getSettings, updateSettings } from './settings'

const log = createLogger('runtime-switch')

export const RUNTIME_ADAPTER_NAMES: readonly RuntimeAdapterName[] = getSupportedRuntimeAdapterNames()

export type SwitchPhase =
  | 'validate'
  | 'backup'
  | 'snapshot-roster'
  | 'deprovision'
  | 'flip'
  | 'initialize'
  | 'provision'
  | 'reconcile-roster'
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
  /** Drift-gated re-projection outcome (null when the phase didn't run). */
  sync: { drifted: boolean; findings: number; syncedAgents: number } | null
  capabilities: CapabilitySet | null
  toolAccess: ToolAccessProvisioningStatus | null
  /** Plugins hold the old adapter until the server restarts. */
  restartRequired: boolean
  error?: string
  /** On failure: whether the original adapter was restored successfully. */
  restored?: boolean
}

export interface SwitchRuntimeOptions {
  onProgress?: (event: SwitchProgressEvent) => void
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
    sync: null,
    capabilities: null,
    toolAccess: null,
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
  emit({ phase: 'validate', status: 'ok', detail: `${from} → ${target}` })
  switchInFlight = true

  try {

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
    try {
      sourceRoster = await oldRuntime.agents.list()
      emit({ phase: 'snapshot-roster', status: 'ok', detail: `${sourceRoster.length} agent(s)` })
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
    // the previous transport's skill (P5.3 live: OpenClaw held an
    // mcporter-era skill after the flip). Idempotent; a failure degrades to
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
