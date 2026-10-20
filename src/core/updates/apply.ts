/**
 * The ONE apply service (#1007, D7.4 — C1/R1) behind
 * `POST /api/updates/:id/apply` and the CLI, in two steps:
 *
 * PREVIEW: if a pending `health-repair` approval's frozen proposal covers
 * the subject's health observations, the preview carries that approval's
 * COMPLETE scope (every item, incident and subject it would execute) and
 * a `scopeHash`; more than one covering approval is refused with their ids.
 *
 * CONFIRM: the operator approves THAT scope — the server refuses
 * `scope_changed` when the hash no longer matches or the approval is not
 * pending, and otherwise resolves the approval through the one approval
 * path with transport-derived provenance (agents refused before any side
 * effect, #898). Without a covering approval it runs the subject's EXISTING
 * flow: plugin upgrade preview → consent token → commit, the search engine
 * reinstall as ONE operation holding `search-engine` from install through
 * the repair reindex (C17), the models install operation. A record is
 * never authorization: every flow re-validates its target.
 */
import { createHash } from 'node:crypto'
import type { ApprovalRecord, ProposedRepairItem } from '@bakin/core/approvals'
import type { ApprovalDecision } from '../approvals/kinds'
import {
  operationStartResponseSchema,
  type OperationContext,
  type OperationOrigin,
  type OperationOutcome,
  type OperationStagePlan,
  type OperationStartResponse,
  type StartOperationInput,
} from '@bakin/core/operations'
import type { HealthReport, UpdateAction, UpdateRecord } from '@makinbakin/sdk/types'
import type { InstallableComponent } from '../onboarding/types'
import type { ReindexReport } from '../search-operations'
import type { UpdatesEngine } from './engine'
import { createLogger } from '../logger'

const log = createLogger('updates-apply')

export type ApplyErrorCode =
  | 'not_found'
  | 'updates_unavailable'
  | 'multiple_covering_approvals'
  | 'approval_required'
  | 'scope_changed'
  | 'nothing_to_apply'
  | 'manual_action'
  | 'unsupported_subject'
  | 'approval_decision'

export class ApplyError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 500 | 503, readonly code: ApplyErrorCode, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApplyError'
  }
  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extra }
  }
}

/** A pending health-repair approval's complete scope, as the operator must approve it. */
export interface ApplyApprovalScope {
  approvalId: string
  taskId: string
  title: string
  incidentIds: string[]
  observationIds: string[]
  /** Every update subject the approval's observations touch — it may span more than the previewed one. */
  subjectIds: string[]
  items: ProposedRepairItem[]
  scopeHash: string
}

export interface ApplyPreview {
  id: string
  record: UpdateRecord
  action?: UpdateAction
  approval?: ApplyApprovalScope
}

export interface ConfirmApplyInput {
  approvalId?: string
  scopeHash?: string
  /** Plugin / hub-skill flows: the consent token the preview phase issued. */
  consentToken?: string
  provenance: ApprovalDecision['provenance']
  origin: OperationOrigin
}

export interface ConfirmApplyResult {
  started: OperationStartResponse
  /** Set when an approval was resolved as part of this apply. */
  approvalId?: string
}

type MaybeAsync<T> = T | Promise<T>

export interface ApplyDeps {
  engine: () => MaybeAsync<UpdatesEngine | null>
  healthReport: () => MaybeAsync<HealthReport>
  pendingRepairApprovals: () => MaybeAsync<ApprovalRecord[]>
  resolveApproval: (approvalId: string, decision: ApprovalDecision) => Promise<{ record: ApprovalRecord; result: unknown }>
  assertOperator: (provenance: ApprovalDecision['provenance']) => MaybeAsync<void>
  startOperation: <B>(input: StartOperationInput<B>) => Promise<OperationStartResponse>
  installComponent: (name: 'search' | 'search-models') => MaybeAsync<InstallableComponent>
  reindex: (op: OperationContext) => Promise<ReindexReport>
  reindexStage: () => MaybeAsync<OperationStagePlan>
  pluginUpgrade: (pluginId: string, body: { accepted?: boolean; consentToken?: string }, origin: OperationOrigin) => MaybeAsync<StartOperationInput<Record<string, unknown>>>
  /** The Bakin self-update as an operation (D7.11), bound to the approved release. */
  selfUpdateOperation: (origin: OperationOrigin, target: { expectedVersion?: string }) => MaybeAsync<StartOperationInput<Record<string, unknown>>>
  /** Re-observe a subject after its operation changed it (the next tick would be hours away). */
  reobserve: (id: string) => MaybeAsync<void>
}

