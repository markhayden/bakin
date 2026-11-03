/**
 * Search engine repair actions (self-healing PR1 slice 1.3a; spec §3.8 and
 * re-homing rows 54–57, 76, 85). Registered beside the existing search
 * repairs; the incidents that used to carry text recipes point at them.
 *
 * - `search-engine-install` wraps the ONE onboarding search component
 *   (binary, service unit, start) — what `bakin install search` runs —
 *   without claiming the service. It is the second attempt behind
 *   `search-engine-restart` and the repair for a missing binary or unit.
 * - `search-engine-claim` is the same component WITH the service claim:
 *   the operator's "Claim search for this home" decision on the ownership
 *   card (row 54), never unattended.
 * - `search-engine-watch-reset` moves an unreadable watch history aside and
 *   starts a fresh streak (row 85).
 * - `search-drop-unclaimed-tables` drops exactly the unclaimed engine
 *   tables the operator chose on the review card (row 76); the engine's
 *   data for another instance is never touched without that decision.
 */
import { existsSync, renameSync } from 'fs'
import { join } from 'path'
import type { HealthRepairActionDefinition, HealthRepairApplyResult, HealthRepairPlanItem, OperationContext, OperationPlan } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'
import { getContentDir } from '../../../../src/core/content-dir'
import { getSettings } from '../../../../src/core/settings'
import { getSearchAdapterSetup } from '../../../../src/core/search-adapter-factory'
import { createLogger } from '../../../../src/core/logger'

const log = createLogger('health:search-engine-repairs')

/**
 * The install's stages come from the adapter setup — the same plan the
 * onboarding `search` component declares (D17: core never names engine
 * stages). Read through the factory so this module stays light to import;
 * the component itself is loaded lazily when a repair applies.
 */
function engineInstallPlan(): OperationPlan {
  try {
    const search = getSettings().search
    const setup = getSearchAdapterSetup(search.adapter, log, search.settings)
    if (setup?.dependency?.plan) return setup.dependency.plan
  } catch (err) {
    log.warn('Search adapter setup unavailable for the install plan; using the generic stages', { err: err instanceof Error ? err.message : String(err) })
  }
  return { stages: [{ id: 'install', kind: 'installing', label: 'Install the Search engine' }, { id: 'verify', kind: 'verifying', label: 'Wait for the engine to answer' }], pointOfNoReturn: 'install' }
}

function results(items: HealthRepairPlanItem[], status: 'applied' | 'failed', message: string, checkId: string): HealthRepairApplyResult[] {
  return items.map((item) => ({ itemId: item.id, actionId: item.actionId, status, message, affectedCheckIds: [checkId], changes: item.changes }))
}

function engineInstallRepair(input: { id: 'search-engine-install' | 'search-engine-claim'; name: string; claim: boolean; reason: string }): HealthRepairActionDefinition {
  return {
    id: input.id,
    name: input.name,
    // Rows 55–57: a pinned, checksum-verified engine install restarts the
    // service and nothing else — self-heal. Row 54: claiming moves the shared
    // service to THIS home permanently, which widens what the operator
    // authorized — one-click, never unattended.
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: input.claim, restartsService: 'search-engine' },
    mutation: input.claim ? 'policy' : 'reinstall',
    resources: ['search-engine'],
    // The adapter declares its own stages; the component reports through them.
    operationPlan: () => engineInstallPlan(),
    async plan(target) {
      return [{
        id: input.id,
        actionId: input.id,
        title: input.name,
        reason: input.reason,
        ...repairTargetSelection(target),
        changes: [{
          kind: 'service',
          target: 'search engine service',
          action: 'install',
          description: input.claim
            ? 'Install the pinned engine, provision its managed service for THIS home (taking it over from the previous owner), and start it. Content and models are untouched.'
            : 'Install the pinned engine if it is missing, provision its managed service, and start it. Safe to run repeatedly; content and models are untouched.',
        }],
      }]
    },
    async apply(items, op: OperationContext) {
      if (items.length === 0) return []
      try {
        const { installableComponent } = await import('../../../../src/core/onboarding')
        const result = await installableComponent('search').install({ autoApprove: true, allowServiceClaim: input.claim }, op)
        if (result.status !== 'installed' && result.status !== 'noop') return results(items, 'failed', result.message, 'health.search')
        return results(items, 'applied', result.message, 'health.search')
      } catch (err) {
        return results(items, 'failed', `Search engine install failed: ${err instanceof Error ? err.message : String(err)}`, 'health.search')
      }
    },
  }
}

export function searchEngineInstallRepair(): HealthRepairActionDefinition {
  return engineInstallRepair({
    id: 'search-engine-install',
    name: 'Install the Search engine and its service',
    claim: false,
    reason: 'The engine binary or its managed service is missing, or the engine stayed dark after a restart.',
  })
}

