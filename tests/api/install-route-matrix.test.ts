/**
 * PR4 success criteria (#895, PLAN § PR4 checkpoint) across EVERY converted
 * install/lifecycle route, one row each:
 *
 * - Accept: the route answers 202 in under 500ms even while another
 *   operation holds install-state.
 * - Cancel boundary: a route that owns install-state waits visibly behind
 *   the holder. A cancel while it waits is honoured (it ends `cancelled`, and
 *   its run never starts). Plugin remove's point of no return is `start`, so
 *   it refuses. A preview holds nothing and declares no point of no return.
 *   Its in-flight cancel is pinned per route in install-operations
 *   (plugin fetch) and skills-operations (stalled hub).
 *
 * Writes go to temp dirs only (BAKIN_HOME/OPENCLAW_HOME, a mock runtime).
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-route-matrix-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createMockRuntimeAdapter } from '../../packages/core/src/adapters/runtime/testing'
import type { WorkspaceFile } from '../../packages/core/src/adapters/runtime'

const bakinPaths = () => ({ home: testDir, root: testDir, agents: join(testDir, 'agents'), db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin'), media: join(testDir, 'media') })
mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: bakinPaths, isUsingBakinHome: () => true }))
mock.module('@bakin/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: bakinPaths, isUsingBakinHome: () => true }))
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: bakinPaths, isUsingBakinHome: () => true }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: bakinPaths, isUsingBakinHome: () => true }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))

const runtime = createMockRuntimeAdapter({ name: 'route-matrix-runtime', version: '0.0.0', requiredCoreVersion: '*' })
const runtimeMock = {
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
;(globalThis as typeof globalThis & { __bakinAppServices?: unknown }).__bakinAppServices = { runtime: runtimeMock }

import type { OperationView } from '../../packages/core/src/operations'
import { holdNow, toPluginOperationInput } from '../../packages/core/src/operations'
import * as agentInstall from '../../packages/host/src/api/agent-packages/install'
import * as agentDynamic from '../../packages/host/src/api/agent-packages/dynamic'
import * as packageInstall from '../../packages/host/src/api/packages/install'
import * as packageDynamic from '../../packages/host/src/api/packages/dynamic'
import { post as pluginInstall } from '../../packages/host/src/api/plugins/install'
import { post as pluginUpgrade } from '../../packages/host/src/api/plugins/upgrade'
import { post as pluginRemove } from '../../packages/host/src/api/plugins/remove'
import { post as pluginRestore } from '../../packages/host/src/api/plugins/restore'
import { post as pluginLink } from '../../packages/host/src/api/plugins/link'
import * as skills from '../../packages/host/src/api/skills'
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../src/core/operations'
import { populateOrgTeamRoutes } from '../../plugins/team/lib/routes/teams'
import { settleRoute } from '../helpers/operation-route'
import { waitUntil } from '../helpers/wait'

const HOLDER = 'Install plugin messaging'
const json = (method: string, path: string, body?: unknown) => new Request(`http://localhost:3737${path}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})
const urlOf = (req: Request) => new URL(req.url)
const live = (id: string): OperationView => getOperationRegistry().get(id)!

let packageKey = ''
const pluginSource = join(testDir, 'plugin-src')
const skillSource = join(testDir, 'skill-src')

function teamSync(req: Request): Promise<Response> {
  const routes: Array<{ path: string; method: string; handler: (req: Request, ctx: unknown) => Promise<Response> }> = []
  populateOrgTeamRoutes(routes)
  const route = routes.find((r) => r.path === '/teams/:teamId/sync' && r.method === 'POST')!
  return route.handler(req, {
    pluginId: 'team',
    runtime: runtimeMock,
    getSettings: () => ({}),
    operations: {
      start: (input: Parameters<typeof toPluginOperationInput>[2]) => getOperationRegistry().start(toPluginOperationInput('team', true, input)),
      await: (id: string) => getOperationRegistry().await(id),
    },
  })
}

beforeAll(async () => {
  _resetOperationRegistryForTests()
  mkdirSync(openClawDir, { recursive: true })

  // An installed agent package (pixel) for the remove / sync / migrate rows.
  const agentSrc = join(testDir, 'pixel-pkg')
  mkdirSync(join(agentSrc, 'workspace'), { recursive: true })
  writeFileSync(join(agentSrc, 'bakin-package.json'), JSON.stringify({
    id: 'pixel', kind: 'agent', name: 'pixel', version: '0.1.0',
    agent: { identity: { name: 'pixel' } },
    install: { writeWorkspaceFiles: true },
    contributions: { workspaceFiles: ['workspace/SOUL.md'] },
  }))
  writeFileSync(join(agentSrc, 'workspace', 'SOUL.md'), '# Soul pixel\n')
  const installed = await settleRoute(agentInstall.post(json('POST', '/api/agent-packages/install', { source: agentSrc })))
  expect(installed.status).toBe(200)
  packageKey = Object.keys(readLockfile().packages)[0]!

  // A local plugin source (install, link) and an installed copy (upgrade, remove).
  mkdirSync(pluginSource, { recursive: true })
  writeFileSync(join(pluginSource, 'bakin-plugin.json'), JSON.stringify({ id: 'matrixplug', name: 'matrixplug', version: '1.0.0', bakin: '*', description: 'fixture' }))
  writeFileSync(join(pluginSource, 'index.ts'), "export default { id: 'matrixplug', activate() {} }")
  cpSync(pluginSource, join(testDir, 'plugins', 'matrixplug'), { recursive: true })

  cpSync(join(import.meta.dir, '..', 'fixtures', 'skill-bundles', 'bare-style'), skillSource, { recursive: true })
})

afterAll(() => {
  _resetOperationRegistryForTests()
  rmSync(testDir, { recursive: true, force: true })
})

type Row = { name: string; start: () => Promise<Response>; cancel: 'cancelling' | 'not_cancellable' }

/** Routes that own install-state: they wait behind the holder. */
const OWNING: Row[] = [
  { name: 'package install', cancel: 'cancelling', start: () => packageInstall.post(json('POST', '/api/packages/install', { source: join(testDir, 'nowhere') })) },
  { name: 'agent-package install', cancel: 'cancelling', start: () => agentInstall.post(json('POST', '/api/agent-packages/install', { source: join(testDir, 'nowhere') })) },
  { name: 'package remove', cancel: 'cancelling', start: () => { const r = json('DELETE', `/api/packages/${encodeURIComponent(packageKey)}`); return packageDynamic.handler(r, urlOf(r)) } },
  { name: 'package sync', cancel: 'cancelling', start: () => { const r = json('POST', `/api/packages/${encodeURIComponent(packageKey)}/sync`, {}); return packageDynamic.handler(r, urlOf(r)) } },
  { name: 'agent-package remove', cancel: 'cancelling', start: () => { const r = json('DELETE', '/api/agent-packages/pixel'); return agentDynamic.handler(r, urlOf(r)) } },
  { name: 'agent sync', cancel: 'cancelling', start: () => { const r = json('POST', '/api/agent-packages/pixel/sync', {}); return agentDynamic.handler(r, urlOf(r)) } },
  { name: 'managed-block migration', cancel: 'cancelling', start: () => { const r = json('POST', '/api/agent-packages/migrate', {}); return agentDynamic.handler(r, urlOf(r)) } },
  { name: 'team-wide sync', cancel: 'cancelling', start: () => teamSync(json('POST', '/api/plugins/team/teams/global/sync?teamId=global', {})) },
  { name: 'plugin install commit', cancel: 'cancelling', start: () => pluginInstall(json('POST', '/api/plugins/install', { source: pluginSource, type: 'local', accepted: true, consentToken: 'matrix' })) },
  { name: 'plugin upgrade commit', cancel: 'cancelling', start: () => pluginUpgrade(json('POST', '/api/plugins/upgrade', { pluginId: 'matrixplug', accepted: true, consentToken: 'matrix' })) },
  { name: 'plugin restore', cancel: 'cancelling', start: () => pluginRestore(json('POST', '/api/plugins/restore', { pluginId: 'gonetool' })) },
  { name: 'plugin link', cancel: 'cancelling', start: () => pluginLink(json('POST', '/api/plugins/link', { localPath: pluginSource })) },
  { name: 'hub-skill install', cancel: 'cancelling', start: () => skills.install(json('POST', '/api/skills/install', { ref: skillSource, consentToken: 'matrix' })) },
  // Last: once released it really removes the fixture plugin.
  { name: 'plugin remove (point of no return: start)', cancel: 'not_cancellable', start: () => pluginRemove(json('POST', '/api/plugins/remove', { pluginId: 'matrixplug' })) },
]

