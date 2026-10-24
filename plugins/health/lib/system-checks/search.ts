/**
 * System check — search adapter binary install + connection.
 *
 * Migrated out of src/core/doctor.ts (#139 C7). When search is
 * disabled, the binary check is informational; when enabled, a missing
 * binary or unreachable daemon surfaces as an error.
 */
import { getSettings } from '../../../../src/core/settings'
import { healthError, healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthObservationInput, HealthRepairActionDefinition, HealthSubject } from '@makinbakin/sdk'
import type { SearchHealthSnapshot } from '@makinbakin/sdk'
import { checkSearchOutboxObservations } from './search-outbox'
import { REBUILD_PLAN } from './search-spin'
import { repairTargetSelection } from '@bakin/core/health/repair-support'

/** The one subject every engine-level search incident is about. */
export const SEARCH_ENGINE_SUBJECT: HealthSubject = { kind: 'service', id: 'search-engine', label: 'Search engine' }

/**
 * The `health.search` check's finite incident families (re-homing rows
 * 52–68). Observation rows (disabled, unknowns, embedder settings, table
 * health, no indexes) carry no family: they are plain observations now.
 */
export const SEARCH_INCIDENTS: HealthIncidentDeclaration[] = [
  // Row 54: the shared service belongs to another home — the operator claims it (a one-click repair) or configures a guest endpoint.
  { id: 'service-ownership-claim', subjectKind: 'service', resolution: { type: 'repair', actionId: 'search-engine-claim' }, required: 'always' },
  { id: 'service-ownership', subjectKind: 'service', resolution: { type: 'human', needs: 'decision' }, required: 'always' },
  // Rows 55–56.
  { id: 'binary-missing', subjectKind: 'service', resolution: { type: 'repair', actionId: 'search-engine-install' }, required: 'always' },
  { id: 'service-unprovisioned', subjectKind: 'service', resolution: { type: 'repair', actionId: 'search-engine-install' }, required: 'always' },
  // Row 57; a guest endpoint is not ours to restart — a human decision on that split.
  { id: 'engine-unavailable', subjectKind: 'service', resolution: { type: 'repair', actionId: 'search-engine-restart' }, required: 'always' },
  { id: 'engine-unavailable-guest', subjectKind: 'service', resolution: { type: 'human', needs: 'decision' }, required: 'always' },
  // Row 64: historical scars — a blue/green rebuild self-heals; advisory.
  { id: 'table-scars', subjectKind: 'service', resolution: { type: 'repair', actionId: 'search-scar-rebuild' }, required: 'never' },
  // Rows 67–68 are emitted by the outbox observations this check runs.
  { id: 'quarantined-writes', subjectKind: 'service', resolution: { type: 'repair', actionId: 'search-outbox-revive' }, required: 'always' },
  { id: 'stale-backlog', subjectKind: 'service', resolution: { type: 'repair', actionId: 'search-engine-restart' }, required: 'never' },
]

