import { z } from 'zod'

import {
  canonicalHealthIncidentSchema,
  canonicalHealthObservationSchema,
  searchReadinessResponseSchema,
  searchReadinessSchema,
} from './route-schemas'

export { searchReadinessResponseSchema }

const nonEmptyString = z.string().min(1)
const nonNegativeInteger = z.number().int().nonnegative()
const nullableEpochMs = nonNegativeInteger.nullable()

const searchHealthLegSchema = z.object({
  name: nonEmptyString,
  totalIndexed: nonNegativeInteger,
  rebuilding: z.boolean(),
  pending: nonNegativeInteger.optional(),
  error: z.string().optional(),
}).passthrough()

const searchHealthTableSchema = z.object({
  logical: nonEmptyString,
  physical: nonEmptyString,
  schemaVersion: nonNegativeInteger,
  state: z.enum(['active', 'migrating']),
  phase: z.string().nullable(),
  pluginId: nonEmptyString,
  docCount: nonNegativeInteger.nullable(),
  lastIndexedAt: nullableEpochMs,
  lastRebuildAt: nullableEpochMs,
  journalPending: nonNegativeInteger,
  legs: z.array(searchHealthLegSchema),
  healthy: z.boolean(),
}).passthrough()

const searchOutboxHealthSchema = z.object({
  pending: nonNegativeInteger,
  quarantined: nonNegativeInteger,
  oldestPendingAt: nullableEpochMs,
}).passthrough()

export const searchStatusResponseSchema = z.object({
  enabled: z.boolean(),
  outbox: searchOutboxHealthSchema.optional(),
  tables: z.array(searchHealthTableSchema),
}).passthrough()

const telemetryMetricSchema = z.object({
  count: nonNegativeInteger,
  errors: nonNegativeInteger,
  medianMs: z.number().nonnegative().nullable().optional(),
}).passthrough().superRefine((metric, context) => {
  if (metric.errors > metric.count) {
    context.addIssue({
      code: 'custom',
      path: ['errors'],
      message: 'errors cannot exceed count',
      input: metric,
    })
  }
})

const telemetryWindowSchema = z.object({
  query: telemetryMetricSchema,
  drain: telemetryMetricSchema,
  enrich: telemetryMetricSchema,
}).passthrough()

const searchEnrichmentCoverageSchema = z.object({
  total: nonNegativeInteger,
  enriched: nonNegativeInteger,
  missing: nonNegativeInteger,
  stale: nonNegativeInteger,
  failed: nonNegativeInteger,
  skipped: nonNegativeInteger,
}).passthrough().superRefine((coverage, context) => {
  const classified = coverage.enriched
    + coverage.missing
    + coverage.stale
    + coverage.failed
    + coverage.skipped
  if (classified !== coverage.total) {
    context.addIssue({
      code: 'custom',
      message: 'enrichment coverage must reconcile with total',
      input: coverage,
    })
  }
})

const searchEnrichmentSchema = z.object({
  depth: nonNegativeInteger.optional(),
  // Older plugin builds reported a count; current builds report whether the
  // single-flight pump is active. Both are safe for consumers that only show
  // queue depth and coverage.
  running: z.union([z.boolean(), nonNegativeInteger]).optional(),
  processed: nonNegativeInteger.optional(),
  failed: nonNegativeInteger.optional(),
  failedRecent: nonNegativeInteger.optional(),
  skipped: nonNegativeInteger.optional(),
  coverage: searchEnrichmentCoverageSchema.optional(),
}).passthrough()

const telemetryOutboxSchema = z.object({
  pending: nonNegativeInteger,
  quarantined: nonNegativeInteger,
  inflight: nonNegativeInteger.optional(),
  oldestPendingEnqueuedAt: nullableEpochMs.optional(),
}).passthrough()

const searchTelemetryBaseSchema = z.object({
  windows: z.object({
    '1h': telemetryWindowSchema,
    '24h': telemetryWindowSchema,
  }).passthrough(),
  outbox: telemetryOutboxSchema,
  enrichment: searchEnrichmentSchema.nullable(),
}).passthrough()

/** Exact response emitted by the current Health route. */
export const searchTelemetryResponseSchema = searchTelemetryBaseSchema.extend({
  reportId: nonEmptyString,
  readiness: searchReadinessSchema,
  observations: z.array(canonicalHealthObservationSchema),
  incidents: z.array(canonicalHealthIncidentSchema),
}).passthrough()

const legacySearchTelemetryResponseSchema = searchTelemetryBaseSchema.extend({
  // These fields were introduced atomically. A rolling-restart client may
  // consume the older payload, but a partial evidence bundle is never valid.
  reportId: z.never().optional(),
  readiness: z.never().optional(),
  observations: z.never().optional(),
  incidents: z.never().optional(),
}).passthrough()

export const searchTelemetryClientResponseSchema = z.union([
  searchTelemetryResponseSchema,
  legacySearchTelemetryResponseSchema,
])

const systemRegistryPluginSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  version: nonEmptyString,
  description: z.string(),
  source: z.enum(['built-in', 'user']),
  // Registry snapshots before failed-plugin visibility contained active rows
  // only. Defaulting those old rows is therefore truthful and deterministic.
  status: z.enum(['active', 'failed']).default('active'),
  routes: nonNegativeInteger,
  errorCode: nonEmptyString.optional(),
  errorMessage: z.string().optional(),
  missingDependencies: z.array(nonEmptyString).optional(),
}).passthrough()

export const systemRegistryResponseSchema = z.object({
  plugins: z.array(systemRegistryPluginSchema),
}).passthrough()

const installedPluginSchema = z.object({
  version: z.string().optional(),
  commitSha: z.string().optional(),
  remoteHeadSha: z.string().optional(),
  lastChecked: z.string().optional(),
  newPermissions: z.array(nonEmptyString).optional(),
}).passthrough()

const systemPluginManifestEntrySchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  version: nonEmptyString,
  latestVersion: nonEmptyString.nullable().optional(),
  source: z.enum(['core', 'github', 'local']),
  installed: installedPluginSchema.nullable(),
  upgradeAvailable: z.boolean(),
  staleHintDays: nonNegativeInteger.nullable(),
  status: z.enum(['active', 'failed']).optional(),
  errorCode: nonEmptyString.optional(),
  errorMessage: z.string().optional(),
  missingDependencies: z.array(nonEmptyString).optional(),
}).passthrough()

export const systemPluginManifestClientSchema = z.object({
  plugins: z.array(systemPluginManifestEntrySchema),
}).passthrough()

export type SearchStatusResponse = z.output<typeof searchStatusResponseSchema>
export type SearchTelemetryResponse = z.output<typeof searchTelemetryClientResponseSchema>
export type SystemRegistryPlugin = z.output<typeof systemRegistryPluginSchema>
export type SystemRegistryData = z.output<typeof systemRegistryResponseSchema>
export type SystemPluginManifestEntry = z.output<typeof systemPluginManifestEntrySchema>
export type SystemPluginManifestData = z.output<typeof systemPluginManifestClientSchema>
