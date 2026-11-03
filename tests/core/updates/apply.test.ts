/**
 * The apply service (#1007 D7.4): a covering health-repair approval's full
 * scope, the scope hash, agents refused before any side effect, the
 * subject flows, and the engine reinstall as ONE lease (C17).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { healthError, healthHealthy, healthObserved } from '@makinbakin/sdk/utils'
import type { HealthRepairPlanItem, HealthReport, UpdateRecord } from '@makinbakin/sdk/types'
import { UI_OPERATOR, agentActor } from '../../helpers/approval-provenance'

const testDir = join(tmpdir(), `bakin-test-updates-apply-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
mock.module('../../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('../../../src/core/onboarding/state', () => ({ isOnboarded: () => true }))
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    doctor: { intervalMs: 60_000, requireOnboard: false, escalation: true, sensitivity: 'developer' },
    approvals: { channelAlerts: false, channel: 'general', requireRejectReason: true },
    updates: { enabled: true, intervalMs: 6 * 3_600_000 },
  }),
  resetSettingsCache: () => {},
}))
mock.module('../../../src/core/sse', () => ({ broadcast: () => {} }))
mock.module('../../../src/core/app-services-store', () => ({ maybeGetAppServices: () => undefined, getAppServices: () => { throw new Error('no services') } }))
const tasks = new Map<string, { column: string; logs: string[] }>()
let nextTask = 0
mock.module('../../../src/core/task-service', () => ({
  createTaskWithEffects: mock(async (opts: { column?: string }) => { const id = `task-${++nextTask}`; tasks.set(id, { column: opts.column ?? 'todo', logs: [] }); return { id } }),
  moveTaskWithEffects: mock(async (taskId: string, to: string) => { tasks.get(taskId)!.column = to; return { alreadyComplete: false } }),
}))
mock.module('../../../src/core/task-store', () => ({
  taskExists: (taskId: string) => tasks.has(taskId),
  addTaskLog: async (taskId: string, _author: string, message: string) => { tasks.get(taskId)?.logs.push(message) },
  blockTask: async (taskId: string) => { tasks.get(taskId)!.column = 'blocked' },
}))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { listApprovalRecords } from '../../../packages/core/src/approvals'
import { settleFor, waitUntil } from '../../helpers/wait'
import { createOperationRegistry, type OperationContext, type OperationOrigin, type OperationView } from '@bakin/core/operations'
import { clearApprovalKinds } from '../../../src/core/approvals/kinds'
import { assertOperatorDecision, listPendingApprovals, resolveApproval, resolveApprovalWithResult, settleApprovalFollowUps } from '../../../src/core/approvals/service'
import { ApprovalRefusedError, ApprovalResolveError } from '../../../src/core/approvals/errors'
import { openRepairApproval, registerDoctorApprovalKinds } from '../../../src/core/doctor-approvals'
import { planDoctorRepair } from '../../../src/core/doctor-repair'
import { clearStoredRepairPlans } from '../../../src/core/doctor-repair-plans'
import { applyHealthCheckRun, getHealthReport, resetHealthReportCache } from '../../../src/core/doctor-report-cache'
import { runHealthCheck } from '../../../src/core/doctor-checks'
import { getHealthCheck, registerPluginHealthCheck, registerPluginHealthRepairAction, unregisterPluginHealthChecks } from '../../../src/core/health-check-registry'
import { _resetOperationRegistryForTests } from '../../../src/core/operations'
import { ApplyError, confirmApply, observationIdsForSubject, previewApply, scopeHashOf, searchEngineReinstallOperation, type ApplyDeps } from '../../../src/core/updates/apply'
import { createUpdatesEngine, type UpdatesEngine } from '../../../src/core/updates/engine'
import { fingerprintOf } from '../../../src/core/updates/inventory'
import type { UpdateObservation, UpdateSource } from '../../../src/core/updates/types'
import type { InstallableComponent } from '../../../src/core/onboarding/types'

/** Health: one check with incidents pointing at two plugins; one repair action covering both observations. */
let brokenPlugins = ['projects', 'terminal']
let planTarget = 'rebuild-plugins'
const applyAction = mock(async (items: HealthRepairPlanItem[]) => items.map((item) => ({ itemId: item.id, actionId: item.actionId, status: 'applied' as const, message: 'Reinstalled.', affectedCheckIds: ['apply-test.plugins'] as [string], changes: item.changes })))
async function refresh(executionId = `exec-${randomUUID()}`) {
  const def = getHealthCheck('apply-test.plugins')
  if (def) applyHealthCheckRun(await runHealthCheck(def, { executionId: () => executionId }))
}
async function seedHealth() {
  registerPluginHealthRepairAction('apply-test', {
    id: 'reinstall-plugins',
    name: 'Reinstall plugins',
    effects: { deletesUserContent: true, spendsMoney: false, widensAuthorization: false },
    mutation: 'none',
    operationPlan: () => ({ stages: [{ id: 'apply', kind: 'installing' as const, label: 'Apply' }], pointOfNoReturn: 'apply' }),
    plan: async () => [{
      id: 'reinstall', actionId: 'reinstall-plugins', title: 'Reinstall plugins', reason: 'Artifacts are stranded.',
      incidentIds: [], observationIds: [], preconditions: [],
      changes: [{ kind: 'file', target: planTarget, action: 'install', description: 'Replace the plugin dirs.' }],
    }],
    apply: applyAction,
  })
  registerPluginHealthCheck('apply-test', {
    id: 'plugins', name: 'Plugin artifacts', description: 'Checks installed plugin artifacts.', group: { key: 'plugins', label: 'Plugins' },
    incidents: [{ id: 'stranded', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'reinstall-plugins' }, required: 'always' },
    ],
    run: async () => {
      // One incident KEY per plugin — a shared key across observations is a verification conflict.
      const row = (id: string) => (brokenPlugins.includes(id)
        ? healthError({ key: id, summary: `${id} is stranded.`, incident: { key: `stranded-${id}`, title: `${id} is stranded`, impact: 'It cannot load.', disposition: 'action_required', subject: { kind: 'plugin', id, label: id }, declarationId: 'stranded', resources: [{ kind: 'plugin', id, label: id }], resolution: { key: 'reinstall', type: 'repair', label: 'Reinstall', actionId: 'reinstall-plugins' } } })
        : healthHealthy({ key: id, summary: `${id} is fine.` }))
      return healthObserved([row('projects'), row('terminal')])
    },
  }, 'Apply Test')
  await refresh('exec-1')
}
async function openRepair(pluginIds = ['projects', 'terminal']) {
  const report = getHealthReport()
  const incidents = report.incidents.filter((row) => pluginIds.some((id) => row.resources.some((r) => r.kind === 'plugin' && r.id === id)))
  const plan = await planDoctorRepair({ contentDir: testDir, projectRoot: testDir, target: { type: 'incidents', reportId: report.id, ids: incidents.map((i) => i.id) as [string, ...string[]] } })
  return { ...(await openRepairApproval({ contentDir: testDir, report, incidents, items: plan.items, plan })), incidents }
}

