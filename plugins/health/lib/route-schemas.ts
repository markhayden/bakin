/** Exact HTTP schemas for the canonical Health report and repair boundaries. */
import { z } from 'zod'
import {
  actionIncidentInputSchema,
  healthIncidentInputSchema,
  healthResourceSchema,
  healthResolutionSchema,
  watchIncidentInputSchema,
} from '../../../src/core/health-contract'

const isoDateTime = z.iso.datetime({ offset: true })
const nonEmptyString = z.string().min(1)
const searchReadinessStageKeys = ['engine', 'queries', 'indexes', 'journal'] as const
// Producer evidence is validated by the stricter bounded/redacting JSON
// schema in health-contract.ts before it reaches the report cache. At this
// response-only boundary, JSON serialization is the remaining wire guarantee.
// `z.json()` emits document-root refs that cannot be safely embedded inside an
// OpenAPI operation, so describe object values without recursive local refs.
const healthEvidenceResponseSchema = z.record(z.string(), z.unknown())

function indexUniqueRows<T>(
  rows: readonly T[],
  idOf: (row: T) => string,
  path: string,
  label: string,
  context: z.core.$RefinementCtx,
): Map<string, { index: number; row: T }> {
  const byId = new Map<string, { index: number; row: T }>()
  rows.forEach((row, index) => {
    const id = idOf(row)
    const first = byId.get(id)
    if (first !== undefined) {
      context.addIssue({
        code: 'custom',
        path: [path, index, label],
        message: `Duplicate ${label}; first declared at ${path}.${first.index}.${label}`,
        input: id,
      })
      return
    }
    byId.set(id, { index, row })
  })
  return byId
}

function reconcileSummary<T extends Record<string, number>>(
  actual: T,
  expected: T,
  path: string,
  source: string,
  context: z.core.$RefinementCtx,
): void {
  for (const key of Object.keys(expected) as Array<keyof T>) {
    if (actual[key] !== expected[key]) {
      context.addIssue({
        code: 'custom',
        path: ['summary', path, String(key)],
        message: `${String(key)} must reconcile with the report's ${source}`,
        input: actual[key],
      })
    }
  }
}

export const healthOwnerSchema = z.object({
  kind: z.enum(['plugin', 'adapter', 'core']),
  id: nonEmptyString,
  label: nonEmptyString,
}).strict()

export const healthGroupSchema = z.object({
  key: nonEmptyString,
  label: nonEmptyString,
}).strict()

const canonicalObservationBase = {
  id: nonEmptyString,
  key: nonEmptyString,
  summary: nonEmptyString,
  detail: nonEmptyString.optional(),
  sourceObservedAt: isoDateTime.optional(),
  evidence: healthEvidenceResponseSchema.optional(),
  checkId: nonEmptyString,
  checkName: nonEmptyString,
  owner: healthOwnerSchema,
  group: healthGroupSchema,
  checkedAt: isoDateTime,
  observedAt: isoDateTime,
  staleAt: isoDateTime,
  snapshot: z.enum(['current', 'last_known']),
}

const healthyObservationSchema = z.object({
  ...canonicalObservationBase,
  status: z.literal('healthy'),
  incidentId: z.never().optional(),
  incident: z.never().optional(),
}).strict()

const warningObservationSchema = z.object({
  ...canonicalObservationBase,
  status: z.literal('warning'),
  incidentId: nonEmptyString,
  incident: healthIncidentInputSchema,
}).strict()

const errorObservationSchema = z.object({
  ...canonicalObservationBase,
  status: z.literal('error'),
  incidentId: nonEmptyString,
  incident: actionIncidentInputSchema,
}).strict()

const unknownObservationSchema = z.object({
  ...canonicalObservationBase,
  status: z.literal('unknown'),
  incidentId: nonEmptyString,
  incident: watchIncidentInputSchema,
}).strict()

export const canonicalHealthObservationSchema = z.discriminatedUnion('status', [
  healthyObservationSchema,
  warningObservationSchema,
  errorObservationSchema,
  unknownObservationSchema,
])

