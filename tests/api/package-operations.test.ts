/**
 * Package flows as operations (#895, PLAN 4.2): the routes answer at once,
 * contend visibly on install-state, honour cancel only before their point of
 * no return (and leave no trace when they do), and the bounded synchronous
 * writers never wait. Real routes, real installer and sync engine, real
 * lock files under a temp home.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-pkg-ops-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createMockRuntimeAdapter } from '../../packages/core/src/adapters/runtime/testing'
import type { WorkspaceFile } from '../../packages/core/src/adapters/runtime'

const bakinPaths = () => ({ home: testDir, agents: join(testDir, 'agents'), db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') })
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: bakinPaths,
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: bakinPaths,
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

type TestGlobal = typeof globalThis & {
  __bakinAppServices?: { runtime: ReturnType<typeof createMockRuntimeAdapter> }
}

let runtimeMock: ReturnType<typeof createMockRuntimeAdapter>

function installRuntimeMock(): void {
  const runtime = createMockRuntimeAdapter({ name: 'pkg-ops-runtime', version: '0.0.0', requiredCoreVersion: '*' })
  runtimeMock = {
    ...runtime,
    agents: {
      ...runtime.agents,
      readWorkspaceFile: async (agentId: string, path: string): Promise<WorkspaceFile | null> => {
        const file = join(openClawDir, 'workspaces', agentId, path)
        try {
          return { path, content: readFileSync(file, 'utf-8'), updatedAt: statSync(file).mtime.toISOString(), metadata: { userEdited: false } }
        } catch {
          return null
        }
      },
      writeWorkspaceFile: async (agentId: string, file: WorkspaceFile) => {
        const dir = join(openClawDir, 'workspaces', agentId)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, file.path), file.content, 'utf-8')
      },
    },
  }
  ;(globalThis as TestGlobal).__bakinAppServices = { runtime: runtimeMock }
}

import type { OperationView } from '../../packages/core/src/operations'
import { holdNow, toPluginOperationInput } from '../../packages/core/src/operations'
import * as installRoute from '../../packages/host/src/api/agent-packages/install'
import * as dynamicRoute from '../../packages/host/src/api/agent-packages/dynamic'
import { readLockfile, writeLockfile } from '../../packages/core/src/agent-packages/lockfile'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../src/core/operations'
import { populateOrgTeamRoutes } from '../../plugins/team/lib/routes/teams'
import { settleRoute } from '../helpers/operation-route'
import { waitUntil } from '../helpers/wait'

afterAll(() => {
  _resetOperationRegistryForTests()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  _resetOperationRegistryForTests()
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(openClawDir, { recursive: true })
  installRuntimeMock()
})

function seedAgentPackage(id = 'pixel'): string {
  const dir = join(testDir, `${id}-pkg`)
  mkdirSync(join(dir, 'workspace'), { recursive: true })
  mkdirSync(join(dir, 'lessons'), { recursive: true })
  writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify({
    id, kind: 'agent', name: id, version: '0.1.0',
    agent: { identity: { name: id } },
    install: { writeWorkspaceFiles: true, enableLessons: ['style'] },
    contributions: { workspaceFiles: ['workspace/SOUL.md'], lessons: ['lessons/style.md'] },
  }))
  writeFileSync(join(dir, 'workspace', 'SOUL.md'), `# Soul ${id}\n`)
  writeFileSync(join(dir, 'lessons', 'style.md'), '---\ntitle: Style\ndefaultEnabled: true\n---\n\nStyle body.')
  return dir
}

const post = (path: string, body: unknown) =>
  new Request(`http://localhost:3737${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

async function startInstall(source: string): Promise<{ response: Response; operationId: string; elapsedMs: number }> {
  const started = Date.now()
  const response = await installRoute.post(post('/api/agent-packages/install', { source }))
  const elapsedMs = Date.now() - started
  const body = await response.clone().json() as { operationId: string }
  return { response, operationId: body.operationId, elapsedMs }
}

/** Hold install-state as another operation would (a plugin install, say) until `release()`. */
function holdInstallState(title: string): { release: () => void; held: Promise<void> } {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let ready!: () => void
  const held = new Promise<void>((resolve) => { ready = resolve })
  void holdNow(['install-state'], { title }, async () => {
    ready()
    await gate
  })
  return { release, held }
}

