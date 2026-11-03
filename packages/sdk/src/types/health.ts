/**
 * Canonical Health contracts shared by plugin authors, adapters, core, HTTP
 * consumers, repair flows, and UI surfaces.
 *
 * Producers return input types. Core validates those inputs, stamps ownership
 * and freshness, and publishes the canonical output types in this module.
 */

import type { OperationContext, OperationPlan } from './operations'

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

// ---------------------------------------------------------------------------
// Declared incident catalogs (self-healing 1.5 — optional until the
// three-outcomes cutover makes `incidents` and `declarationId` required)
// ---------------------------------------------------------------------------

/** What an incident is ABOUT — one card per subject once the cutover lands (spec §3.1). */
export const HEALTH_SUBJECT_KINDS = [
  'plugin',
  'package',
  'hub-skill',
  'service',
  'agent',
  'table',
  'runtime',
  'channel',
  'setting',
  /** An owned record: an asset, brand, workflow, spend policy, … */
  'record',
  'task',
  'system',
] as const
export type HealthSubjectKind = (typeof HEALTH_SUBJECT_KINDS)[number]

/** What an incident is ABOUT (spec §3.1). One card per subject in the report. */
export interface HealthSubject {
  kind: HealthSubjectKind
  id: string
  label?: string
}

/** Why a human has to act: the engine cannot supply a credential, pay, decide, or install outside Bakin. */
export const HEALTH_HUMAN_NEEDS = ['credential', 'payment', 'decision', 'external-install'] as const
export type HealthHumanNeed = (typeof HEALTH_HUMAN_NEEDS)[number]

/**
 * Whether the family's subject is REQUIRED: the attention rule goes red only
 * for an operator action on a required capability. `owner-decides` = the
 * check supplies the fact per instance.
 */
export const HEALTH_INCIDENT_REQUIREMENTS = ['always', 'never', 'owner-decides'] as const
export type HealthIncidentRequirement = (typeof HEALTH_INCIDENT_REQUIREMENTS)[number]

export type HealthIncidentDeclarationResolution =
  /** Owner-local action id, or a shared engine action such as `core.diagnose`. */
  | { type: 'repair'; actionId: string }
  | { type: 'human'; needs: HealthHumanNeed }

/** What a repair action DOES to the installation — the input of the ONE authorization gate (spec §3.2). */
export const HEALTH_MUTATION_KINDS = ['upgrade', 'sync', 'reinstall', 'restart', 'rebuild', 'delete', 'policy'] as const
export type HealthMutationKind = (typeof HEALTH_MUTATION_KINDS)[number]

/**
 * What a repair action declares to the gate: one of the mutation kinds, or
 * `none` — the action changes no installed identity, writes no policy and
 * deletes nothing the user owns (it creates directories, re-projects
 * Bakin-owned files, sweeps Bakin's own scratch). The declaration is
 * REQUIRED so that no action opts out of the gate silently.
 */
export const HEALTH_REPAIR_MUTATIONS = [...HEALTH_MUTATION_KINDS, 'none'] as const
export type HealthRepairMutation = (typeof HEALTH_REPAIR_MUTATIONS)[number]

/** Why the authorization gate refused an unattended mutation; every surface renders the SAME copy for each (spec §3.2). */
export const HEALTH_MUTATION_REFUSAL_REASONS = [
  'consent-delta',
  'consent-unreviewed',
  'declined',
  'untrusted-source',
  'hub-skill',
  'operator-only',
  'quarantined',
  'disabled',
] as const
export type HealthMutationRefusalReason = (typeof HEALTH_MUTATION_REFUSAL_REASONS)[number]

/**
 * One FINITE incident family a check may emit (plan R3 N5): `not-ready`
 * covers every `not-ready:<capability>` instance, `schema-error` every
 * `schema-<workflow>-<n>`. Validated when the owner registers — a dangling
 * action or a human family without `needs` fails the owner's activation —
 * and again per emitted instance in the runner.
 */
export interface HealthIncidentDeclaration {
  id: string
  subjectKind: HealthSubjectKind
  resolution: HealthIncidentDeclarationResolution
  required: HealthIncidentRequirement
}