export const healthCheckExecutionSchema = z.object({
  id: nonEmptyString,
  checkId: nonEmptyString,
  startedAt: isoDateTime,
  completedAt: isoDateTime,
  outcome: z.enum(['observed', 'not_applicable', 'failed', 'invalid']),
  reason: nonEmptyString.optional(),
  error: z.object({ code: nonEmptyString, message: nonEmptyString }).strict().optional(),
}).strict()

export const healthCheckStateSchema = z.object({
  checkId: nonEmptyString,
  checkName: nonEmptyString,
  description: nonEmptyString,
  owner: healthOwnerSchema,
  group: healthGroupSchema,
  maxAgeMs: z.number().int().positive().optional(),
  latestExecution: healthCheckExecutionSchema,
  latestValidSnapshot: z.object({
    executionId: nonEmptyString,
    observations: z.array(canonicalHealthObservationSchema),
  }).strict().optional(),
}).strict()

export const canonicalHealthIncidentSchema = z.object({
  id: nonEmptyString,
  status: z.enum(['warning', 'error', 'unknown']),
  disposition: z.enum(['advisory', 'watch', 'action_required']),
  title: nonEmptyString,
  impact: nonEmptyString,
  resources: z.array(healthResourceSchema),
  resolution: healthResolutionSchema,
  observationIds: z.array(nonEmptyString),
  observedAt: isoDateTime,
  staleAt: isoDateTime,
  stale: z.boolean(),
}).strict()

export const searchReadinessStageSchema = z.object({
  key: z.enum(searchReadinessStageKeys),
  label: nonEmptyString,
  status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable']),
  summary: nonEmptyString,
  observedAt: isoDateTime.nullable(),
  staleAt: isoDateTime.nullable(),
  observationIds: z.array(nonEmptyString),
}).strict()

export const searchReadinessSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
  summary: nonEmptyString,
  observedAt: isoDateTime.nullable(),
  staleAt: isoDateTime.nullable(),
  stages: z.array(searchReadinessStageSchema).length(4),
  incidentIds: z.array(nonEmptyString),
}).strict().superRefine((readiness, context) => {
  const stageKeys = new Set(readiness.stages.map((stage) => stage.key))
  if (
    stageKeys.size !== searchReadinessStageKeys.length
    || searchReadinessStageKeys.some((key) => !stageKeys.has(key))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['stages'],
      message: 'Search readiness must contain engine, queries, indexes, and journal exactly once',
      input: readiness.stages,
    })
  }
})