/** The updates side: a scripted plugin source and an engine over it. */
const available = (id: string): UpdateObservation => ({ installed: { version: '1', display: '1' }, available: { version: '2', display: '2' }, reason: 'newer-version', outcome: 'update-available', action: { kind: 'operation', start: { route: `/api/updates/plugin%3A${id}/apply` }, impact: ['download'] } })
function engineWith(records: Record<string, UpdateObservation>, kind: UpdateSource['kind'] = 'plugin'): UpdatesEngine {
  const source: UpdateSource = {
    kind,
    inventory: async () => Object.keys(records).map((id) => ({ subject: { kind, id, label: id }, group: 'available' as const, fingerprint: fingerprintOf({ id }), source: { kind: 's', endpoint: `s://${id}` } })),
    observe: async (entry) => records[entry.subject.id]!,
  }
  return createUpdatesEngine({ storePath: join(testDir, `${randomUUID()}.json`), sources: [source], intervalMs: 3_600_000 })
}
const started: Array<{ kind: string; resources: string[]; fingerprint: string }> = []
const reobserved: string[] = []
const memoryRegistry = () => createOperationRegistry({ bootId: () => 'boot-test', publish: () => {}, audit: () => {} })
let registry = memoryRegistry()
const fakeComponent = (name: string, stages: Array<{ id: string; kind: 'downloading' | 'installing' | 'verifying'; label: string }>, install: InstallableComponent['install']): InstallableComponent => ({
  name, plan: { stages, pointOfNoReturn: stages[0]!.id }, resources: ['search-engine'], check: async () => ({ name, status: 'ok', message: 'ok' }), install,
})
function deps(engine: UpdatesEngine, overrides: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    engine: () => engine,
    healthReport: () => getHealthReport(),
    pendingRepairApprovals: () => listPendingApprovals().filter((record) => record.owner.kind === 'health-repair'),
    resolveApproval: resolveApprovalWithResult,
    assertOperator: assertOperatorDecision,
    startOperation: async (input) => { started.push({ kind: input.kind, resources: [...(input.resources ?? [])], fingerprint: input.fingerprint }); return registry.start(input) },
    installComponent: (name) => fakeComponent(name, [{ id: 'download', kind: 'downloading', label: 'Download' }, { id: 'swap', kind: 'installing', label: 'Swap' }], async (_opts, op) => { op.stage('download'); op.stage('swap'); return { name, status: 'installed', message: 'installed', durationMs: 1 } }),
    reindex: async (op) => { op.stage('reindex'); return { ok: true, tables: [] } as never },
    reindexStage: () => ({ id: 'reindex', kind: 'verifying', label: 'Rebuild search tables' }),
    reobserve: async (ids) => { reobserved.push(...ids) },
    // Re-observes once the registry shows the operation succeeded (started or attached); never for a failure.
    watchOperation: (operationId, ids) => {
      const poll = (): void => {
        const view = registry.get(operationId)
        if (view?.status === 'succeeded') reobserved.push(...ids)
        else if (!view || view.status === 'running' || view.status === 'cancelling') setTimeout(poll, 5)
      }
      poll()
    },
    searchModelsDigest: () => null,
    selfUpdateOperation: (origin, target) => ({
      kind: 'updates:self-update', owner: 'core', origin, title: 'Update Bakin', href: '/health', fingerprint: 'updates:self-update', resources: ['install-state'],
      plan: { stages: [{ id: 'download', kind: 'downloading', label: 'Download' }], pointOfNoReturn: 'download' },
      run: async () => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: { ok: true } }),
    }),
    pluginUpgrade: (pluginId, body, origin) => ({
      kind: body.accepted ? 'upgrade' : 'fetch', owner: 'core', origin, title: `upgrade ${pluginId}`, href: '/health',
      fingerprint: `plugins:upgrade:${pluginId}|${body.consentToken ?? 'preview'}`, resources: body.accepted ? ['install-state'] : [],
      plan: { stages: [{ id: 'fetch', kind: 'downloading', label: 'Fetch' }], pointOfNoReturn: null },
      run: async () => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: { ok: true } }),
    }),
    ...overrides,
  }
}