const live = (id: string): OperationView => getOperationRegistry().get(id)!
const workspaceExists = (agentId: string) => existsSync(join(openClawDir, 'workspaces', agentId))

describe('install as an operation', () => {
  it('answers 202 in under 500ms and waits visibly behind another install-state holder', async () => {
    const holder = holdInstallState('Install plugin messaging')
    await holder.held
    const { response, operationId, elapsedMs } = await startInstall(seedAgentPackage())

    expect(response.status).toBe(202)
    expect(elapsedMs).toBeLessThan(500)
    await waitUntil(() => live(operationId).waitingFor !== undefined, { label: 'install shows what it waits for' })
    expect(live(operationId).waitingFor?.holderTitle).toBe('Install plugin messaging')
    expect(readLockfile().packages.pixel).toBeUndefined()

    holder.release()
    const view = await getOperationRegistry().await(operationId)
    expect(view.status).toBe('succeeded')
    expect(view.result?.httpStatus).toBe(200)
    expect(readLockfile().packages.pixel?.version).toBe('0.1.0')
  })

  it('cancelled before its point of no return it leaves no trace — no lockfile row, no workspace, no install dir', async () => {
    const holder = holdInstallState('Install plugin messaging')
    await holder.held
    const { operationId } = await startInstall(seedAgentPackage())
    await waitUntil(() => live(operationId).waitingFor !== undefined, { label: 'install waiting' })

    expect(getOperationRegistry().cancel(operationId)).toBe('cancelling')
    holder.release()
    const view = await getOperationRegistry().await(operationId)

    expect(view.status).toBe('cancelled')
    expect(readLockfile().packages.pixel).toBeUndefined()
    expect(workspaceExists('pixel')).toBe(false)
    expect(existsSync(join(testDir, 'packages', 'agents'))).toBe(false)
  })

  it('refuses cancel once projection has started, and finishes normally', async () => {
    const { operationId } = await startInstall(seedAgentPackage())
    await waitUntil(() => {
      const view = live(operationId)
      return view.status !== 'running' || view.stages.find((s) => s.id === 'install')?.status !== 'pending'
    }, { label: 'install reached its point of no return' })

    const answer = getOperationRegistry().cancel(operationId)
    expect(['not_cancellable', 'already_finished']).toContain(answer)
    const view = await getOperationRegistry().await(operationId)
    expect(view.status).toBe('succeeded')
    expect(readLockfile().packages.pixel?.version).toBe('0.1.0')
  })

  it('reports each package and requirement as an item on the install stage', async () => {
    const { operationId } = await startInstall(seedAgentPackage())
    const view = await getOperationRegistry().await(operationId)
    const install = view.stages.find((s) => s.id === 'install')!
    expect(install.items).toEqual([{ id: 'package:pixel', label: 'pixel 0.1.0', status: 'done' }])
    expect(view.stages.find((s) => s.id === 'agent')?.status).toBe('done')
  })
})

describe('lesson toggle never waits', () => {
  it('busy → 409 install_busy naming the holder, with no ledger write', async () => {
    await settleRoute(installRoute.post(post('/api/agent-packages/install', { source: seedAgentPackage() })))
    const lockBefore = readFileSync(join(testDir, 'packages', 'lock.json'), 'utf-8')
    const holder = holdInstallState('Sync team media')
    await holder.held

    const url = new URL('http://localhost:3737/api/agent-packages/pixel/lessons/style')
    const res = await dynamicRoute.handler(post(url.pathname, { enabled: false }), url)
    holder.release()

    expect(res.status).toBe(409)
    const body = await res.json() as { error: string; message: string; holder: { title: string } }
    expect(body.error).toBe('install_busy')
    expect(body.holder.title).toBe('Sync team media')
    expect(readFileSync(join(testDir, 'packages', 'lock.json'), 'utf-8')).toBe(lockBefore)
  })

  it('free → the ledger and the recomposed SOUL block agree', async () => {
    await settleRoute(installRoute.post(post('/api/agent-packages/install', { source: seedAgentPackage() })))
    const url = new URL('http://localhost:3737/api/agent-packages/pixel/lessons/style')
    const res = await dynamicRoute.handler(post(url.pathname, { enabled: false }), url)

    expect(res.status).toBe(200)
    expect(readLockfile().packages.pixel?.lessonsEnabled).toEqual([])
    expect(readFileSync(join(openClawDir, 'workspaces', 'pixel', 'SOUL.md'), 'utf-8')).not.toContain('Style body.')
  })
})