/** Previews: hold nothing, never wait, cancellable throughout. */
const PREVIEWS: Array<{ name: string; start: () => Promise<Response> }> = [
  { name: 'plugin install preview', start: () => pluginInstall(json('POST', '/api/plugins/install', { source: pluginSource, type: 'local' })) },
  { name: 'plugin upgrade preview', start: () => pluginUpgrade(json('POST', '/api/plugins/upgrade', { pluginId: 'matrixplug' })) },
  { name: 'hub-skill preview', start: () => skills.preview(json('POST', '/api/skills/preview', { ref: skillSource })) },
  { name: 'package sync --check', start: () => { const r = json('POST', `/api/packages/${encodeURIComponent(packageKey)}/sync`, { check: true }); return packageDynamic.handler(r, urlOf(r)) } },
]

async function timedStart(start: () => Promise<Response>): Promise<{ status: number; operationId: string; elapsedMs: number }> {
  const began = performance.now()
  const res = await start()
  const elapsedMs = performance.now() - began
  const body = await res.json() as { operationId?: string; error?: string }
  if (res.status !== 202) throw new Error(`expected 202, got ${res.status}: ${JSON.stringify(body)}`)
  return { status: res.status, operationId: body.operationId!, elapsedMs }
}

describe('every install-state route: accepts in under 500ms behind a holder, and honours its cancel boundary', () => {
  it.each(OWNING)('$name', async ({ start, cancel }) => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let ready!: () => void
    const held = new Promise<void>((resolve) => { ready = resolve })
    const holding = holdNow(['install-state'], { title: HOLDER }, async () => { ready(); await gate })
    await held

    try {
      const { operationId, elapsedMs } = await timedStart(start)
      expect(elapsedMs).toBeLessThan(500)
      await waitUntil(() => live(operationId).waitingFor !== undefined, { label: 'waiting on the holder' })
      const waiting = live(operationId)
      expect(waiting.resources).toContain('install-state')
      expect(waiting.waitingFor?.holderTitle).toBe(HOLDER)
      expect(waiting.stages.every((s) => s.status === 'pending')).toBe(true)

      expect(getOperationRegistry().cancel(operationId)).toBe(cancel)
      release()
      const view = await getOperationRegistry().await(operationId)
      if (cancel === 'cancelling') {
        expect(view.status).toBe('cancelled')
        expect(view.stages.every((s) => s.status === 'pending' || s.status === 'skipped')).toBe(true)
      } else {
        expect(view.status).not.toBe('cancelled')
      }
    } finally {
      release()
      await holding
    }
  })
})

describe('every preview: accepts in under 500ms and holds nothing', () => {
  it.each(PREVIEWS)('$name', async ({ start }) => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let ready!: () => void
    const held = new Promise<void>((resolve) => { ready = resolve })
    const holding = holdNow(['install-state'], { title: HOLDER }, async () => { ready(); await gate })
    await held

    try {
      const { operationId, elapsedMs } = await timedStart(start)
      expect(elapsedMs).toBeLessThan(500)
      const view = live(operationId)
      expect(view.resources).toEqual([])
      expect(view.plan.pointOfNoReturn).toBeNull()
      // It runs while install-state is held — it never waits on it.
      const settled = await getOperationRegistry().await(operationId)
      expect(settled.waitingFor).toBeUndefined()
      expect(settled.status).not.toBe('cancelled')
    } finally {
      release()
      await holding
    }
  })
})