export const healthReportSchema = z.object({
  id: nonEmptyString,
  revision: z.number().int().nonnegative(),
  generatedAt: isoDateTime,
  overallStatus: z.enum(['healthy', 'needs_attention', 'degraded', 'unknown_stale']),
  lastFullSweep: z.object({
    id: nonEmptyString,
    startedAt: isoDateTime,
    completedAt: isoDateTime,
  }).strict().nullable(),
  checks: z.array(healthCheckStateSchema),
  observations: z.array(canonicalHealthObservationSchema),
  incidents: z.array(canonicalHealthIncidentSchema),
  subsystems: z.object({ search: searchReadinessSchema }).strict(),
  summary: z.object({
    checks: z.object({
      registered: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      invalid: z.number().int().nonnegative(),
      notApplicable: z.number().int().nonnegative(),
    }).strict(),
    incidents: z.object({
      actionRequired: z.number().int().nonnegative(),
      watching: z.number().int().nonnegative(),
      advisory: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
}).strict().superRefine((report, context) => {
  indexUniqueRows(report.checks, (check) => check.checkId, 'checks', 'checkId', context)
  const observationsById = indexUniqueRows(report.observations, (observation) => observation.id, 'observations', 'id', context)
  const incidentsById = indexUniqueRows(report.incidents, (incident) => incident.id, 'incidents', 'id', context)

  report.observations.forEach((observation, index) => {
    if (observation.status === 'healthy') return
    const incident = incidentsById.get(observation.incidentId)?.row
    if (incident === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['observations', index, 'incidentId'],
        message: 'Observation incidentId must reference an incident in this report',
        input: observation.incidentId,
      })
      return
    }
    if (!incident.observationIds.includes(observation.id)) {
      context.addIssue({
        code: 'custom',
        path: ['observations', index, 'incidentId'],
        message: 'The referenced incident must include this observation id',
        input: observation.incidentId,
      })
    }
  })

  report.incidents.forEach((incident, incidentIndex) => {
    const referencedIds = new Set<string>()
    if (incident.observationIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['incidents', incidentIndex, 'observationIds'],
        message: 'An incident must reference at least one observation in this report',
        input: incident.observationIds,
      })
    }
    incident.observationIds.forEach((observationId, observationIndex) => {
      if (referencedIds.has(observationId)) {
        context.addIssue({
          code: 'custom',
          path: ['incidents', incidentIndex, 'observationIds', observationIndex],
          message: 'Incident observation ids must be unique',
          input: observationId,
        })
        return
      }
      referencedIds.add(observationId)
      const observation = observationsById.get(observationId)?.row
      if (observation === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['incidents', incidentIndex, 'observationIds', observationIndex],
          message: 'Incident observationId must reference an observation in this report',
          input: observationId,
        })
      } else if (observation.status === 'healthy' || observation.incidentId !== incident.id) {
        context.addIssue({
          code: 'custom',
          path: ['incidents', incidentIndex, 'observationIds', observationIndex],
          message: 'Referenced observation must point back to this incident',
          input: observationId,
        })
      }
    })
  })

  const expectedCheckSummary = {
    registered: report.checks.length,
    completed: report.checks.filter((check) =>
      check.latestExecution.outcome === 'observed' || check.latestExecution.outcome === 'not_applicable',
    ).length,
    failed: report.checks.filter((check) => check.latestExecution.outcome === 'failed').length,
    invalid: report.checks.filter((check) => check.latestExecution.outcome === 'invalid').length,
    notApplicable: report.checks.filter((check) => check.latestExecution.outcome === 'not_applicable').length,
  }
  reconcileSummary(report.summary.checks, expectedCheckSummary, 'checks', 'check executions', context)

  const expectedIncidentSummary = {
    actionRequired: report.incidents.filter((incident) => incident.disposition === 'action_required').length,
    watching: report.incidents.filter((incident) => incident.disposition === 'watch').length,
    advisory: report.incidents.filter((incident) => incident.disposition === 'advisory').length,
    unknown: report.incidents.filter((incident) => incident.status === 'unknown').length,
  }
  reconcileSummary(report.summary.incidents, expectedIncidentSummary, 'incidents', 'incidents', context)
})

export const healthCheckMetadataSchema = z.object({
  id: nonEmptyString,
  localId: nonEmptyString,
  name: nonEmptyString,
  description: nonEmptyString,
  owner: healthOwnerSchema,
  group: healthGroupSchema,
  maxAgeMs: z.number().int().positive().optional(),
}).strict()

export const healthChecksResponseSchema = z.object({
  checks: z.array(healthCheckMetadataSchema),
}).strict()

