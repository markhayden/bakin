/**
 * One onboarding component install as an operation (#895 D11/D22): the plan
 * it declares is the plan the operation reports, identity covers the options
 * and the component's own inputs, a request that waited rechecks those
 * inputs before running, and the outcome follows the decision table.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-onboarding-operation-${Date.now()}-${randomUUID()}`)
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

import { holdNow, readResourceHolder, type OperationContext } from '@bakin/core/operations'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../../src/core/operations'
import { componentInstallOperation, type ComponentInstallBody } from '../../../src/core/onboarding/operation'
import type { InstallableComponent, InstallResult } from '../../../src/core/onboarding/types'
import { waitUntil } from '../../helpers/wait'

const OPTIONS = { autoApprove: true, allowServiceClaim: false }
let settings: { models: string[] } = { models: ['embedder'] }
let installs: Array<{ models: string[] }> = []
let gate: Promise<void> = Promise.resolve()

function component(over: Partial<InstallableComponent> = {}): InstallableComponent {
  return {
    name: 'search-models',
    plan: {
      stages: [
        { id: 'download', kind: 'downloading', label: 'Download models' },
        { id: 'verify', kind: 'verifying', label: 'Verify' },
      ],
      pointOfNoReturn: null,
    },
    resources: ['search-engine'],
    identity: () => settings,
    failureCode: 'models_install_failed',
    check: async () => ({ name: 'search-models', status: 'missing', message: 'missing' }),
    install: async (_opts, op: OperationContext): Promise<InstallResult> => {
      const snapshot = { models: [...settings.models] }
      op.stage('download')
      await gate
      installs.push(snapshot)
      op.stage('verify')
      return { name: 'search-models', status: 'installed', message: `Pulled ${snapshot.models.join(', ')}`, durationMs: 0 }
    },
    ...over,
  }
}

async function settle(input: ReturnType<typeof componentInstallOperation>) {
  const { operationId } = await getOperationRegistry().start(input)
  return getOperationRegistry().await(operationId)
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  settings = { models: ['embedder'] }
  installs = []
  gate = Promise.resolve()
  _resetOperationRegistryForTests()
})
afterEach(() => _resetOperationRegistryForTests())
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('componentInstallOperation', () => {
  it('reports the plan the component declares, owning its resources, as onboarding:<name>', async () => {
    const view = await settle(componentInstallOperation(component(), OPTIONS, 'cli'))
    expect(view.kind).toBe('onboarding:search-models')
    expect(view.origin).toBe('cli')
    expect(view.resources).toEqual(['search-engine'])
    expect(view.stages.map((s) => [s.id, s.status])).toEqual([['download', 'done'], ['verify', 'done']])
    expect(view.status).toBe('succeeded')
    expect(view.result?.body).toEqual({ ok: true, result: { name: 'search-models', status: 'installed', message: 'Pulled embedder', durationMs: 0 } } satisfies ComponentInstallBody)
  })

  it('a failed install settles failed with the component code; skipped is succeeded/skipped; the default code is component_failed', async () => {
    const failing = component({ install: async () => ({ name: 'search-models', status: 'failed', message: 'pull exited 1', error: new Error('boom'), durationMs: 0 }) })
    const failed = await settle(componentInstallOperation(failing, OPTIONS, 'web'))
    expect(failed.status).toBe('failed')
    expect(failed.outcome?.code).toBe('models_install_failed')
    // The body is JSON-safe: no Error object rides along.
    expect(failed.result?.body).toEqual({ ok: false, result: { name: 'search-models', status: 'failed', message: 'pull exited 1', durationMs: 0 } })

    const skipped = await settle(componentInstallOperation(component({ install: async () => ({ name: 'search-models', status: 'skipped', message: 'not approved', durationMs: 0 }) }), OPTIONS, 'web'))
    expect([skipped.status, skipped.outcome?.code]).toEqual(['succeeded', 'skipped'])

    const plain = await settle(componentInstallOperation(component({ failureCode: undefined, install: async () => ({ name: 'search-models', status: 'failed', message: 'x', durationMs: 0 }) }), OPTIONS, 'web'))
    expect(plain.outcome?.code).toBe('component_failed')
  })

  it('an identical request attaches; different options or different identity inputs do not', async () => {
    let release!: () => void
    gate = new Promise((r) => { release = r })
    const first = await getOperationRegistry().start(componentInstallOperation(component(), OPTIONS, 'cli'))
    const same = await getOperationRegistry().start(componentInstallOperation(component(), OPTIONS, 'web'))
    expect(same.operationId).toBe(first.operationId)
    expect(same.attached).toBe(true)

    const unapproved = await getOperationRegistry().start(componentInstallOperation(component(), { ...OPTIONS, autoApprove: false }, 'cli'))
    expect(unapproved.operationId).not.toBe(first.operationId)
    settings = { models: ['embedder', 'reranker'] }
    const otherSettings = await getOperationRegistry().start(componentInstallOperation(component(), OPTIONS, 'cli'))
    expect(otherSettings.operationId).not.toBe(first.operationId)
    release()
    for (const id of [first.operationId, unapproved.operationId, otherSettings.operationId]) await getOperationRegistry().await(id)
  })

  it('a request whose inputs moved while it waited settles settings_changed without running', async () => {
    let release!: () => void
    const held = holdNow(['search-engine'], { title: 'Reset the search engine' }, () => new Promise<void>((r) => { release = r }))
    const { operationId } = await getOperationRegistry().start(componentInstallOperation(component(), OPTIONS, 'cli'))
    await waitUntil(() => getOperationRegistry().get(operationId)?.waitingFor !== undefined, { label: 'the install waits for search-engine' })
    settings = { models: ['embedder', 'reranker'] }
    release()
    await held

    const view = await getOperationRegistry().await(operationId)
    expect([view.status, view.outcome?.code]).toEqual(['failed', 'settings_changed'])
    expect(installs).toEqual([])
    // A fresh request under the current settings then runs with them.
    const rerun = await settle(componentInstallOperation(component(), OPTIONS, 'cli'))
    expect(rerun.status).toBe('succeeded')
    expect(installs).toEqual([{ models: ['embedder', 'reranker'] }])
  })

  it('settings that flip A → B → A never hand an A request a result installed for B', async () => {
    let release!: () => void
    const held = holdNow(['search-engine'], { title: 'Reset the search engine' }, () => new Promise<void>((r) => { release = r }))
    const a = await getOperationRegistry().start(componentInstallOperation(component(), OPTIONS, 'cli'))
    await waitUntil(() => getOperationRegistry().get(a.operationId)?.waitingFor !== undefined, { label: 'A waits' })
    settings = { models: ['embedder', 'reranker'] }
    let openB!: () => void
    gate = new Promise((r) => { openB = r })
    const b = await getOperationRegistry().start(componentInstallOperation(component(), OPTIONS, 'cli'))
    release()
    await held
    await waitUntil(() => getOperationRegistry().get(b.operationId)?.stages[0]?.status === 'active', { label: 'B is installing' })
    settings = { models: ['embedder'] }
    const again = await getOperationRegistry().start(componentInstallOperation(component(), OPTIONS, 'cli'))
    expect(again.operationId).not.toBe(b.operationId)
    openB()

    expect((await getOperationRegistry().await(a.operationId)).outcome?.code).toBe('settings_changed')
    const bView = await getOperationRegistry().await(b.operationId)
    const againView = await getOperationRegistry().await(again.operationId)
    expect((bView.result?.body as ComponentInstallBody).result.message).toBe('Pulled embedder, reranker')
    expect((againView.result?.body as ComponentInstallBody).result.message).toBe('Pulled embedder')
  })

  it("a local (CLI) install holds the resource lock file under its own title — what a server started mid-run waits on", async () => {
    let release!: () => void
    gate = new Promise((r) => { release = r })
    const { operationId } = await getOperationRegistry().start(componentInstallOperation(component(), OPTIONS, 'cli'))
    await waitUntil(() => getOperationRegistry().get(operationId)?.stages[0]?.status === 'active', { label: 'the install runs' })
    expect(readResourceHolder('search-engine')).toMatchObject({ pid: process.pid, operationId, title: 'Download the search models' })
    release()
    await getOperationRegistry().await(operationId)
    expect(readResourceHolder('search-engine')).toBeNull()
  })
})