export async function checkSearchAdapter(): Promise<HealthCheckRunInput> {
  const settings = getSettings()
  const adapter = settings.search.adapter
  const searchSettings = settings.search.settings
  // Lazy import keeps adapter helper setup off the cold path when the
  // check returns early (matches the original migration's pattern).
  const { isSearchAdapterInstalled, getSearchAdapterServiceStatus } = await import('../../../../src/core/search-adapter-factory')

  if (!searchSettings.enabled) {
    // Row 52: disabling Search is an explicit operator setting, not a
    // failure — an observation, never a card (three-outcomes cutover).
    return healthObserved([healthWarning({
      key: 'engine.enabled',
      summary: 'Search is disabled.',
      detail: 'Search-dependent features cannot query indexes until Search is enabled (`bakin settings set search.settings.enabled true`).',
      evidence: { enabled: false, adapter },
    })])
  }

  const observations: HealthObservationInput[] = []
  let service: import('../../../../src/core/search-adapter-factory').SearchAdapterServiceStatus
  try {
    service = getSearchAdapterServiceStatus(adapter, searchSettings)
  } catch (err) {
    return healthObserved([healthUnknown({
      key: 'engine.supervision', summary: 'Search service ownership could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
    }), ...await safeOutboxObservations(true)])
  }
  if (service.refusal) {
    const { reason, detail, remediation } = service.refusal
    const label = remediation === 'retry' ? 'Wait for the service change' : 'Configure isolated search'
    const guidance = remediation === 'configure-endpoint'
      ? 'Set search.settings.url to an independently managed isolated endpoint, then restart Bakin.'
      : 'Retry after the service change finishes.'
    return healthObserved([healthError({
      key: 'engine.supervision', summary: 'Search is unavailable for this home.', detail,
      evidence: { mode: service.mode, provisioned: false, reason },
      incident: {
        key: 'service-ownership', title: 'Search service access needs attention',
        class: 'policy_denial', disposition: 'action_required',
        impact: remediation === 'install'
          ? 'Queries are unavailable; queued writes remain in this home’s durable journal.'
          : `Queries are unavailable; queued writes remain in this home’s durable journal. ${detail} ${guidance}`,
        subject: SEARCH_ENGINE_SUBJECT,
        resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
        // Row 54: claiming is the operator's decision — a one-click repair whose
        // confirmation names the guest alternative; a home that cannot claim
        // decides on its endpoint in Settings.
        ...(remediation === 'install'
          ? { declarationId: 'service-ownership-claim', resolution: { key: 'search-engine-claim', type: 'repair' as const, label: 'Claim Search for this home', actionId: 'search-engine-claim' } }
          : { declarationId: 'service-ownership', resolution: { key: 'search-service-access', type: 'human' as const, needs: 'decision' as const, label, href: '/settings?tab=system' } }),
      },
    }), ...await safeOutboxObservations(true)])
  }
  if (service.mode !== 'guest') {
    if (!isSearchAdapterInstalled(adapter)) {
      observations.push(healthError({
        key: 'engine.binary',
        summary: 'Search engine binary is missing.',
        evidence: { adapter, installed: false },
        incident: {
          key: 'binary-missing',
          title: 'Search engine is not installed',
          impact: 'Search cannot start or answer queries without its configured engine binary.',
          disposition: 'action_required',
          subject: SEARCH_ENGINE_SUBJECT,
          declarationId: 'binary-missing',
          resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
          resolution: { key: 'install-search', type: 'repair', label: 'Install Search', actionId: 'search-engine-install' },
        },
      }))
      observations.push(...await safeOutboxObservations())
      return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
    }
    observations.push(healthHealthy({
      key: 'engine.binary',
      summary: 'Search engine binary is installed.',
      evidence: { adapter, installed: true },
    }))
  }

  // Supervision status (D3): who keeps the engine alive, and is the unit
  // provisioned? A missing unit means nothing restarts the engine after a
  // crash — `bakin install search` provisions it.
  try {
    if (!service.provisioned) {
      observations.push(healthWarning({
        key: 'engine.supervision',
        summary: 'Search engine service is not provisioned.',
        detail: `${service.mode}: ${service.detail ?? 'Managed service unit is missing.'}`,
        evidence: { mode: service.mode, provisioned: false },
        incident: {
          key: 'service-unprovisioned',
          title: 'Search engine is not supervised',
          impact: 'Search may stay offline after a crash or host restart.',
          disposition: 'action_required',
          subject: SEARCH_ENGINE_SUBJECT,
          declarationId: 'service-unprovisioned',
          resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
          resolution: { key: 'install-search-service', type: 'repair', label: 'Provision the Search service', actionId: 'search-engine-install' },
        },
      }))
    } else {
      observations.push(healthHealthy({
        key: 'engine.supervision',
        summary: service.mode === 'guest' ? 'Search engine is externally managed.' : `Search engine is supervised via ${service.mode}.`,
        detail: service.detail,
        evidence: { mode: service.mode, provisioned: true },
      }))
    }
  } catch (err) {
    observations.push(healthUnknown({
      key: 'engine.supervision',
      summary: 'Search engine supervision could not be verified.',
      detail: `${err instanceof Error ? err.message : String(err)} Health cannot confirm whether the engine will recover from a crash or host restart.`,
    }))
  }

  // Ask the LIVE adapter instead of probing a hardcoded HTTP endpoint: the
  // old check hit the pre-0.2 `/api/v1/status` path, which the v0.2 zig
  // server does not serve — so a perfectly healthy instance reported
  // "connection failed" as a doctor ERROR on every run. available() also
  // reflects a crashed/supervised child, which a raw port probe cannot.
  const { getAppServices } = await import('../../../../src/core/app-services')
  try {
    if (await getAppServices().search.available()) {
      observations.push(healthHealthy({
        key: 'engine.connection',
        summary: 'Search engine is connected.',
        evidence: { available: true },
      }))
    } else {
      observations.push(healthError({
        key: 'engine.connection',
        summary: 'Search engine is unavailable.',
        detail: 'Search is enabled, but the live adapter cannot reach the engine.',
        evidence: { available: false },
        incident: {
          key: 'engine-unavailable',
          title: 'Search engine is unavailable',
          impact: service.mode === 'guest'
            ? 'Queries degrade or fail while writes wait in the durable journal. The configured external search endpoint is not answering — check it where it runs.'
            : 'Queries degrade or fail while writes wait in the durable journal.',
          disposition: 'action_required',
          subject: SEARCH_ENGINE_SUBJECT,
          resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
          // Row 57: Bakin restarts its own engine; a guest endpoint is not
          // ours to restart — the operator decides at the endpoint setting.
          ...(service.mode === 'guest'
            ? { declarationId: 'engine-unavailable-guest', resolution: { key: 'inspect-engine', type: 'human' as const, needs: 'decision' as const, label: 'Check the external search endpoint', href: '/settings?tab=system' } }
            : { declarationId: 'engine-unavailable', resolution: { key: 'inspect-engine', type: 'repair' as const, label: 'Restore the Search engine', actionId: 'search-engine-restart' } }),
        },
      }))
    }
  } catch (err) {
    observations.push(healthUnknown({
      key: 'engine.connection',
      summary: 'Search engine connection could not be verified.',
      detail: `${err instanceof Error ? err.message : String(err)} Health cannot confirm whether indexed queries are available.`,
    }))
  }
  observations.push(...await embedderCapabilityObservations())
  observations.push(...await checkSearchIndexObservations())
  observations.push(...await safeOutboxObservations())
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

/**
 * Declared content-type legs vs what the adapter's embedder settings can
 * actually serve. A disabled embedder now degrades tables to keyword-only
 * (never a broken create), but that degrade must be VISIBLE: an operator
 * who turned off the visual embedder — or inherited a config that did —
 * should learn it from Health, not from silently worse media search
 * (2026-07-21 field incident: a disabled visual embedder was invisible
 * until every media-capable table failed to build).
 */
async function embedderCapabilityObservations(): Promise<HealthObservationInput[]> {
  try {
    const { getAppServices } = await import('../../../../src/core/app-services')
    const { getRegistry } = await import('../../../../src/core/search-registry')
    const caps = getAppServices().search.capabilities()
    const wantsMedia: string[] = []
    for (const def of getRegistry().contentTypes.values()) {
      if ((def.indexes ?? []).some((idx) => idx.mediaUrlField)) wantsMedia.push(def.table)
    }
    const observations: HealthObservationInput[] = []
    if (!caps.legs.includes('text-embedding')) {
      observations.push(healthWarning({
        key: 'embedders.text',
        summary: 'Semantic text search is disabled by embedder settings.',
        detail: 'The default text embedder is disabled or misconfigured; all tables serve keyword-only results. Re-enable the default embedder in Search settings (provider, model, dimension), then reindex.',
        evidence: { capabilityLegs: caps.legs },
      }))
    }
    if (wantsMedia.length > 0 && !caps.legs.includes('media-embedding')) {
      observations.push(healthWarning({
        key: 'embedders.media',
        summary: `Media search is disabled for ${wantsMedia.length} content type${wantsMedia.length === 1 ? '' : 's'} that declare it.`,
        detail: `The visual embedder is disabled or misconfigured; ${wantsMedia.join(', ')} serve keyword/text-only results. Re-enable the visual embedder in Search settings, then reindex the affected content types.`,
        evidence: { capabilityLegs: caps.legs, contentTypes: wantsMedia.slice(0, 50) },
      }))
    }
    return observations
  } catch (err) {
    return [healthUnknown({
      key: 'embedders.capabilities',
      summary: 'Embedder capability coverage could not be verified.',
      detail: `${err instanceof Error ? err.message : String(err)} Health cannot confirm whether declared search legs are actually served.`,
    })]
  }
}

function boundedTableNames(names: readonly string[]): string[] {
  return names.slice(0, 50).map((name) => name.slice(0, 200))
}

function tableResourceId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 128) || 'unknown'
}

