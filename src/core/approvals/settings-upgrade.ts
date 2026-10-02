/**
 * ONE-SHOT, idempotent, crash-safe move of the approval settings out of the
 * workflows plugin's settings file into settings.json (spec D8), plus the
 * `doctor.escalation` string → boolean rewrite (plan review R5b).
 *
 *   0. workflows.json present-but-unreadable ⇒ BLOCKED: nothing is written
 *      (the operator's channel choice is still in those bytes).
 *   1. No source keys AND doctor.escalation already boolean (or absent) ⇒ noop.
 *   2. Source keys present ⇒ write workflows.json.pre-approvals.bak once
 *      (atomic; the honest rollback, never rewritten).
 *   3. Write settings.approvals from the source keys — unless the destination
 *      already exists (a crash between steps 3 and 4: destination wins) —
 *      and doctor.escalation as a boolean ('off' → false, else true).
 *   4. Strip the four source keys (notifyOnGate is dropped, it was dead).
 *
 * Deletable once the operator's box has booted on it: this file, its test,
 * the server.ts call, and the legacy-string coercion in normalizeDoctorSettings.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pluginSettingsPath, readPluginSettingsFile, writePluginSettings } from '@bakin/core/plugins/settings-store'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'
import { updateSettings } from '../settings'

const log = createLogger('approvals:settings-upgrade')

export const SOURCE_PLUGIN_ID = 'workflows'
const SOURCE_KEYS = ['approvalChannelAlerts', 'approvalChannel', 'requireRejectReason', 'notifyOnGate'] as const

export type ApprovalSettingsUpgradeResult =
  | { status: 'noop' }
  | { status: 'upgraded'; movedApprovals: boolean; rewroteEscalation: boolean }
  | { status: 'resumed' }
  | { status: 'blocked'; reason: string }

type SourceSettings = Record<string, unknown>

function readRawSettings(): Record<string, unknown> {
  const file = join(getContentDir(), 'settings.json')
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch (err) {
    log.warn('settings.json unreadable during the approvals upgrade — treating as empty', { err: err instanceof Error ? err.message : String(err) })
    return {}
  }
}

function backupPath(): string {
  return `${pluginSettingsPath(SOURCE_PLUGIN_ID)}.pre-approvals.bak`
}

/** Atomic (tmp + rename), written only once. */
function writeBackupOnce(source: SourceSettings): void {
  const file = backupPath()
  if (existsSync(file)) return
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(source, null, 2))
  renameSync(tmp, file)
}

export function upgradeApprovalSettings(): ApprovalSettingsUpgradeResult {
  const read = readPluginSettingsFile(SOURCE_PLUGIN_ID)
  if (read.status === 'unreadable') {
    const reason = `${read.file} is not readable JSON (${read.error}); approval settings were not moved`
    log.error('Approvals settings upgrade blocked', new Error(reason))
    return { status: 'blocked', reason }
  }
  const source: SourceSettings = read.status === 'ok' && read.value && typeof read.value === 'object'
    ? (read.value as SourceSettings)
    : {}
  const hasSourceKeys = SOURCE_KEYS.some((key) => key in source)

  const raw = readRawSettings()
  const rawDoctor = raw.doctor && typeof raw.doctor === 'object' ? (raw.doctor as Record<string, unknown>) : {}
  const legacyEscalation = typeof rawDoctor.escalation === 'string' ? rawDoctor.escalation : null
  const destinationHasApprovals = !!raw.approvals && typeof raw.approvals === 'object'

  if (!hasSourceKeys && legacyEscalation === null) return { status: 'noop' }

  if (hasSourceKeys) writeBackupOnce(source)

  const patch: Record<string, unknown> = {}
  const movedApprovals = hasSourceKeys && !destinationHasApprovals
  if (movedApprovals) {
    patch.approvals = {
      channelAlerts: typeof source.approvalChannelAlerts === 'boolean' ? source.approvalChannelAlerts : false,
      channel: typeof source.approvalChannel === 'string' && source.approvalChannel.trim() !== '' ? source.approvalChannel : 'general',
      requireRejectReason: typeof source.requireRejectReason === 'boolean' ? source.requireRejectReason : true,
    }
  }
  if (legacyEscalation !== null) {
    patch.doctor = { escalation: legacyEscalation !== 'off' }
  }
  if (Object.keys(patch).length > 0) updateSettings(patch)

  if (hasSourceKeys) {
    const rest: SourceSettings = { ...source }
    for (const key of SOURCE_KEYS) delete rest[key]
    writePluginSettings(SOURCE_PLUGIN_ID, rest)
  }

  if (hasSourceKeys && destinationHasApprovals) {
    log.info('Approvals settings upgrade resumed: destination already present, source keys stripped')
    return { status: 'resumed' }
  }
  log.info('Approvals settings upgraded', { movedApprovals, rewroteEscalation: legacyEscalation !== null, from: legacyEscalation })
  return { status: 'upgraded', movedApprovals, rewroteEscalation: legacyEscalation !== null }
}
