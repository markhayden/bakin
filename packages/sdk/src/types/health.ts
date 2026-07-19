/**
 * Canonical Health contracts shared by plugin authors, adapters, core, HTTP
 * consumers, repair flows, and UI surfaces.
 *
 * Producers return input types. Core validates those inputs, stamps ownership
 * and freshness, and publishes the canonical output types in this module.
 */

// ---------------------------------------------------------------------------
// JSON evidence
// ---------------------------------------------------------------------------

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject
export type JsonObject = { [key: string]: JsonValue }

/** A tuple used wherever an empty list would make the contract ambiguous. */
export type HealthNonEmptyArray<T> = [T, ...T[]]

// ---------------------------------------------------------------------------
// Shared identity and status
// ---------------------------------------------------------------------------

export type HealthObservationStatus = 'healthy' | 'warning' | 'error' | 'unknown'
export type HealthDisposition = 'advisory' | 'watch' | 'action_required'
export type HealthReportStatus = 'healthy' | 'needs_attention' | 'degraded' | 'unknown_stale'

/**
 * Producer-stamped behavior class (#690) — what KIND of problem an incident
 * is, in stable machine vocabulary. Drives the central sensitivity
 * projection (class × sensitivity → effective disposition) and the
 * plain-language category chip on incident cards. An incident WITHOUT a
 * class is treated as `service_failure` — never demoted — so a missing
 * stamp can never hide a real outage.
 */
export const HEALTH_INCIDENT_CLASSES = [
  /** A capability or service is failing — the default, never demoted. */
  'service_failure',
  /** Stored data is at risk or inconsistent — never demoted. */
  'data_integrity',
  /** A budget cap is actively blocking or holding work — never demoted. */
  'budget_block',
  /** Accounting/verification evidence is incomplete (producer splits raw severity per D12). */
  'evidence_gap',
  /** Usage heuristics: spikes, effort-no-outcome, interactive sessions. */
  'usage_anomaly',
  /** Tokens nobody can account for — stays watch in every mode. */
  'unattributed_usage',
  /** Evidence-backed autonomous runaway — loud in every mode. */
  'runaway_usage',
  /** Housekeeping/cleanup debt (retired tables, stale files). */
  'cleanup_backlog',
  /** A guardrail correctly denied something — the system working. */
  'policy_denial',
  /** An optional surface the active runtime intentionally lacks. */
  'unsupported_surface',
] as const
export type HealthIncidentClass = (typeof HEALTH_INCIDENT_CLASSES)[number]

/**
 * Health sensitivity mode (#690): how loudly findings surface. `developer`
 * shows raw dispositions everywhere; `standard` (default) demotes expected
 * noise classes to advisory; `quiet` additionally notifies (badge/escalation)
 * only for action_required — watch stays visible on the page but silent.
 */
export type HealthSensitivity = 'developer' | 'standard' | 'quiet'

export type HealthOwnerKind = 'plugin' | 'adapter' | 'core'

/** Core-stamped owner of a registration or canonical finding. */
export interface HealthOwner {
  kind: HealthOwnerKind
  id: string
  label: string
}

/** Stable subsystem grouping supplied by a registration. */
export interface HealthGroup {
  key: string
  label: string
}

export type HealthResourceKind =
  | 'system'
  | 'runtime'
  | 'service'
  | 'plugin'
  | 'agent'
  | 'team'
  | 'session'
  | 'search_table'
  | 'task'
  | 'workflow'
  | 'asset'
  | 'schedule'
  | 'budget_rule'
  | 'model'
  | 'channel'
  | 'capability'
  | 'setting'
  | 'directory'
  | 'file'
  | 'other'

/** Stable reference to a resource affected by an incident. */
export interface HealthResource {
  kind: HealthResourceKind
  id: string
  label?: string
}

// ---------------------------------------------------------------------------
// Producer inputs
// ---------------------------------------------------------------------------

interface HealthResolutionBase {
  /** Stable within the incident; repair preconditions use this key. */
  key: string
  label: string
}

export interface HealthRepairResolution extends HealthResolutionBase {
  type: 'repair'
  /** Owner-local on input; core namespaces it in canonical output. */
  actionId: string
}

export interface HealthNavigateResolution extends HealthResolutionBase {
  type: 'navigate'
  /** Same-origin application path, validated by core. */
  href: string
}

export interface HealthInstructionsResolution extends HealthResolutionBase {
  type: 'instructions'
  steps: HealthNonEmptyArray<string>
  /** Copyable operator command; never executed automatically. */
  command?: string
}

export interface HealthRerunResolution extends HealthResolutionBase {
  type: 'rerun'
}