/**
 * Health sensitivity mode (#690): how loudly findings surface. `developer`
 * shows raw dispositions everywhere; `standard` (default) demotes expected
 * noise classes to advisory. The badge and the board escalation act on
 * action_required only, in either mode (#1007 retired `quiet`, which was
 * identical to `standard`).
 */
export type HealthSensitivity = 'developer' | 'standard'

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
  /** One persisted model selection (agent pin, route, tag, policy field) — id is the selection ref (#907). */
  | 'model_selection'
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

/**
 * One named, executable choice on an incident card beside its resolution
 * (the re-homing table's "card buttons": Claim / Use as guest, Drop / Keep,
 * Keep my edit / Restore shipped, Disable plugin, raise / ack / resume).
 * A `link` lands on a control; a `request` performs the decision through
 * the owner's existing route and the check reruns — with `confirm` the card
 * asks first. Choices never add a third outcome (spec D1): they are the
 * controls of the human decision, named on the card instead of behind it.
 */
export interface HealthDecisionChoiceEffects {
  deletesUserContent: boolean
  spendsMoney: boolean
  widensAuthorization: boolean
}

export type HealthDecisionChoice =
  | { key: string; label: string; kind: 'link'; href: string; field?: string }
  | {
      key: string
      label: string
      kind: 'request'
      method: 'POST' | 'PUT' | 'DELETE'
      /**
       * The OWNER's own route (`/api/plugins/<ownerId>/…` for a plugin; a
       * host route for core/adapters) or one of core's shared decision
       * controls — the runner refuses anything else.
       */
      url: string
      body?: Record<string, unknown>
      tone?: 'default' | 'danger'
      /** What the request does; any true effect (or `tone: 'danger'`) REQUIRES `confirm`. */
      effects: HealthDecisionChoiceEffects
      confirm?: { title: string; description?: string }
    }

interface HealthResolutionBase {
  /** Stable within the incident; repair preconditions use this key. */
  key: string
  label: string
  /** Up to four named choices rendered beside the resolution (table "card buttons"). */
  choices?: HealthDecisionChoice[]
}

export interface HealthRepairResolution extends HealthResolutionBase {
  type: 'repair'
  /** Owner-local on input; core namespaces it in canonical output. A shared engine action (`core.diagnose`) is referenced verbatim. */
  actionId: string
}

/**
 * A credential or an install the operator performs in a shell: the exact
 * command the Health card hands to a Terminal session (or offers to copy).
 * Never free-text steps — one command, optionally where to run it.
 */
export interface HealthHumanHandoff {
  command: string
  cwd?: string
}

/**
 * Something only a human can supply (spec §3.1): a credential, a payment,
 * a decision, or an install outside Bakin. `href` is the same-origin path
 * to the control; `field` the settings/form field id when the fix is a
 * value to enter; `handoff` the command for a shell-side credential or
 * install (the card's Terminal handoff with return verification).
 */
export interface HealthHumanResolution extends HealthResolutionBase {
  type: 'human'
  needs: HealthHumanNeed
  href: string
  field?: string
  handoff?: HealthHumanHandoff
}

/** The two outcomes (spec D1): Bakin repairs it, or a human must act. Nothing else exists. */
export type HealthResolution = HealthRepairResolution | HealthHumanResolution