beforeEach(async () => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  resetHealthReportCache()
  clearStoredRepairPlans()
  clearApprovalKinds()
  _resetOperationRegistryForTests()
  registerDoctorApprovalKinds({ contentDir: testDir, projectRoot: testDir })
  tasks.clear(); nextTask = 0; started.length = 0
  brokenPlugins = ['projects', 'terminal']
  planTarget = 'rebuild-plugins'
  applyAction.mockClear()
  registry = memoryRegistry()
  await seedHealth()
})
afterEach(() => { unregisterPluginHealthChecks('apply-test') })

describe('preview', () => {
  it('maps a subject to the incidents that name it, and reports a covering approval\'s COMPLETE scope — wider than the subject', async () => {
    const engine = engineWith({ projects: available('projects'), terminal: available('terminal') })
    await engine.observe('plugin:projects'); await engine.observe('plugin:terminal')
    const report = getHealthReport()
    expect(observationIdsForSubject(report, { subject: { kind: 'plugin', id: 'projects', label: 'projects' } })).toEqual(['apply-test.plugins:projects'])
    expect(observationIdsForSubject(report, { subject: { kind: 'plugin', id: 'nope', label: 'nope' } })).toEqual([])

    const opened = await openRepair(['projects', 'terminal'])
    const preview = await previewApply('plugin:projects', deps(engine))
    expect(preview.record.id).toBe('plugin:projects')
    expect(preview.action?.kind).toBe('operation')
    expect(preview.approval).toMatchObject({
      approvalId: opened.approval.approvalId,
      observationIds: ['apply-test.plugins:projects', 'apply-test.plugins:terminal'],
      subjectIds: ['plugin:projects', 'plugin:terminal'],
    })
    expect(preview.approval!.incidentIds.sort()).toEqual(opened.incidents.map((i) => i.id).sort())
    expect(preview.approval!.items.length).toBeGreaterThan(0)
    expect(preview.approval!.scopeHash).toMatch(/^[0-9a-f]{16}$/)
    expect(preview.approval!.scopeHash).toBe(scopeHashOf({ approvalId: opened.approval.approvalId, observationIds: preview.approval!.observationIds, incidentIds: preview.approval!.incidentIds, items: preview.approval!.items }))
  })

  it('no covering approval ⇒ no scope; an unknown id ⇒ 404; more than one covering approval ⇒ 409 with their ids', async () => {
    const engine = engineWith({ projects: available('projects'), terminal: available('terminal') })
    await engine.observe('plugin:projects')
    expect((await previewApply('plugin:projects', deps(engine))).approval).toBeUndefined()
    await expect(previewApply('plugin:nope', deps(engine))).rejects.toMatchObject({ status: 404, code: 'not_found' })
    const first = await openRepair(['projects'])
    const second = await openRepair(['projects'])
    expect(first.approval.approvalId).not.toBe(second.approval.approvalId)
    const err = await previewApply('plugin:projects', deps(engine)).catch((e: ApplyError) => e)
    expect(err).toBeInstanceOf(ApplyError)
    expect((err as ApplyError).code).toBe('multiple_covering_approvals')
    expect(((err as ApplyError).extra.approvalIds as string[]).sort()).toEqual([first.approval.approvalId, second.approval.approvalId].sort())
  })
})

