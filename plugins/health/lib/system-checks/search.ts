/**
 * System check — search adapter binary install + connection.
 *
 * Migrated out of src/core/doctor.ts (#139 C7). When search is
 * disabled, the binary check is informational; when enabled, a missing
 * binary or unreachable daemon surfaces as an error.
 */
import { getSettings } from '../../../../src/core/settings'
import { healthError, healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthObservationInput, SearchHealthSnapshot } from '@makinbakin/sdk'
import { checkSearchOutboxObservations } from './search-outbox'

export async function checkSearchAdapter(): Promise<HealthCheckRunInput> {
  const settings = getSettings()
  const adapter = settings.search.adapter
  const searchSettings = settings.search.settings
  // Lazy import keeps adapter helper setup off the cold path when the
  // check returns early (matches the original migration's pattern).
  const { isSearchAdapterInstalled } = await import('../../../../src/core/search-adapter-factory')

  if (!searchSettings.enabled) {
    return healthObserved([healthError({
      key: 'engine.enabled',
      summary: 'Search is disabled.',
      detail: 'Search-dependent features cannot query indexes until Search is enabled.',
      evidence: { enabled: false, adapter },
      incident: {
        key: 'search-disabled',
        title: 'Search is disabled',
        impact: 'Agents and user interfaces cannot use indexed search.',
        disposition: 'action_required',
        resources: [{ kind: 'setting', id: 'search.settings.enabled', label: 'Search enabled setting' }],
        resolution: {
          key: 'enable-search',
          type: 'instructions',
          label: 'Enable Search',
          steps: ['Enable Search, then rerun Health.'],
          command: 'bakin settings set search.settings.enabled true',
        },
      },
    })])
  }

  const observations: HealthObservationInput[] = []
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
        resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
        resolution: {
          key: 'install-search',
          type: 'instructions',
          label: 'Install Search',
          steps: ['Install the configured Search engine and its managed service, then rerun Health.'],
          command: 'bakin install search',
        },
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

  // Supervision status (D3): who keeps the engine alive, and is the unit
  // provisioned? A missing unit means nothing restarts the engine after a
  // crash — `bakin install search` provisions it.
  try {
    const { getSearchAdapterServiceStatus } = await import('../../../../src/core/search-adapter-factory')
    const service = getSearchAdapterServiceStatus(adapter, searchSettings)
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
          resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
          resolution: {
            key: 'install-search-service',
            type: 'instructions',
            label: 'Provision the Search service',
            steps: ['Install the managed Search service, then rerun Health.'],
            command: 'bakin install search',
          },
        },
      }))
    } else {
      observations.push(healthHealthy({
        key: 'engine.supervision',
        summary: `Search engine is supervised via ${service.mode}.`,
        detail: service.detail,
        evidence: { mode: service.mode, provisioned: true },
      }))
    }
  } catch (err) {
    observations.push(healthUnknown({
      key: 'engine.supervision',
      summary: 'Search engine supervision could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'supervision-unknown',
        title: 'Search engine supervision is unknown',
        impact: 'Health cannot confirm whether the engine will recover from a crash or host restart.',
        disposition: 'watch',
        resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
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
          impact: 'Queries degrade or fail while writes wait in the durable journal.',
          disposition: 'action_required',
          resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
          resolution: {
            key: 'inspect-engine',
            type: 'instructions',
            label: 'Restore the Search engine',
            steps: ['Inspect Search engine lines in ~/.bakin/logs/server.log, restore the service, then rerun Health.'],
          },
        },
      }))
    }
  } catch (err) {
    observations.push(healthUnknown({
      key: 'engine.connection',
      summary: 'Search engine connection could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'connection-unknown',
        title: 'Search engine connection is unknown',
        impact: 'Health cannot confirm whether indexed queries are available.',
        disposition: 'watch',
        resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    }))
  }
  observations.push(...await checkSearchIndexObservations())
  observations.push(...await safeOutboxObservations())
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
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
    if (!health.enabled) {
      return [healthUnknown({
        key: 'indexes.availability',
        summary: 'Search index health could not be verified.',
        detail: 'The live Search health snapshot was unavailable.',
        incident: {
          key: 'indexes-unavailable',
          title: 'Search index health is unknown',
          impact: 'Health cannot confirm that registered content types have readable indexes.',
          disposition: 'watch',
          resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
          resolution: { key: 'rerun', type: 'rerun', label: 'Check Search indexes again' },
        },
      })]
    }

    if (health.tables.length === 0) {
      return [healthWarning({
        key: 'indexes.tables',
        summary: 'No Search content types are registered.',
        evidence: { tableCount: 0, totalDocuments: 0, emptyTables: [], unreadableTables: [], unhealthyTables: [] },
        incident: {
          key: 'no-indexes',
          title: 'Search has no registered content types',
          impact: 'Plugins may not have activated their Search indexes, so indexed content cannot be discovered.',
          disposition: 'watch',
          resources: [{ kind: 'service', id: 'search-registry', label: 'Search registry' }],
          resolution: { key: 'rerun', type: 'rerun', label: 'Check Search indexes again' },
        },
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
    const concerning = [...new Set([...unreadableTables, ...unhealthyTables])]
    if (concerning.length > 0) {
      return [healthWarning({
        key: 'indexes.tables',
        summary: `${concerning.length} of ${health.tables.length} Search table${health.tables.length === 1 ? '' : 's'} could not be fully verified.`,
        detail: unreadableTables.length > 0
          ? `${unreadableTables.length} table${unreadableTables.length === 1 ? ' has' : 's have'} unreadable document counts.`
          : 'One or more Search index legs reported an unhealthy state.',
        evidence,
        incident: {
          key: 'table-health',
          title: 'Search table health needs attention',
          impact: 'Some registered content may be missing from Search or served with incomplete index coverage.',
          disposition: 'watch',
          resources: concerning.slice(0, 50).map((name) => ({
            kind: 'search_table' as const,
            id: tableResourceId(name),
            label: name.slice(0, 120),
          })),
          resolution: { key: 'rerun', type: 'rerun', label: 'Check Search indexes again' },
        },
      })]
    }

    return [healthHealthy({
      key: 'indexes.tables',
      summary: `${health.tables.length} Search table${health.tables.length === 1 ? '' : 's'} contain ${totalDocuments} indexed document${totalDocuments === 1 ? '' : 's'}.`,
      evidence,
    })]
  } catch (error) {
    return [healthUnknown({
      key: 'indexes.availability',
      summary: 'Search index health could not be verified.',
      detail: (error instanceof Error ? error.message : String(error)).slice(0, 4_000),
      incident: {
        key: 'indexes-unavailable',
        title: 'Search index health is unknown',
        impact: 'Health cannot confirm that registered content types have readable indexes.',
        disposition: 'watch',
        resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Check Search indexes again' },
      },
    })]
  }
}

async function safeOutboxObservations(): Promise<HealthObservationInput[]> {
  try {
    return await checkSearchOutboxObservations()
  } catch (err) {
    return [healthUnknown({
      key: 'journal.status',
      summary: 'Search write journal could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'journal-unknown',
        title: 'Search write journal status is unknown',
        impact: 'Health cannot confirm whether queued index writes are draining.',
        disposition: 'watch',
        resources: [{ kind: 'system', id: 'search-journal', label: 'Search write journal' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })]
  }
}