export interface HealthIncidentBaseInput {
  /** Stable within the registration's owner and subsystem group. */
  key: string
  title: string
  impact: string
  /** Behavior class for the sensitivity projection; absent = service_failure (never demoted). */
  class?: HealthIncidentClass
  /** REQUIRED: what this incident is about. One card per subject in the report. */
  subject: HealthSubject
  /** Other affected resources. */
  resources?: HealthResource[]
  resolution: HealthResolution
  /**
   * The declared family this instance belongs to (`incidents[].id` on the
   * registration). The runner refuses an instance whose resolution
   * contradicts its declaration.
   */
  declarationId: string
  /**
   * Whether the subject is REQUIRED — something that runs references it
   * (an enabled plugin, a capability an agent declares, search while
   * enabled, a scheduled workflow). Mandatory for an `owner-decides`
   * family; derived from the family for `always` / `never`.
   */
  required?: boolean
  /**
   * This incident is a symptom of another subject's failure; the report
   * folds it under that owner ONLY when the owner's repair declares it
   * resolves this incident key (spec D7).
   */
  dependsOn?: { subject: HealthSubject; resolvedBy: string }
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

/**
 * A warning is an incident when it carries one. Without an incident it is a
 * plain observation (spec §3.1: a transient or informational state listed
 * under its check, never a card) — the "observation" rows of the re-homing
 * table. An error is always an incident.
 */
export type WarningObservationInput = HealthObservationBaseInput & {
  status: 'warning'
  incident?: HealthIncidentInput
}

export type ErrorObservationInput = HealthObservationBaseInput & {
  status: 'error'
  incident: ActionIncidentInput
}

export type UnknownObservationInput = HealthObservationBaseInput & {
  status: 'unknown'
  /**
   * Optional — an unknown WITHOUT an incident is a plain "could not see"
   * observation the check's `maxAgeMs` re-runs. With one: watch = a human
   * should keep an eye on this unknown; advisory = the producer vouches it
   * SELF-RESOLVES (a scan warming up after restart, attribution completing
   * as transcripts land) — surfaced, but never in the fix-first banner.
   * action_required stays unrepresentable: an unknown cannot honestly
   * demand action.
   */
  incident?: WatchIncidentInput | AdvisoryIncidentInput
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
  /** The finite incident families this check may emit; validated at registration (a refused catalog fails the owner's activation). */
  incidents: HealthIncidentDeclaration[]
  run(context?: HealthCheckRunContext): Promise<HealthCheckRunInput>
}

// ---------------------------------------------------------------------------
// Repair contracts
// ---------------------------------------------------------------------------

/**
 * What a repair action does beyond fixing the incident (spec §3.2). The ONE
 * mode policy reads these: an action self-heals unless it deletes user
 * content, spends money or widens what the operator authorized. Restarting
 * a service is a scheduling matter (the maintenance coordinator), never a
 * reason to ask.
 */
export interface HealthRepairEffects {
  deletesUserContent: boolean
  spendsMoney: boolean
  /** Consents to new permissions/bins/secrets/npm payloads, or changes spend, routing or policy — always one-click. */
  widensAuthorization: boolean
  /** The action restarts a supervised service or Bakin; the engine serializes these behind the restart gate. */
  restartsService?: 'search-engine' | 'bakin' | 'runtime'
  /** Declaration ids (families) of dependent incidents this repair resolves — what `dependsOn.resolvedBy` folds under (spec §3.1). */
  resolves?: string[]
}

/** Derived from `HealthRepairEffects` by the ONE policy (`repairMode`); stamped on every canonical plan item. */
export type HealthRepairMode = 'self-heal' | 'one-click'

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
  /** Canonical: `<canonical action id>:<localId>`, unique across the plan. Opaque to actions. */
  id: string
  /** The id the planner gave this item — the DOMAIN handle an action's `apply` reads (a package, an agent, a task), never `id`. */
  localId: string
  actionId: string
  title: string
  reason: string
  /** Per item (a planner may stamp stricter effects than its action declares, e.g. the purge item of a store repair). */
  effects: HealthRepairEffects
  /** Core-stamped from `effects` by the ONE policy — clients never re-derive it. */
  mode: HealthRepairMode
  incidentIds: string[]
  observationIds: string[]
  preconditions: HealthRepairPrecondition[]
  changes: HealthRepairChange[]
}

/** What a planner returns: core stamps `effects` (defaulting to the action's) and `mode`. */
export type HealthRepairPlanItemInput = Omit<HealthRepairPlanItem, 'effects' | 'mode' | 'localId'> & { effects?: HealthRepairEffects }

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
  /** Individually confirmed one-click item ids. */
  confirmedItemIds: string[]
}