describe('confirm with a covering approval', () => {
  const origin = 'web' as const

  it('an agent is refused before anything is read or started (403), as is an undeclared caller', async () => {
    const engine = engineWith({ projects: available('projects') })
    await engine.observe('plugin:projects')
    await openRepair(['projects'])
    const d = deps(engine)
    await expect(confirmApply('plugin:projects', { provenance: agentActor('scout'), origin }, d)).rejects.toBeInstanceOf(ApprovalRefusedError)
    expect(started).toEqual([])
    expect(listPendingApprovals()).toHaveLength(1)
  })

  it('without the approval in hand it is approval_required; with the previewed scope it resolves the approval and the repair starts', async () => {
    const engine = engineWith({ projects: available('projects'), terminal: available('terminal') })
    await engine.observe('plugin:projects')
    const opened = await openRepair(['projects', 'terminal'])
    const d = deps(engine)
    await expect(confirmApply('plugin:projects', { target: { version: '2' }, provenance: UI_OPERATOR, origin }, d)).rejects.toMatchObject({ code: 'approval_required' })
    const preview = await previewApply('plugin:projects', d)
    const result = await confirmApply('plugin:projects', { target: { version: '2' }, approvalId: preview.approval!.approvalId, scopeHash: preview.approval!.scopeHash, provenance: UI_OPERATOR, origin }, d)
    expect(result.approvalId).toBe(opened.approval.approvalId)
    expect(typeof result.started.operationId).toBe('string')
    await settleApprovalFollowUps()
    expect(listApprovalRecords({ status: 'approved' }).map((r) => r.approvalId)).toContain(opened.approval.approvalId)
    expect(applyAction).toHaveBeenCalledTimes(1)
    // The subject's own flow never ran — the approval WAS the apply.
    expect(started).toEqual([])
  })

  it('a scope that changed between preview and confirm is refused: a different approval, a stale hash, or an approval no longer pending', async () => {
    const engine = engineWith({ projects: available('projects') })
    await engine.observe('plugin:projects')
    const opened = await openRepair(['projects'])
    const d = deps(engine)
    const preview = await previewApply('plugin:projects', d)
    await expect(confirmApply('plugin:projects', { target: { version: '2' }, approvalId: preview.approval!.approvalId, scopeHash: 'deadbeefdeadbeef', provenance: UI_OPERATOR, origin }, d)).rejects.toMatchObject({ code: 'scope_changed' })
    await expect(confirmApply('plugin:projects', { target: { version: '2' }, approvalId: 'health-repair:other', scopeHash: preview.approval!.scopeHash, provenance: UI_OPERATOR, origin }, d)).rejects.toMatchObject({ code: 'scope_changed' })
    await resolveApproval(opened.approval.approvalId, { option: 'dismiss', provenance: UI_OPERATOR })
    await expect(confirmApply('plugin:projects', { target: { version: '2' }, approvalId: preview.approval!.approvalId, scopeHash: preview.approval!.scopeHash, provenance: UI_OPERATOR, origin }, d)).rejects.toMatchObject({ code: 'scope_changed' })
  })

  it('a proposal that no longer matches fresh evidence does not start: the approval path refuses plan-changed (409) and a fresh proposal waits on the task', async () => {
    const engine = engineWith({ projects: available('projects') })
    await engine.observe('plugin:projects')
    await openRepair(['projects'])
    const d = deps(engine)
    const preview = await previewApply('plugin:projects', d)
    planTarget = 'something-else' // the re-plan at apply time proposes a different change set
    const err = await confirmApply('plugin:projects', { target: { version: '2' }, approvalId: preview.approval!.approvalId, scopeHash: preview.approval!.scopeHash, provenance: UI_OPERATOR, origin }, d).catch((e: unknown) => e)
    // The one approval path's own refusal, not re-wrapped: the route maps it to its 409.
    expect(err).toBeInstanceOf(ApprovalResolveError)
    expect((err as ApprovalResolveError).status).toBe(409)
    expect((err as Error).message).toMatch(/changed since/)
    expect(applyAction).not.toHaveBeenCalled()
    const fresh = listPendingApprovals().filter((record) => record.owner.kind === 'health-repair')
    expect(fresh).toHaveLength(1)
    expect(fresh[0]!.approvalId).not.toBe(preview.approval!.approvalId)
  })

  it('Health\'s Apply and the Updates Apply racing on the same approval: one resolves it, the other is refused, the action runs once', async () => {
    const engine = engineWith({ projects: available('projects') })
    await engine.observe('plugin:projects')
    const opened = await openRepair(['projects'])
    const d = deps(engine)
    const preview = await previewApply('plugin:projects', d)
    const outcomes = await Promise.allSettled([
      resolveApprovalWithResult(opened.approval.approvalId, { option: 'apply', provenance: UI_OPERATOR }), // Health's route path
      confirmApply('plugin:projects', { target: { version: '2' }, approvalId: preview.approval!.approvalId, scopeHash: preview.approval!.scopeHash, provenance: UI_OPERATOR, origin }, d),
    ])
    await settleApprovalFollowUps()
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    expect(applyAction).toHaveBeenCalledTimes(1)
  })
})