export const healthLiveSummarySchema = z.object({
  errors1h: z.object({
    total: z.number().int().nonnegative(),
    byKind: z.object({
      mcp: z.number().int().nonnegative(),
      rest: z.number().int().nonnegative(),
      agent: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
  activeSessions: z.array(z.object({
    agent: nonEmptyString,
    sessions: z.number().int().nonnegative(),
    connectedAt: isoDateTime,
  }).strict()),
  upSince: isoDateTime,
  server: z.object({
    port: z.number().int().nonnegative(),
    pid: z.number().int().positive(),
    nodeVersion: nonEmptyString,
    memoryMB: z.number().nonnegative(),
    totalMemoryMB: z.number().nonnegative(),
  }).strict(),
}).strict()

/** Rolling-restart client contract; null means that live source was unavailable. */
export const healthLiveSummaryClientSchema = z.object({
  errors1h: healthLiveSummarySchema.shape.errors1h.nullable(),
  activeSessions: healthLiveSummarySchema.shape.activeSessions.nullable(),
  upSince: healthLiveSummarySchema.shape.upSince.nullable(),
  server: healthLiveSummarySchema.shape.server.nullable(),
}).passthrough()

export type HealthLiveSummaryClient = z.output<typeof healthLiveSummaryClientSchema>

const incidentTargetSchema = z.object({
  type: z.literal('incidents'),
  reportId: nonEmptyString,
  ids: z.array(nonEmptyString).min(1),
}).strict()
const observationTargetSchema = z.object({
  type: z.literal('observations'),
  reportId: nonEmptyString,
  ids: z.array(nonEmptyString).min(1),
}).strict()
const allActionableTargetSchema = z.object({
  type: z.literal('all_actionable'),
  reportId: nonEmptyString,
}).strict()

export const healthRepairTargetSchema = z.discriminatedUnion('type', [
  incidentTargetSchema,
  observationTargetSchema,
  allActionableTargetSchema,
])

const healthRepairChangeSchema = z.object({
  kind: z.enum(['file', 'setting', 'service', 'runtime', 'task', 'other']),
  target: nonEmptyString,
  action: z.enum(['create', 'update', 'delete', 'install', 'invoke']),
  description: nonEmptyString,
}).strict()

const healthRepairPreconditionSchema = z.object({
  observationId: nonEmptyString,
  executionId: nonEmptyString,
  status: z.enum(['warning', 'error', 'unknown']),
  resolutionKey: nonEmptyString,
}).strict()

export const healthRepairPlanItemSchema = z.object({
  id: nonEmptyString,
  actionId: nonEmptyString,
  title: nonEmptyString,
  reason: nonEmptyString,
  safety: z.enum(['safe', 'manual', 'destructive']),
  incidentIds: z.array(nonEmptyString),
  observationIds: z.array(nonEmptyString),
  preconditions: z.array(healthRepairPreconditionSchema),
  changes: z.array(healthRepairChangeSchema),
}).strict()

export const healthRepairPlanSchema = z.object({
  planId: nonEmptyString,
  basedOnReportId: nonEmptyString,
  target: healthRepairTargetSchema,
  createdAt: isoDateTime,
  expiresAt: isoDateTime,
  items: z.array(healthRepairPlanItemSchema),
}).strict()

export const healthRepairPlanRequestSchema = z.object({
  target: healthRepairTargetSchema,
}).strict()

export const healthRepairApplyRequestSchema = z.object({
  planId: nonEmptyString,
  itemIds: z.array(nonEmptyString).min(1),
  confirmedItemIds: z.array(nonEmptyString),
}).strict()

const healthRepairApplyResultSchema = z.object({
  itemId: nonEmptyString,
  actionId: nonEmptyString,
  status: z.enum(['applied', 'skipped', 'failed']),
  message: nonEmptyString,
  affectedCheckIds: z.array(nonEmptyString),
  changes: z.array(healthRepairChangeSchema),
}).strict()

export const healthRepairApplyReportSchema = z.object({
  planId: nonEmptyString,
  basedOnReportId: nonEmptyString,
  results: z.array(healthRepairApplyResultSchema),
  affectedCheckIds: z.array(nonEmptyString),
  verifiedReportId: nonEmptyString,
  verifiedIncidentIds: z.array(nonEmptyString),
  report: healthReportSchema,
}).strict()

export const searchReadinessResponseSchema = z.object({
  reportId: nonEmptyString,
  readiness: searchReadinessSchema,
}).strict()

export const healthErrorResponseSchema = z.object({
  error: nonEmptyString,
  code: nonEmptyString.optional(),
  itemIds: z.array(nonEmptyString).optional(),
}).strict()