export function searchEngineClaimRepair(): HealthRepairActionDefinition {
  return engineInstallRepair({
    id: 'search-engine-claim',
    name: 'Claim Search for this home',
    claim: true,
    reason: 'Another Bakin home owns the shared search service; claiming it moves the service to this home permanently.',
  })
}

const WATCH_STATE = ['plugin-data', 'health', 'engine-watch.json'] as const

export function searchEngineWatchResetRepair(): HealthRepairActionDefinition {
  return {
    id: 'search-engine-watch-reset',
    name: 'Restore Search watch history',
    // Row 85: the unreadable file is moved aside, never deleted — self-heal.
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
    mutation: 'none',
    operationPlan: () => ({ stages: [{ id: 'reset', kind: 'installing', label: 'Move the unreadable history aside' }], pointOfNoReturn: 'reset' }),
    async plan(target) {
      return [{
        id: 'search-engine-watch-reset',
        actionId: 'search-engine-watch-reset',
        title: 'Restore Search watch history',
        reason: 'The persisted watch history cannot be read, so Health cannot tell whether symptoms repeated.',
        ...repairTargetSelection(target),
        changes: [{ kind: 'file', target: join(...WATCH_STATE), action: 'update', description: 'Rename the unreadable file to a dated .rejected copy and start a fresh observation streak.' }],
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      const path = join(getContentDir(), ...WATCH_STATE)
      op.stage('reset')
      try {
        if (existsSync(path)) renameSync(path, `${path}.rejected-${new Date().toISOString().replace(/[:.]/g, '-')}`)
        const { resetEngineWatchStreaks } = await import('./search-engine-watch')
        await resetEngineWatchStreaks()
        return results(items, 'applied', 'Watch history moved aside; a fresh observation streak starts with the next check.', 'health.search-canary')
      } catch (err) {
        return results(items, 'failed', `Could not move the watch history aside: ${err instanceof Error ? err.message : String(err)}`, 'health.search-canary')
      }
    },
  }
}

async function unclaimedTablesFromReport(): Promise<string[]> {
  const { getHealthReport } = await import('../../../../src/core/doctor-report-cache')
  const observation = getHealthReport().observations.find((row) => row.checkId === 'health.search-consistency' && row.key === 'indexes.sweep.unclaimed')
  const tables = observation?.evidence?.unclaimed
  return Array.isArray(tables) ? tables.filter((table): table is string => typeof table === 'string') : []
}

export function searchDropUnclaimedTablesRepair(): HealthRepairActionDefinition {
  return {
    id: 'search-drop-unclaimed-tables',
    name: 'Drop unclaimed Search tables',
    // Row 76 (spec §3.9): the tables are not Bakin's content, but another
    // instance's index data dies with them — the operator decides. Stamped as
    // deleting content so the ONE mode policy makes it one-click.
    effects: { deletesUserContent: true, spendsMoney: false, widensAuthorization: false },
    mutation: 'delete',
    resources: ['search-engine'],
    operationPlan: () => ({ stages: [{ id: 'drop', kind: 'installing', label: 'Drop the selected tables' }], pointOfNoReturn: 'drop' }),
    async plan(target) {
      const selection = repairTargetSelection(target)
      return (await unclaimedTablesFromReport()).map((table) => ({
        id: `drop-${table}`,
        actionId: 'search-drop-unclaimed-tables',
        title: `Drop ${table}`,
        reason: 'The table is not referenced by this installation; dropping it frees engine storage. Another Bakin instance would lose its index data if it owned this table.',
        ...selection,
        changes: [{ kind: 'other' as const, target: table, action: 'delete' as const, description: 'Drop the engine table. Content is not affected; an owning instance would need to rebuild it.' }],
      }))
    },
    async apply(items, op) {
      if (items.length === 0) return []
      const { getAppServices } = await import('../../../../src/core/app-services')
      const search = getAppServices().search
      op.stage('drop')
      const out: HealthRepairApplyResult[] = []
      for (const item of items) {
        const table = item.changes[0]?.target
        try {
          if (!table) throw new Error('no table named on the item')
          await search.tables.drop(table)
          out.push({ itemId: item.id, actionId: item.actionId, status: 'applied', message: `Dropped ${table}.`, affectedCheckIds: ['health.search-consistency'], changes: item.changes })
        } catch (err) {
          out.push({ itemId: item.id, actionId: item.actionId, status: 'failed', message: `Could not drop ${table ?? 'the table'}: ${err instanceof Error ? err.message : String(err)}`, affectedCheckIds: ['health.search-consistency'], changes: item.changes })
        }
      }
      return out
    },
  }
}