describe('confirm without a covering approval — the subject\'s own flow', () => {
  const origin = 'cli' as const

  it('a plugin runs the upgrade preview first (no consent in hand) and the commit once the consent token is echoed', async () => {
    brokenPlugins = []
    await refresh()
    const engine = engineWith({ projects: available('projects') })
    await engine.observe('plugin:projects')
    const d = deps(engine)
    const preview = await confirmApply('plugin:projects', { target: { version: '2' }, provenance: UI_OPERATOR, origin }, d)
    expect(typeof preview.started.operationId).toBe('string')
    expect(started.at(-1)).toMatchObject({ kind: 'fetch', resources: [] })
    const commit = await confirmApply('plugin:projects', { target: { version: '2' }, consentToken: 'tok-1', provenance: UI_OPERATOR, origin }, d)
    expect(typeof commit.started.operationId).toBe('string')
    expect(started.at(-1)).toMatchObject({ kind: 'upgrade', resources: ['install-state'] })
  })

  it('a bakin subject starts the self-update operation under install-state', async () => {
    brokenPlugins = []
    await refresh()
    const engine = engineWith({ bakin: { ...available('bakin'), action: { kind: 'operation', start: { route: '/api/updates/bakin%3Abakin/apply' }, impact: ['download', 'server-restart'] } } }, 'bakin')
    await engine.observe('bakin:bakin')
    const result = await confirmApply('bakin:bakin', { target: { version: '2' }, provenance: UI_OPERATOR, origin }, deps(engine))
    expect(typeof result.started.operationId).toBe('string')
    expect(started.at(-1)).toMatchObject({ kind: 'updates:self-update', resources: ['install-state'] })
  })

  it('nothing to apply (current, blocked, unknown) and a manual action are refused; a gateway subject is manual by nature', async () => {
    brokenPlugins = []
    await refresh()
    const engine = engineWith({ current: { installed: { version: '1', display: '1' }, outcome: 'current' }, manual: { ...available('manual'), action: { kind: 'manual', pointer: 'do it by hand' } } })
    await engine.observe('plugin:current'); await engine.observe('plugin:manual')
    const d = deps(engine)
    await expect(confirmApply('plugin:current', { target: { version: '2' }, provenance: UI_OPERATOR, origin }, d)).rejects.toMatchObject({ code: 'nothing_to_apply' })
    await expect(confirmApply('plugin:manual', { target: { version: '2' }, provenance: UI_OPERATOR, origin }, d)).rejects.toMatchObject({ code: 'manual_action', extra: { pointer: 'do it by hand' } })
    const gateway = engineWith({ openclaw: { ...available('openclaw'), reason: 'below-floor' } }, 'gateway')
    await gateway.observe('gateway:openclaw')
    await expect(confirmApply('gateway:openclaw', { target: { version: '2' }, provenance: UI_OPERATOR, origin }, deps(gateway))).rejects.toMatchObject({ code: 'unsupported_subject' })
    expect(started).toEqual([])
  })

  it('the engine reinstall is ONE operation holding search-engine from the install through the repair reindex, every stage done in order', async () => {
    brokenPlugins = []
    await refresh()
    const engine = engineWith({ antfly: { ...available('antfly'), reason: 'pin-mismatch' } }, 'search-engine')
    await engine.observe('search-engine:antfly')
    const seen: Array<{ step: string; op: OperationContext }> = []
    const d = deps(engine, {
      installComponent: (name) => fakeComponent(name, [{ id: 'download', kind: 'downloading', label: 'Download' }, { id: 'swap', kind: 'installing', label: 'Swap' }], async (_opts, op) => { seen.push({ step: 'install', op }); op.stage('download'); op.stage('swap'); return { name, status: 'installed', message: 'installed', durationMs: 1 } }),
      reindex: async (op) => { seen.push({ step: 'reindex', op }); op.stage('reindex'); return { ok: true, tables: [] } as never },
    })
    const input = await searchEngineReinstallOperation(d, 'search-engine:antfly', origin)
    expect(input.resources).toEqual(['search-engine'])
    expect(input.plan.stages.map((s) => s.id)).toEqual(['download', 'swap', 'reindex'])
    const result = await confirmApply('search-engine:antfly', { target: { version: '2' }, provenance: UI_OPERATOR, origin }, d)
    expect(started.at(-1)).toMatchObject({ kind: 'updates:search-engine', resources: ['search-engine'] })
    let view: OperationView | null = null
    for (let i = 0; i < 200 && view?.status !== 'succeeded'; i++) { view = registry.get(result.started.operationId); await new Promise((r) => setTimeout(r, 5)) }
    expect(view?.status).toBe('succeeded')
    expect(seen.map((s) => s.step)).toEqual(['install', 'reindex'])
    expect(seen[0]!.op).toBe(seen[1]!.op) // the same operation context: one lease, never released between them
    expect(view!.stages.map((s) => [s.id, s.status])).toEqual([['download', 'done'], ['swap', 'done'], ['reindex', 'done']])
  })
})