/** Cheap registered-table snapshot that absorbed Memory's former search-tables check. */
export async function checkSearchIndexObservations(
  readSearchHealth?: () => Promise<SearchHealthSnapshot>,
): Promise<HealthObservationInput[]> {
  try {
    const health = readSearchHealth
      ? await readSearchHealth()
      : await (await import('../../../../src/core/search-reindex')).getSearchHealth()
    if (!health.enabled || health.engineReachable === false) {
      return [healthUnknown({
        key: 'indexes.availability',
        summary: 'Search index health could not be verified.',
        detail: !health.enabled
          ? 'Search is disabled in settings.'
          : 'Search is enabled, but the engine is unreachable — index health cannot be read until it answers.',
      })]
    }

    if (health.tables.length === 0) {
      return [healthWarning({
        key: 'indexes.tables',
        summary: 'No Search content types are registered.',
        detail: 'Plugins may not have activated their Search indexes, so indexed content cannot be discovered.',
        evidence: { tableCount: 0, totalDocuments: 0, emptyTables: [], unreadableTables: [], unhealthyTables: [] },
      })]
    }

    const unreadableTables = health.tables.filter((table) => table.docCount === null).map((table) => table.logical)
    const unhealthyTables = health.tables.filter((table) => !table.healthy).map((table) => table.logical)
    const emptyTables = health.tables.filter((table) => table.docCount === 0).map((table) => table.logical)
    const totalDocuments = health.tables.reduce((total, table) => total + (table.docCount ?? 0), 0)
    const evidence = {
      tableCount: health.tables.length,
      totalDocuments,
      emptyTables: boundedTableNames(emptyTables),
      unreadableTables: boundedTableNames(unreadableTables),
      unhealthyTables: boundedTableNames(unhealthyTables),
    }
    // Scarred-but-converged legs (#845): historical fatal counters on
    // serving legs. Advisory-grade — the table stays healthy; the rebuild
    // repair is the one path that clears an engine-cumulative counter.
    const scarredTables = health.tables.filter(
      (table) => table.healthy && table.legs.some((leg) => leg.scar),
    )
    const scarObservations = scarredTables.length > 0
      ? [healthWarning({
          key: 'indexes.scars',
          summary: `${scarredTables.length} Search table${scarredTables.length === 1 ? ' carries' : 's carry'} a historical enrichment failure scar (converged and serving).`,
          detail: scarredTables
            .map((table) => `${table.logical}: ${table.legs.filter((leg) => leg.scar).map((leg) => `${leg.name} (${leg.scar!.fatalCount} fatal)`).join(', ')}`)
            .join('; ')
            .slice(0, 1_000),
          evidence: { scarredTables: boundedTableNames(scarredTables.map((table) => table.logical)) },
          incident: {
            key: 'table-scars',
            title: 'Search legs carry historical enrichment scars',
            class: 'cleanup_backlog',
            impact: 'Purely historical — the legs are converged and serving. A blue/green rebuild clears the engine-cumulative counters.',
            disposition: 'advisory',
            // One incident covers every scarred table: the engine is the subject, the tables are its resources.
            subject: SEARCH_ENGINE_SUBJECT,
            declarationId: 'table-scars',
            resources: scarredTables.slice(0, 50).map((table) => ({
              kind: 'search_table' as const,
              id: tableResourceId(table.logical),
              label: table.logical.slice(0, 120),
            })),
            resolution: {
              key: 'rebuild-scarred-tables',
              type: 'repair',
              label: 'Rebuild scarred tables blue/green',
              actionId: 'search-scar-rebuild',
            },
          },
        })]
      : []

    const concerning = [...new Set([...unreadableTables, ...unhealthyTables])]
    if (concerning.length > 0) {
      return [...scarObservations, healthWarning({
        key: 'indexes.tables',
        summary: `${concerning.length} of ${health.tables.length} Search table${health.tables.length === 1 ? '' : 's'} could not be fully verified.`,
        detail: unreadableTables.length > 0
          ? `${unreadableTables.length} table${unreadableTables.length === 1 ? ' has' : 's have'} unreadable document counts.`
          : 'One or more Search index legs reported an unhealthy state.',
        evidence,
      })]
    }

    return [...scarObservations, healthHealthy({
      key: 'indexes.tables',
      summary: `${health.tables.length} Search table${health.tables.length === 1 ? '' : 's'} contain ${totalDocuments} indexed document${totalDocuments === 1 ? '' : 's'}.`,
      evidence,
    })]
  } catch (error) {
    return [healthUnknown({
      key: 'indexes.availability',
      summary: 'Search index health could not be verified.',
      detail: (error instanceof Error ? error.message : String(error)).slice(0, 4_000),
    })]
  }
}