describe('migration takes install-state before its first write', () => {
  it('busy → waits visibly with no workspace or ledger write; released → rewrite, ledger and sync land under one owner', async () => {
    await settleRoute(installRoute.post(post('/api/agent-packages/install', { source: seedAgentPackage() })))
    // Legacy pre-block lockfile shape: the migration has work to do.
    const lock = readLockfile()
    writeLockfile({
      version: 1,
      packages: {
        pixel: {
          ...lock.packages.pixel!,
          projections: [{ kind: 'workspace-file', target: 'runtime:workspace-file:pixel:SOUL.md', sha256: 'x', templateOnly: true }],
        },
      },
    })
    const lockBefore = readFileSync(join(testDir, 'packages', 'lock.json'), 'utf-8')
    const soulBefore = readFileSync(join(openClawDir, 'workspaces', 'pixel', 'SOUL.md'), 'utf-8')

    const holder = holdInstallState('Install skill weather')
    await holder.held
    const url = new URL('http://localhost:3737/api/agent-packages/migrate')
    const started = await dynamicRoute.handler(post(url.pathname, {}), url)
    expect(started.status).toBe(202)
    const { operationId } = await started.json() as { operationId: string }
    await waitUntil(() => live(operationId).waitingFor !== undefined, { label: 'migration waiting' })

    expect(live(operationId).waitingFor?.holderTitle).toBe('Install skill weather')
    expect(readFileSync(join(testDir, 'packages', 'lock.json'), 'utf-8')).toBe(lockBefore)
    expect(readFileSync(join(openClawDir, 'workspaces', 'pixel', 'SOUL.md'), 'utf-8')).toBe(soulBefore)
    expect(existsSync(join(testDir, '.backups'))).toBe(false)

    holder.release()
    const view = await getOperationRegistry().await(operationId)
    expect(view.status).toBe('succeeded')
    expect(view.resources).toEqual(['install-state'])
    expect(view.stages.find((s) => s.id === 'migrate')?.items).toEqual([{ id: 'pixel', label: 'pixel', status: 'done' }])
    const after = readLockfile().packages.pixel!
    expect(after.projections?.some((p) => p.templateOnly)).toBe(false)
    expect(readdirSync(join(testDir, '.backups')).length).toBe(1)
  })
})

describe('team-wide sync', () => {
  function teamSyncRoute() {
    const routes: Array<{ path: string; method: string; handler: (req: Request, ctx: unknown) => Promise<Response> }> = []
    populateOrgTeamRoutes(routes)
    return routes.find((r) => r.path === '/teams/:teamId/sync' && r.method === 'POST')!
  }

  it('global syncs every runtime agent as ONE operation, each member an item', async () => {
    await settleRoute(installRoute.post(post('/api/agent-packages/install', { source: seedAgentPackage('pixel') })))
    await settleRoute(installRoute.post(post('/api/agent-packages/install', { source: seedAgentPackage('scout') })))
    const ctx = {
      pluginId: 'team',
      runtime: runtimeMock,
      getSettings: () => ({}),
      operations: {
        start: (input: Parameters<typeof toPluginOperationInput>[2]) => getOperationRegistry().start(toPluginOperationInput('team', true, input)),
        await: (id: string) => getOperationRegistry().await(id),
      },
    }

    const res = await teamSyncRoute().handler(post('/api/plugins/team/teams/global/sync?teamId=global', {}), ctx)
    expect(res.status).toBe(202)
    const { operationId } = await res.json() as { operationId: string }
    const view = await getOperationRegistry().await(operationId)

    expect(view.kind).toBe('team:sync')
    expect(view.resources).toEqual(['install-state'])
    expect(view.status).toBe('succeeded')
    const items = view.stages[0]!.items ?? []
    expect(items.map((i) => i.id).sort()).toEqual(['pixel', 'scout'])
    expect(items.every((i) => i.status === 'done')).toBe(true)
    const body = view.result?.body as { teamId: string; results: Array<{ agentId: string; receipt?: unknown }> }
    expect(body.teamId).toBe('global')
    expect(body.results.every((r) => r.receipt)).toBe(true)
  })
})