describe('review round 1 — after the operation', () => {
  const bakinRecord: UpdateObservation = { installed: { version: '0.1.0', display: 'v0.1.0' }, available: { version: '0.1.1', display: 'v0.1.1' }, reason: 'newer-version', outcome: 'update-available', action: { kind: 'operation', start: { route: '/api/updates/bakin%3Abakin/apply' }, impact: ['download', 'server-restart'] } }
  const selfUpdateOp = (origin: OperationOrigin, outcome: 'succeeded' | 'failed') => ({
    kind: 'updates:self-update', owner: 'core' as const, origin, title: 'Update Bakin', href: '/health', fingerprint: `x:${outcome}`, resources: ['install-state' as const],
    plan: { stages: [{ id: 'download', kind: 'downloading' as const, label: 'Download' }], pointOfNoReturn: 'download' },
    run: async () => (outcome === 'succeeded' ? { status: 'succeeded' as const, code: 'ok', httpStatus: 200, body: { ok: true } } : { status: 'failed' as const, code: 'update_failed', message: 'nope', httpStatus: 200, body: { ok: false } }),
  })

  it('a bakin apply binds the self-update to the previewed release; a succeeded operation re-observes its subject, a failed one does not (#1, #2)', async () => {
    reobserved.length = 0
    const engine = engineWith({ bakin: bakinRecord }, 'bakin')
    await engine.observe('bakin:bakin')
    let bound: string | undefined
    const d = deps(engine, { selfUpdateOperation: (origin, target) => { bound = target.expectedVersion; return selfUpdateOp(origin, 'succeeded') } })
    const { started } = await confirmApply('bakin:bakin', { target: { version: '0.1.1' }, provenance: UI_OPERATOR, origin: 'web' }, d)
    expect(bound).toBe('0.1.1')
    await waitUntil(() => registry.get(started.operationId)?.status === 'succeeded', { label: 'operation finished' })
    await waitUntil(() => reobserved.length === 1, { label: 're-observed once' })
    expect(reobserved).toEqual(['bakin:bakin'])

    reobserved.length = 0
    const second = await confirmApply('bakin:bakin', { target: { version: '0.1.1' }, provenance: UI_OPERATOR, origin: 'web' }, deps(engine, { selfUpdateOperation: (origin) => selfUpdateOp(origin, 'failed') }))
    await waitUntil(() => registry.get(second.started.operationId)?.status === 'failed', { label: 'operation failed' })
    await settleFor(30, 'a failed operation never re-observes')
    expect(reobserved).toEqual([])
  })
})

