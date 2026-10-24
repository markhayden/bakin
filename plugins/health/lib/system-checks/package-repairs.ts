/**
 * Capability-pack repair actions (self-healing PR1 slice 1.3b; re-homing
 * row 6). Both wrap the ONE pack sync engine (`syncPack`, what
 * `bakin packages sync` and `POST /api/packages/:id/sync` run):
 *
 * - `package-sync` re-projects and re-installs a pack's content legs
 *   (skills, npm payloads, models) following its recorded source.
 * - `package-reinstall` re-stages the RECORDED commit (`syncPack(reinstall)`,
 *   slice 1.2) and re-installs every leg — the answer to a missing or
 *   drifted binary and to an installed manifest this Bakin no longer accepts
 *   (the margo #1004 case: four alarms, no button).
 *
 * Which packs each one plans is decided by `capabilityRemedy` — the same
 * classification the capabilities check names its repair from. Both are
 * upgrade-shaped mutations (`sync` / `reinstall`): the ONE authorization
 * gate judges every apply, so an unattended run is refused
 * `consent-unreviewed` until PR6's consent records exist (R3 N2).
 */
import type { HealthRepairActionDefinition, HealthRepairApplyResult, HealthRepairPlanItemInput, HealthRepairTarget, OperationContext } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'
import { listCapabilities, type CapabilityReadiness } from '../../../../src/core/agent-packages/capability-readiness'
import { capabilityRemedy } from '../../../../src/core/agent-packages/capability-remedy'
import { createLogger } from '../../../../src/core/logger'
import { stableKeyPart } from './key'

const log = createLogger('health:package-repairs')

export const PACKAGE_SYNC_ACTION = 'package-sync'
export const PACKAGE_REINSTALL_ACTION = 'package-reinstall'
const CHECK_ID = 'health.capabilities'

/** Whether a repair target names this capability's incident or observation (`not-ready:<cap>` / `<cap>`). */
function targetSelects(target: HealthRepairTarget, cap: CapabilityReadiness): boolean {
  if (target.type === 'all_actionable') return true
  const key = stableKeyPart(cap.capability)
  const wanted = target.type === 'incidents' ? `${CHECK_ID}:not-ready:${key}` : `${CHECK_ID}:${key}`
  return target.ids.some((id) => id === wanted)
}

function packRepair(kind: typeof PACKAGE_SYNC_ACTION | typeof PACKAGE_REINSTALL_ACTION): HealthRepairActionDefinition {
  const reinstall = kind === PACKAGE_REINSTALL_ACTION
  const verb = reinstall ? 'Reinstall' : 'Sync'
  return {
    id: kind,
    name: reinstall ? 'Reinstall capability packs from their recorded source' : 'Sync capability pack content',
    // Row 6: none; a non-empty consent delta is the gate's business, not a static effect.
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
    mutation: reinstall ? 'reinstall' : 'sync',
    resources: ['install-state'],
    // Several packs run under one operation, so the engine's own stages are
    // not entered (sync.ts: many syncs under one op report items themselves).
    operationPlan: () => ({
      stages: [{ id: 'sync', kind: 'installing', label: reinstall ? 'Reinstall the packs' : 'Sync the packs' }],
      pointOfNoReturn: 'sync',
    }),
    async plan(target) {
      const capabilities = await listCapabilities()
      const items: HealthRepairPlanItemInput[] = []
      const seen = new Set<string>()
      for (const cap of capabilities) {
        if (capabilityRemedy(cap) !== kind || !targetSelects(target, cap) || seen.has(cap.packageId)) continue
        seen.add(cap.packageId)
        items.push({
          id: cap.packageId,
          actionId: kind,
          title: `${verb} ${cap.name}`.slice(0, 120),
          reason: reinstall
            ? `${cap.name} has a binary or manifest Bakin cannot trust as installed; re-staging the recorded pack reinstalls every piece from its source.`
            : `${cap.name} is missing projected content a sync re-installs from its source.`,
          ...repairTargetSelection(target),
          changes: [{
            kind: 'file',
            target: `package:${cap.packageId}@${cap.version}`,
            action: 'update',
            description: reinstall
              ? `Re-stage ${cap.packageId} ${cap.version} at its recorded commit and reinstall its skills, binaries, payloads and models.`
              : `Sync ${cap.packageId} ${cap.version}: re-project its skills and reinstall missing payloads and models.`,
          }],
        })
      }
      return items
    },
    async apply(items, op: OperationContext) {
      if (items.length === 0) return []
      const { syncPack } = await import('../../../../src/core/agent-packages/sync')
      const { reloadAgentPackageRegistries } = await import('../../../../src/core/agent-packages/post-sync-reload')
      const results: HealthRepairApplyResult[] = []
      let changed = false
      op.stage('sync')
      for (const item of items) {
        const packageId = item.id
        op.item('sync', { id: packageId, label: packageId, status: 'active' })
        try {
          const receipt = await syncPack(packageId, reinstall ? { reinstall: true } : {})
          changed = changed || receipt.changed
          const message = receipt.changed
            ? `${verb}ed ${packageId}: ${receipt.versionBefore} → ${receipt.versionAfter}.`
            : `${packageId} was already current; its content was re-verified.`
          op.item('sync', { id: packageId, label: packageId, status: 'done', message })
          results.push({ itemId: item.id, actionId: item.actionId, status: 'applied', message, affectedCheckIds: [CHECK_ID], changes: item.changes })
        } catch (err) {
          const message = `${verb} of ${packageId} failed: ${err instanceof Error ? err.message : String(err)}`
          log.warn(message, { packageId })
          op.item('sync', { id: packageId, label: packageId, status: 'failed', message })
          results.push({ itemId: item.id, actionId: item.actionId, status: 'failed', message, affectedCheckIds: [CHECK_ID], changes: item.changes })
        }
      }
      if (changed) await reloadAgentPackageRegistries({ kind: 'synced' })
      return results
    },
  }
}

export function packageSyncRepair(): HealthRepairActionDefinition {
  return packRepair(PACKAGE_SYNC_ACTION)
}

export function packageReinstallRepair(): HealthRepairActionDefinition {
  return packRepair(PACKAGE_REINSTALL_ACTION)
}