export interface HealthRepairApplyResult {
  itemId: string
  actionId: string
  status: 'applied' | 'skipped' | 'failed'
  message: string
  affectedCheckIds: string[]
  changes: HealthRepairChange[]
  /**
   * Set when the ONE authorization gate refused this item for an unattended
   * actor (status `skipped`): the operator path runs it instead, and this
   * never counts as a failed attempt.
   */
  authorization?: { refused: true; reason: HealthMutationRefusalReason }
}

/**
 * Owner-local repair action registered separately from diagnostic checks.
 *
 * Applying runs as a child operation of the repair (#895 D10): the action
 * declares its stages up front (`operationPlan`, with `pointOfNoReturn` at the
 * first stage that changes anything) and reports through the `op` context it
 * receives. `resources` are acquired before `apply` runs: core plugins may
 * name the core resources (`install-state`, `media-store`, `search-engine`),
 * any plugin its own `<pluginId>:<name>` resources.
 */
export interface HealthRepairActionDefinition {
  id: string
  name: string
  /** REQUIRED: what applying this action does; the ONE mode policy decides self-heal vs one-click from it. */
  effects: HealthRepairEffects
  /**
   * REQUIRED: the installation mutation this action performs (upgrade /
   * sync / reinstall of a tracked subject, a restart, a rebuild, a
   * deletion, a policy write), or `none`. The ONE authorization gate judges
   * every apply by it; `none` is an explicit, reviewable declaration that
   * there is nothing to authorize beyond the mode — never a silent opt-out.
   */
  mutation: HealthRepairMutation
  /** Bounded and local: no network, no engine calls. */
  plan(target: HealthRepairTarget): Promise<HealthRepairPlanItemInput[]>
  /** The stages applying these items will report. */
  operationPlan(items: HealthRepairPlanItem[]): OperationPlan
  resources?: string[]
  apply(items: HealthRepairPlanItem[], op: OperationContext): Promise<HealthRepairApplyResult[]>
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
  incidentId?: string
  incident?: HealthIncidentInput
}

export type CanonicalErrorObservation = CanonicalHealthObservationBase & {
  status: 'error'
  incidentId: string
  incident: ActionIncidentInput
}

export type CanonicalUnknownObservation = CanonicalHealthObservationBase & {
  status: 'unknown'
  incidentId?: string
  incident?: WatchIncidentInput | AdvisoryIncidentInput
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
  /** What the incident is about (spec §3.1). */
  subject: HealthSubject
  resources: HealthResource[]
  resolution: HealthResolution
  /** The declared family this incident belongs to. */
  declarationId: string
  /** Whether the subject is required (the attention rule goes red only for an operator action on a required subject). */
  required: boolean
  /** A symptom of another subject's failure (folding, spec D7). */
  dependsOn?: { subject: HealthSubject; resolvedBy: string }
  observationIds: string[]
  observedAt: string
  staleAt: string
  stale: boolean
  /**
   * The user's "I know" state (health trust overhaul): 'acked' = silent
   * until material change (tier escalation / resource-set change);
   * 'snoozed' = silent until expiry (action_required also re-fires on any
   * evidence change). Absent = live. Consumers (badge, Fix first, notices,
   * escalation) FILTER on this — never re-derive; suppressed incidents
   * stay on the wire and render in the Acknowledged section.
   */
  ackState?: 'acked' | 'snoozed'
  /**
   * The open Health repair task working this incident, when one exists
   * (spec D-G2) — surfaces link to it. A separate field, never a resource:
   * resources feed the ack re-fire fingerprint.
   */
  repairTaskId?: string
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
  /** Tier counts describe LIVE (un-acked) attention — they reconcile with overallStatus. */
  actionRequired: number
  watching: number
  advisory: number
  unknown: number
  /** Acked/snoozed incidents — quiet, visible in the Acknowledged section. */
  acknowledged: number
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
  /** The sensitivity mode this report was projected under (#690). */
  sensitivity: HealthSensitivity
  lastFullSweep: HealthFullSweep | null
  checks: HealthCheckState[]
  observations: HealthObservation[]
  incidents: HealthIncident[]
  subsystems: HealthReportSubsystems
  summary: HealthReportSummary
}