/** The health resource an update subject is about — how incidents point at it (#385 structured resources). */
export function healthResourceFor(record: Pick<UpdateRecord, 'subject'>): { kind: string; id: string } {
  switch (record.subject.kind) {
    case 'plugin': return { kind: 'plugin', id: record.subject.id }
    case 'search-engine': return { kind: 'service', id: 'search-engine' }
    case 'search-models': return { kind: 'service', id: 'search-models' }
    case 'gateway': return { kind: 'runtime', id: record.subject.id }
    case 'package':
    case 'hub-skill': return { kind: 'agent', id: record.subject.id }
    case 'bakin': return { kind: 'system', id: 'bakin' }
  }
}

/** The health observation ids whose incidents point at this subject. */
export function observationIdsForSubject(report: HealthReport, record: Pick<UpdateRecord, 'subject'>): string[] {
  const resource = healthResourceFor(record)
  return [...new Set(report.incidents
    .filter((incident) => incident.resources.some((r) => r.kind === resource.kind && r.id === resource.id))
    .flatMap((incident) => incident.observationIds))].sort()
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, stable(v)]))
  }
  return value
}

/** Items collapse to their change set — the same identity the doctor's `plan-changed` guard uses. */
export function scopeHashOf(scope: Omit<ApplyApprovalScope, 'scopeHash' | 'subjectIds' | 'title' | 'taskId'>): string {
  const changeSet = scope.items.flatMap((item) => item.changes.map((change) => `${item.actionId}|${change.kind}|${change.target}|${change.action}`)).sort()
  return createHash('sha256').update(JSON.stringify(stable({ approvalId: scope.approvalId, observationIds: [...scope.observationIds].sort(), incidentIds: [...scope.incidentIds].sort(), changeSet }))).digest('hex').slice(0, 16)
}

async function coveringApprovals(deps: ApplyDeps, observationIds: readonly string[]): Promise<ApprovalRecord[]> {
  const wanted = new Set(observationIds)
  return (await deps.pendingRepairApprovals()).filter((record) =>
    record.owner.kind === 'health-repair' && record.owner.proposal.observationIds.some((id) => wanted.has(id)))
}

async function scopeOf(deps: ApplyDeps, approval: ApprovalRecord, report: HealthReport, records: UpdateRecord[]): Promise<ApplyApprovalScope> {
  if (approval.owner.kind !== 'health-repair') throw new Error('not a repair approval')
  const observationIds = [...approval.owner.proposal.observationIds].sort()
  const covered = new Set(observationIds)
  const subjectIds = records
    .filter((record) => observationIdsForSubject(report, record).some((id) => covered.has(id)))
    .map((record) => record.id)
    .sort()
  const base = { approvalId: approval.approvalId, observationIds, incidentIds: [...approval.owner.incidentIds].sort(), items: approval.owner.proposal.items }
  return { ...base, taskId: approval.owner.taskId, title: approval.request.title, subjectIds, scopeHash: scopeHashOf(base) }
}

async function recordFor(deps: ApplyDeps, id: string): Promise<{ engine: UpdatesEngine; record: UpdateRecord; records: UpdateRecord[] }> {
  const engine = await deps.engine()
  if (!engine) throw new ApplyError(503, 'updates_unavailable', 'The updates engine has not started on this server.')
  const { records } = await engine.snapshot()
  const record = records.find((row) => row.id === id)
  if (!record) throw new ApplyError(404, 'not_found', `no update subject "${id}"`, { id })
  return { engine, record, records }
}

export async function previewApply(id: string, deps: ApplyDeps = defaultApplyDeps()): Promise<ApplyPreview> {
  const { record, records } = await recordFor(deps, id)
  const report = await deps.healthReport()
  const covering = await coveringApprovals(deps, observationIdsForSubject(report, record))
  if (covering.length > 1) {
    throw new ApplyError(409, 'multiple_covering_approvals', `${covering.length} pending Health approvals cover "${id}" — decide them on the Health page first.`, { approvalIds: covering.map((a) => a.approvalId), href: '/health' })
  }
  const preview: ApplyPreview = { id, record, ...(record.action ? { action: record.action } : {}) }
  if (covering[0]) preview.approval = await scopeOf(deps, covering[0], report, records)
  return preview
}