export type HealthResolution =
  | HealthRepairResolution
  | HealthNavigateResolution
  | HealthInstructionsResolution
  | HealthRerunResolution

export interface HealthIncidentBaseInput {
  /** Stable within the registration's owner and subsystem group. */
  key: string
  title: string
  impact: string
  /** Behavior class for the sensitivity projection; absent = service_failure (never demoted). */
  class?: HealthIncidentClass
  resources?: HealthResource[]
  resolution: HealthResolution
}

export interface AdvisoryIncidentInput extends HealthIncidentBaseInput {
  disposition: 'advisory'
}

export interface WatchIncidentInput extends HealthIncidentBaseInput {
  disposition: 'watch'
}

export interface ActionIncidentInput extends HealthIncidentBaseInput {
  disposition: 'action_required'
}

export type HealthIncidentInput =
  | AdvisoryIncidentInput
  | WatchIncidentInput
  | ActionIncidentInput

export interface HealthObservationBaseInput {
  /** Stable within this registered check. */
  key: string
  summary: string
  detail?: string
  sourceObservedAt?: string
  evidence?: JsonObject
}

export type HealthyObservationInput = HealthObservationBaseInput & {
  status: 'healthy'
  incident?: never
}

export type WarningObservationInput = HealthObservationBaseInput & {
  status: 'warning'
  incident: HealthIncidentInput
}

export type ErrorObservationInput = HealthObservationBaseInput & {
  status: 'error'
  incident: ActionIncidentInput
}

export type UnknownObservationInput = HealthObservationBaseInput & {
  status: 'unknown'
  incident: WatchIncidentInput
}

/** Status-discriminated producer observation; illegal combinations do not typecheck. */
export type HealthObservationInput =
  | HealthyObservationInput
  | WarningObservationInput
  | ErrorObservationInput
  | UnknownObservationInput

export interface ObservedHealthCheckRunInput {
  outcome: 'observed'
  observations: HealthNonEmptyArray<HealthObservationInput>
}

export interface NotApplicableHealthCheckRunInput {
  outcome: 'not_applicable'
  reason: string
}

export type HealthCheckRunInput = ObservedHealthCheckRunInput | NotApplicableHealthCheckRunInput

/** Cancellation context supplied by core when it executes a health check. */
export interface HealthCheckRunContext {
  readonly signal: AbortSignal
}

/** Plugin- or adapter-authored check definition; core supplies owner metadata. */
export interface HealthCheckRegistrationInput {
  id: string
  name: string
  description: string
  group: HealthGroup
  maxAgeMs?: number
  /** Optional override for checks whose expected runtime differs from the global doctor deadline. */
  timeoutMs?: number
  run(context?: HealthCheckRunContext): Promise<HealthCheckRunInput>
}

// ---------------------------------------------------------------------------
// Repair contracts
// ---------------------------------------------------------------------------

export type HealthRepairSafety = 'safe' | 'manual' | 'destructive'

export interface HealthRepairChange {
  kind: 'file' | 'setting' | 'service' | 'runtime' | 'task' | 'other'
  target: string
  action: 'create' | 'update' | 'delete' | 'install' | 'invoke'
  description: string
}

export type HealthRepairTarget =
  | {
      type: 'incidents'
      reportId: string
      ids: HealthNonEmptyArray<string>
    }
  | {
      type: 'observations'
      reportId: string
      ids: HealthNonEmptyArray<string>
    }
  | {
      type: 'all_actionable'
      reportId: string
    }

export interface HealthRepairPrecondition {
  observationId: string
  executionId: string
  status: Exclude<HealthObservationStatus, 'healthy'>
  resolutionKey: string
}

export interface HealthRepairPlanItem {
  id: string
  actionId: string
  title: string
  reason: string
  safety: HealthRepairSafety
  incidentIds: string[]
  observationIds: string[]
  preconditions: HealthRepairPrecondition[]
  changes: HealthRepairChange[]
}

export interface HealthRepairPlan {
  planId: string
  basedOnReportId: string
  target: HealthRepairTarget
  createdAt: string
  expiresAt: string
  items: HealthRepairPlanItem[]
}

export interface HealthRepairApplyRequest {
  planId: string
  itemIds: HealthNonEmptyArray<string>
  /** Individually confirmed manual/destructive item ids. */
  confirmedItemIds: string[]
}

export interface HealthRepairApplyResult {
  itemId: string
  actionId: string
  status: 'applied' | 'skipped' | 'failed'
  message: string
  affectedCheckIds: string[]
  changes: HealthRepairChange[]
}

/** Owner-local repair action registered separately from diagnostic checks. */
export interface HealthRepairActionDefinition {
  id: string
  name: string
  plan(target: HealthRepairTarget): Promise<HealthRepairPlanItem[]>
  apply(items: HealthRepairPlanItem[]): Promise<HealthRepairApplyResult[]>
}