describe('review round 2 — the reviewed target and re-observation', () => {
  const origin = 'web' as const

  it('an apply names the identity the operator reviewed: missing is 400, moved since the preview is 409 target_changed (#1)', async () => {
    const records = { projects: available('projects') }
    const engine = engineWith(records)
    await engine.observe('plugin:projects')
    const d = deps(engine)
    await expect(confirmApply('plugin:projects', { provenance: UI_OPERATOR, origin }, d)).rejects.toMatchObject({ code: 'target_required', status: 400 })
    // A background observation moved the offer between the preview and the confirm.
    records.projects = { ...available('projects'), available: { version: '3', display: '3' } }
    await engine.observe('plugin:projects')
    await expect(confirmApply('plugin:projects', { target: { version: '2' }, provenance: UI_OPERATOR, origin }, d)).rejects.toMatchObject({ code: 'target_changed', status: 409, extra: { available: { version: '3' } } })
    expect(started).toEqual([])
    const ok = await confirmApply('plugin:projects', { target: { version: '3' }, provenance: UI_OPERATOR, origin }, d)
    expect(ok.started.operationId).toBeTruthy()
  })

  it('re-observation follows the OPERATION: an attached apply re-observes too, and a resolved approval re-observes every subject in its scope (#5)', async () => {
    reobserved.length = 0
    const engine = engineWith({ projects: available('projects') })
    await engine.observe('plugin:projects')
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const d = deps(engine, {
      pluginUpgrade: (pluginId, body, o) => ({
        kind: 'upgrade', owner: 'core', origin: o, title: `upgrade ${pluginId}`, href: '/health', fingerprint: `plugins:upgrade:${pluginId}|${body.consentToken ?? 'preview'}`, resources: ['install-state'],
        plan: { stages: [{ id: 'commit', kind: 'installing', label: 'Commit' }], pointOfNoReturn: null },
        run: async () => { await gate; return { status: 'succeeded', code: 'ok', httpStatus: 200, body: { ok: true } } },
      }),
    })
    const first = await confirmApply('plugin:projects', { target: { version: '2' }, consentToken: 'tok', provenance: UI_OPERATOR, origin }, d)
    const second = await confirmApply('plugin:projects', { target: { version: '2' }, consentToken: 'tok', provenance: UI_OPERATOR, origin }, d)
    expect(second.started.operationId).toBe(first.started.operationId)
    expect(second.started.attached).toBe(true)
    await settleFor(30, 'nothing is re-observed before the operation succeeds')
    expect(reobserved).toEqual([])
    release()
    await waitUntil(() => reobserved.length === 2, { label: 'both callers re-observed once the shared operation succeeded' })
    expect(reobserved).toEqual(['plugin:projects', 'plugin:projects'])

    reobserved.length = 0
    const scoped = engineWith({ projects: available('projects'), terminal: available('terminal') })
    await scoped.observe('plugin:projects'); await scoped.observe('plugin:terminal')
    const opened = await openRepair(['projects', 'terminal'])
    const watched: string[] = []
    const d2 = deps(scoped, { watchOperation: (operationId, ids) => { watched.push(operationId); reobserved.push(...ids) } })
    const preview = await previewApply('plugin:projects', d2)
    const result = await confirmApply('plugin:projects', { target: { version: '2' }, approvalId: preview.approval!.approvalId, scopeHash: preview.approval!.scopeHash, provenance: UI_OPERATOR, origin }, d2)
    expect(watched).toEqual([result.started.operationId])
    expect(reobserved.sort()).toEqual(['plugin:projects', 'plugin:terminal'])
    expect(opened.approval.approvalId).toBe(preview.approval!.approvalId)
  })
})