async function safeOutboxObservations(accessRefused = false): Promise<HealthObservationInput[]> {
  try {
    return await checkSearchOutboxObservations({ accessRefused })
  } catch (err) {
    return [healthUnknown({
      key: 'journal.status',
      summary: 'Search write journal could not be verified.',
      detail: `${err instanceof Error ? err.message : String(err)} Health cannot confirm whether queued index writes are draining.`,
    })]
  }
}

// ---------------------------------------------------------------------------
// Scar repair (#845) — same blue/green rebuild engine as the spin repair. The
// plan names every scarred table concretely from the CURRENT report's scar
// observation, and apply rebuilds exactly the tables the approved items name —
// a frozen approval can never drift to a different table.
// ---------------------------------------------------------------------------

async function scarredTablesFromReport(): Promise<string[]> {
  const { getHealthReport } = await import('../../../../src/core/doctor-report-cache')
  const observation = getHealthReport().observations.find((row) => row.checkId === 'health.search' && row.key === 'indexes.scars')
  const tables = observation?.evidence?.scarredTables
  return Array.isArray(tables) ? tables.filter((table): table is string => typeof table === 'string') : []
}

export function searchScarRepair(): HealthRepairActionDefinition {
  return {
    id: 'search-scar-rebuild',
    name: 'Rebuild scarred Search indexes',
    // Row 64: blue/green keeps content — no effects, self-heal (was destructive).
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
    mutation: 'rebuild',
    resources: ['search-engine'],
    operationPlan: () => REBUILD_PLAN,
    async plan(target) {
      const tables = await scarredTablesFromReport()
      return [{
        id: 'rebuild-scarred-indexes',
        actionId: 'search-scar-rebuild',
        title: 'Rebuild scarred search tables (blue/green)',
        reason: 'Converged legs carry historical enrichment failure counters; a fresh generation clears them.',
        ...repairTargetSelection(target),
        changes: tables.map((table) => ({
          kind: 'other' as const,
          target: table,
          action: 'update' as const,
          description: 'Backfill a fresh physical table from source data and flip on convergence; queries keep answering from the current table throughout.',
        })),
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      const { rebuildTables, rebuildTargets } = await import('./search-spin')
      const targets = rebuildTargets(items)
      try {
        const { outcomes, failed } = await rebuildTables(targets, op)
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: failed > 0 ? 'failed' as const : 'applied' as const,
          message: targets.length === 0 ? 'Nothing needs rebuilding.' : outcomes.join('; '),
          affectedCheckIds: ['health.search'],
          changes: item.changes,
        }))
      } catch (err) {
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: err instanceof Error ? err.message : String(err),
          affectedCheckIds: ['health.search'],
          changes: item.changes,
        }))
      }
    },
  }
}