/** The search engine reinstall: install + repair reindex under ONE `search-engine` lease (C17). */
export async function searchEngineReinstallOperation(deps: ApplyDeps, recordId: string, origin: OperationOrigin): Promise<StartOperationInput<Record<string, unknown>>> {
  const component = await deps.installComponent('search')
  const reindexStage = await deps.reindexStage()
  return {
    kind: 'updates:search-engine',
    owner: 'core',
    origin,
    title: 'Reinstall the search engine',
    href: '/health?tab=updates',
    fingerprint: `updates:apply:${recordId}`,
    resources: ['search-engine'],
    plan: { stages: [...component.plan.stages, reindexStage], pointOfNoReturn: component.plan.pointOfNoReturn },
    run: async (op): Promise<OperationOutcome<Record<string, unknown>>> => {
      const result = await component.install({ autoApprove: true, allowServiceClaim: false }, op)
      if (result.status !== 'installed' && result.status !== 'noop') {
        return { status: 'failed', code: 'install_failed', message: result.message, httpStatus: 200, body: { ok: false, result } }
      }
      // The engine changed under the same lease: regenerate before anyone else can take it.
      const reindex = await deps.reindex(op)
      if (!reindex.ok) return { status: 'failed', code: 'reindex_failed', message: `${result.message} The rebuild did not converge.`, httpStatus: 200, body: { ok: false, result, reindex } }
      return { status: 'succeeded', code: 'ok', httpStatus: 200, body: { ok: true, result, reindex } }
    },
  }
}

async function modelsInstallOperation(deps: ApplyDeps, recordId: string, origin: OperationOrigin): Promise<StartOperationInput<Record<string, unknown>>> {
  const component = await deps.installComponent('search-models')
  return {
    kind: 'updates:search-models',
    owner: 'core',
    origin,
    title: 'Install the search models',
    href: '/health?tab=updates',
    fingerprint: `updates:apply:${recordId}`,
    resources: [...component.resources],
    plan: component.plan,
    run: async (op): Promise<OperationOutcome<Record<string, unknown>>> => {
      const result = await component.install({ autoApprove: true, allowServiceClaim: false }, op)
      if (result.status !== 'installed' && result.status !== 'noop') return { status: 'failed', code: 'install_failed', message: result.message, httpStatus: 200, body: { ok: false, result } }
      return { status: 'succeeded', code: 'ok', httpStatus: 200, body: { ok: true, result } }
    },
  }
}

export async function confirmApply(id: string, input: ConfirmApplyInput, deps: ApplyDeps = defaultApplyDeps()): Promise<ConfirmApplyResult> {
  // Refuse agents and undeclared callers before anything is read or started (#898).
  await deps.assertOperator(input.provenance)
  const preview = await previewApply(id, deps)

  if (input.approvalId !== undefined) {
    const scope = preview.approval
    if (!scope || scope.approvalId !== input.approvalId || scope.scopeHash !== input.scopeHash) {
      throw new ApplyError(409, 'scope_changed', 'The approval scope changed (or the approval is no longer pending) since the preview — review it again.', { ...(scope ? { approval: scope } : {}) })
    }
    const { result } = await deps.resolveApproval(scope.approvalId, { option: 'apply', provenance: input.provenance })
    const started = operationStartResponseSchema.safeParse(result)
    if (!started.success) {
      const failure = (result as { startFailure?: unknown } | null)?.startFailure
      throw new ApplyError(500, 'approval_decision', typeof failure === 'string' ? failure : 'The approved repair did not start; the linked task carries the reason.', { approvalId: scope.approvalId })
    }
    return { started: started.data, approvalId: scope.approvalId }
  }
  if (preview.approval) {
    throw new ApplyError(409, 'approval_required', 'A pending Health approval covers this subject — approve its full scope to apply.', { approval: preview.approval })
  }

  const { record } = preview
  if (record.outcome !== 'update-available') throw new ApplyError(409, 'nothing_to_apply', `"${id}" is ${record.outcome}; nothing to apply.`, { outcome: record.outcome })
  if (!record.action) throw new ApplyError(409, 'nothing_to_apply', `"${id}" has no action.`)
  if (record.action.kind === 'manual') throw new ApplyError(409, 'manual_action', record.action.pointer, { pointer: record.action.pointer })

  const start = async (operation: StartOperationInput<Record<string, unknown>>): Promise<ConfirmApplyResult> =>
    ({ started: await deps.startOperation(reobserveAfter(operation, id, deps)) })
  switch (record.subject.kind) {
    case 'plugin':
      return start(await deps.pluginUpgrade(record.subject.id, { accepted: input.consentToken !== undefined, consentToken: input.consentToken }, input.origin))
    case 'search-engine':
      return start(await searchEngineReinstallOperation(deps, id, input.origin))
    case 'search-models':
      return start(await modelsInstallOperation(deps, id, input.origin))
    case 'bakin':
      return start(await deps.selfUpdateOperation(input.origin, { expectedVersion: record.available?.version }))
    default:
      throw new ApplyError(409, 'unsupported_subject', `"${record.subject.kind}" subjects cannot be applied from here yet.`, { kind: record.subject.kind })
  }
}