describe('review round 3 — identity all the way down', () => {
  const origin = 'web' as const

  it('a search-models install refuses when the live model set no longer matches the reviewed digest (#5)', async () => {
    const offer: UpdateObservation = { installed: { display: '1 of 2 models ready' }, available: { digest: 'set-A', display: 'pinned model set' }, reason: 'pin-mismatch', outcome: 'update-available', action: { kind: 'operation', start: { route: '/api/updates/search-models%3Aantfly/apply' }, impact: ['download'] } }
    const engine = engineWith({ antfly: offer }, 'search-models')
    await engine.observe('search-models:antfly')
    let live = 'set-B'
    const installs: string[] = []
    const d = deps(engine, {
      searchModelsDigest: () => live,
      installComponent: (name) => fakeComponent(name, [{ id: 'pull', kind: 'downloading', label: 'Pull' }], async (_opts, op) => { installs.push(name); op.stage('pull'); return { name, status: 'installed', message: 'installed', durationMs: 1 } }),
    })
    const changed = await confirmApply('search-models:antfly', { target: { digest: 'set-A' }, provenance: UI_OPERATOR, origin }, d)
    await waitUntil(() => registry.get(changed.started.operationId)?.status === 'failed', { label: 'refused once the resource was held' })
    expect(registry.get(changed.started.operationId)?.outcome).toMatchObject({ code: 'target_changed' })
    expect(installs).toEqual([])
    live = 'set-A'
    const ok = await confirmApply('search-models:antfly', { target: { digest: 'set-A' }, provenance: UI_OPERATOR, origin }, d)
    await waitUntil(() => registry.get(ok.started.operationId)?.status === 'succeeded', { label: 'installed' })
    expect(installs).toEqual(['search-models'])
  })

  it('the plugin lane is told which identity was reviewed, on the preview AND on the consented commit (#1)', async () => {
    const engine = engineWith({ projects: { ...available('projects'), available: { version: '2', sha: 'c'.repeat(40), display: '2' } } })
    await engine.observe('plugin:projects')
    const bodies: Array<Record<string, unknown>> = []
    const d = deps(engine, { pluginUpgrade: (pluginId, body, o) => { bodies.push(body); return { kind: 'fetch', owner: 'core', origin: o, title: pluginId, href: '/health', fingerprint: `p:${bodies.length}`, resources: [], plan: { stages: [{ id: 'fetch', kind: 'downloading', label: 'Fetch' }], pointOfNoReturn: null }, run: async () => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: { ok: true } }) } } })
    await confirmApply('plugin:projects', { target: { version: '2', sha: 'c'.repeat(40) }, provenance: UI_OPERATOR, origin }, d)
    await confirmApply('plugin:projects', { target: { version: '2', sha: 'c'.repeat(40) }, consentToken: 'tok', provenance: UI_OPERATOR, origin }, d)
    expect(bodies).toEqual([
      { accepted: false, consentToken: undefined, expected: { version: '2', sha: 'c'.repeat(40) } },
      { accepted: true, consentToken: 'tok', expected: { version: '2', sha: 'c'.repeat(40) } },
    ])
  })
})