// ---------------------------------------------------------------------------
// Core-stamped canonical output
// ---------------------------------------------------------------------------

interface CanonicalHealthObservationBase extends HealthObservationBaseInput {
  id: string
  checkId: string
  checkName: string
  owner: HealthOwner
  group: HealthGroup
  checkedAt: string
  observedAt: string
  staleAt: string
  snapshot: 'current' | 'last_known'
}

export type CanonicalHealthyObservation = CanonicalHealthObservationBase & {
  status: 'healthy'
  incidentId?: never
  incident?: never
}

export type CanonicalWarningObservation = CanonicalHealthObservationBase & {
  status: 'warning'
  incidentId: string
  incident: HealthIncidentInput
}

export type CanonicalErrorObservation = CanonicalHealthObservationBase & {
  status: 'error'
  incidentId: string
  incident: ActionIncidentInput
}

export type CanonicalUnknownObservation = CanonicalHealthObservationBase & {
  status: 'unknown'
  incidentId: string
  incident: WatchIncidentInput
}

/** Validated, core-stamped observation retained in immutable check snapshots. */
export type HealthObservation =
  | CanonicalHealthyObservation
  | CanonicalWarningObservation
  | CanonicalErrorObservation
  | CanonicalUnknownObservation

export interface HealthCheckExecutionError {
  code: string
  message: string
}

export interface HealthCheckExecution {
  id: string
  checkId: string
  startedAt: string
  completedAt: string
  outcome: 'observed' | 'not_applicable' | 'failed' | 'invalid'
  reason?: string
  error?: HealthCheckExecutionError
}

export interface HealthIncident {
  id: string
  status: Exclude<HealthObservationStatus, 'healthy'>
  /** The producer's honest raw disposition — preserved for developer mode and debugging. */
  disposition: HealthDisposition
  /**
   * Sensitivity-projected disposition (#690): what every consumer (UI,
   * badge, escalation, CLI) acts on. Caps only ever lower; error-status
   * incidents are never demoted.
   */
  effectiveDisposition: HealthDisposition
  /** Producer-stamped behavior class; absent = unclassified (treated service_failure). */
  class?: HealthIncidentClass
  title: string
  impact: string
  resources: HealthResource[]
  resolution: HealthResolution
  observationIds: string[]
  observedAt: string
  staleAt: string
  stale: boolean
}

export interface HealthCheckSnapshot {
  executionId: string
  observations: HealthObservation[]
}

/** Cached state for one currently registered check. */
export interface HealthCheckState {
  checkId: string
  checkName: string
  description: string
  owner: HealthOwner
  group: HealthGroup
  maxAgeMs?: number
  latestExecution: HealthCheckExecution
  latestValidSnapshot?: HealthCheckSnapshot
}

// ---------------------------------------------------------------------------
// Search subsystem projection
// ---------------------------------------------------------------------------

export type SearchReadinessStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
export type SearchStageStatus = SearchReadinessStatus | 'not_applicable'
export type SearchReadinessStageKey = 'engine' | 'queries' | 'indexes' | 'journal'

export interface SearchReadinessStage {
  key: SearchReadinessStageKey
  label: string
  status: SearchStageStatus
  summary: string
  observedAt: string | null
  staleAt: string | null
  observationIds: string[]
}

export interface SearchReadiness {
  status: SearchReadinessStatus
  summary: string
  observedAt: string | null
  staleAt: string | null
  stages: SearchReadinessStage[]
  incidentIds: string[]
}

// ---------------------------------------------------------------------------
// Canonical report
// ---------------------------------------------------------------------------

export interface HealthReportCheckSummary {
  registered: number
  completed: number
  failed: number
  invalid: number
  notApplicable: number
}

export interface HealthReportIncidentSummary {
  actionRequired: number
  watching: number
  advisory: number
  unknown: number
}

export interface HealthReportSummary {
  checks: HealthReportCheckSummary
  incidents: HealthReportIncidentSummary
}

export interface HealthFullSweep {
  id: string
  startedAt: string
  completedAt: string
}

export interface HealthReportSubsystems {
  search: SearchReadiness
}

export interface HealthReport {
  id: string
  revision: number
  generatedAt: string
  overallStatus: HealthReportStatus
  /** The sensitivity mode this report was projected under (#690) — lets badge/CLI apply the quiet filter. */
  sensitivity: HealthSensitivity
  lastFullSweep: HealthFullSweep | null
  checks: HealthCheckState[]
  observations: HealthObservation[]
  incidents: HealthIncident[]
  subsystems: HealthReportSubsystems
  summary: HealthReportSummary
}