/**
 * The operation as started, plus one hook: when it succeeds, the subject is
 * re-observed so its record reflects what just changed (a plugin upgrade's
 * new lock entry, the reinstalled engine) instead of waiting for the next
 * scheduled pass. A failed re-observation is logged; the operation's own
 * outcome is untouched.
 */
function reobserveAfter<B>(operation: StartOperationInput<B>, id: string, deps: ApplyDeps): StartOperationInput<B> {
  return {
    ...operation,
    run: async (op) => {
      const outcome = await operation.run(op)
      if (outcome.status === 'succeeded') {
        Promise.resolve(deps.reobserve(id)).catch((error: unknown) => log.warn('Re-observation after apply failed', { id, error: error instanceof Error ? error.message : String(error) }))
      }
      return outcome
    },
  }
}

/**
 * The production wiring, resolved lazily so the engine's module graph stays
 * light and tests inject fakes; every dependency may answer sync or async.
 */
export function defaultApplyDeps(): ApplyDeps {
  return {
    engine: async () => (await import('./service')).getUpdatesEngine(),
    healthReport: async () => (await import('../doctor-report-cache')).getHealthReport(),
    pendingRepairApprovals: async () => (await import('../approvals/service')).listPendingApprovals().filter((record) => record.owner.kind === 'health-repair'),
    resolveApproval: async (approvalId, decision) => (await import('../approvals/service')).resolveApprovalWithResult(approvalId, decision),
    assertOperator: async (provenance) => { (await import('../approvals/service')).assertOperatorDecision(provenance) },
    startOperation: async (input) => (await import('../operations')).getOperationRegistry().start(input),
    installComponent: async (name) => (await import('../onboarding')).installableComponent(name),
    reindex: async (op) => (await import('../search-operations')).runReindex(op, undefined, false),
    reindexStage: async () => (await import('../search-operations')).REINDEX_STAGE,
    pluginUpgrade: async (pluginId, body, origin) => (await import('../../../packages/host/src/api/plugins/upgrade')).pluginUpgradeOperation(pluginId, { pluginId, ...body }, origin),
    reobserve: async (id) => {
      const { getUpdatesTimer } = await import('./service')
      await getUpdatesTimer()?.check({ ids: [id] })
    },
    selfUpdateOperation: async (origin, target) => {
      const [{ selfUpdateOperation }, { selfUpdate }, { activateServerRestart, prepareServerRestart }, { APP_VERSION }] = await Promise.all([
        import('./self-update-operation'),
        import('../self-update'),
        import('../server-restart'),
        import('@bakin/core/constants'),
      ])
      return selfUpdateOperation(origin, {
        currentVersion: () => APP_VERSION,
        execPath: () => process.execPath,
        selfUpdate,
        prepareRestart: prepareServerRestart,
        activateRestart: activateServerRestart,
        ...(target.expectedVersion !== undefined ? { expectedVersion: target.expectedVersion } : {}),
      }) as unknown as StartOperationInput<Record<string, unknown>>
    },
  }
}
