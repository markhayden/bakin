import { describe, expect, it } from 'bun:test'

import {
  searchStatusResponseSchema,
  searchTelemetryClientResponseSchema,
  searchTelemetryResponseSchema,
  systemRegistryResponseSchema,
} from '../../../plugins/health/lib/system-route-schemas'

function searchTable() {
  return {
    logical: 'bakin_assets',
    physical: 'bakin_assets_v3',
    schemaVersion: 3,
    state: 'active' as const,
    phase: null,
    pluginId: 'assets',
    docCount: 12,
    lastIndexedAt: 1_752_600_000_000,
    lastRebuildAt: null,
    journalPending: 0,
    legs: [{ name: 'text', totalIndexed: 12, rebuilding: false }],
    healthy: true,
  }
}

function telemetry() {
  const metric = { count: 4, errors: 1, medianMs: 12 }
  return {
    windows: {
      '1h': { query: metric, drain: metric, enrich: metric },
      '24h': { query: metric, drain: metric, enrich: metric },
    },
    outbox: {
      pending: 2,
      inflight: 1,
      quarantined: 0,
      oldestPendingEnqueuedAt: 1_752_600_000_000,
    },
    enrichment: {
      depth: 2,
      running: true,
      processed: 8,
      failed: 1,
      skipped: 0,
      coverage: { total: 10, enriched: 8, missing: 1, stale: 0, failed: 1, skipped: 0 },
    },
    enrichmentEvidence: { status: 'available' as const },
  }
}

function readiness() {
  return {
    status: 'unknown' as const,
    summary: 'Search has not been checked yet.',
    observedAt: null,
    staleAt: null,
    stages: ['engine', 'queries', 'indexes', 'journal'].map((key) => ({
      key,
      label: key[0]!.toUpperCase() + key.slice(1),
      status: 'unknown' as const,
      summary: 'Not checked.',
      observedAt: null,
      staleAt: null,
      observationIds: [],
    })),
    incidentIds: [],
  }
}

function currentTelemetry() {
  return {
    ...telemetry(),
    reportId: 'report-1',
    readiness: readiness(),
    observations: [],
    incidents: [],
  }
}

describe('System route schemas', () => {
  it('validates nested Search status evidence while allowing additive adapter fields', () => {
    const current = {
      enabled: true,
      tables: [{ ...searchTable(), adapterDetail: 'future-field' }],
      adapterVersion: 2,
    }
    const malformed = {
      enabled: true,
      tables: [{ ...searchTable(), legs: [{ name: 'text', totalIndexed: -1, rebuilding: false }] }],
    }

    expect(searchStatusResponseSchema.safeParse(current).success).toBe(true)
    expect(searchStatusResponseSchema.safeParse(malformed).success).toBe(false)
  })

  it('rejects impossible Search telemetry counters', () => {
    const malformed = currentTelemetry()
    malformed.windows['1h'].query.errors = 5

    expect(searchTelemetryResponseSchema.safeParse(currentTelemetry()).success).toBe(true)
    expect(searchTelemetryResponseSchema.safeParse(malformed).success).toBe(false)
  })

  it('requires canonical evidence on the route while accepting an older complete client payload', () => {
    const current = currentTelemetry()
    const { enrichmentEvidence: _enrichmentEvidence, ...legacyTelemetry } = telemetry()
    const partialEvidence = { ...legacyTelemetry, reportId: 'report-1' }

    expect(searchTelemetryResponseSchema.safeParse(current).success).toBe(true)
    expect(searchTelemetryResponseSchema.safeParse(legacyTelemetry).success).toBe(false)
    expect(searchTelemetryClientResponseSchema.safeParse(legacyTelemetry).success).toBe(true)
    expect(searchTelemetryClientResponseSchema.safeParse(partialEvidence).success).toBe(false)
  })

  it('accepts an older registry entry deliberately and normalizes its missing status', () => {
    const parsed = systemRegistryResponseSchema.parse({
      plugins: [{
        id: 'notes',
        name: 'Notes',
        version: '1.0.0',
        description: 'Notes integration.',
        source: 'user',
        routes: 2,
      }],
    })

    expect(parsed.plugins[0]?.status).toBe('active')
  })

  it('rejects malformed nested registry failure evidence', () => {
    const malformed = {
      plugins: [{
        id: 'broken',
        name: 'Broken',
        version: '1.0.0',
        description: 'Broken plugin.',
        source: 'user',
        status: 'failed',
        routes: 0,
        missingDependencies: [42],
      }],
    }

    expect(systemRegistryResponseSchema.safeParse(malformed).success).toBe(false)
  })
})
