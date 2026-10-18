/**
 * Plugin install as preview → commit operations (#895, PLAN 4.3), through
 * the real route: the preview holds nothing and never installs; the commit
 * owns install-state and reports the replace transaction's stages; cancel is
 * honoured before the journal-first rename and refused after it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID, createHash } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-install-ops-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
const paths = () => ({ root: testDir, home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') })
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))

// Gates hold the preview's fetch and the commit's build open, so a cancel can
// land at a known stage. Each wraps the REAL function.
let fetchGate: Promise<void> | null = null
let buildGate: Promise<void> | null = null
const realResolve = await import('../../../packages/host/src/api/plugins/install/resolve-source')
const realStage = realResolve.stageInstallSource
mock.module('../../../packages/host/src/api/plugins/install/resolve-source', () => ({
  ...realResolve,
  stageInstallSource: async (...args: Parameters<typeof realStage>) => {
    if (fetchGate) await fetchGate
    return realStage(...args)
  },
}))
mock.module('../../../packages/host/src/plugin-host/user-plugin-builder', () => ({
  buildUserPlugin: async (_dir: string, hooks?: { onStage?: (e: unknown) => void }) => {
    hooks?.onStage?.({ stage: 'server-build', status: 'start' })
    if (buildGate) await buildGate
    hooks?.onStage?.({ stage: 'server-build', status: 'ok', durationMs: 1 })
  },
}))

import { holdNow } from '../../../packages/core/src/operations'
import { post as installRoute } from '../../../packages/host/src/api/plugins/install'
import { readPluginLockfile } from '../../../packages/core/src/plugins/lockfile'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../../src/core/operations'
import { waitUntil } from '../../helpers/wait'

const SCRIPT = '#!/bin/sh\necho tool\n'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const platform = `${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
let server: { port: number; stop: (f?: boolean) => void }
const source = join(testDir, 'source')
const request = (body: unknown) => new Request('http://localhost/api/plugins/install', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
const pluginDir = () => join(testDir, 'plugins', 'toolplug')

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolve) => { open = resolve })
  return { promise, open }
}

async function start(body: Record<string, unknown>): Promise<{ status: number; operationId: string; elapsedMs: number }> {
  const began = Date.now()
  const res = await installRoute(request(body))
  const elapsedMs = Date.now() - began
  const { operationId } = await res.json() as { operationId: string }
  return { status: res.status, operationId, elapsedMs }
}

async function preview(): Promise<{ consentToken: string }> {
  const { operationId } = await start({ source, type: 'local' })
  const view = await getOperationRegistry().await(operationId)
  return view.result!.body as { consentToken: string }
}

beforeAll(async () => {
  const NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
  server = (Bun as unknown as { serve: (o: unknown) => typeof server }).serve({ port: 0, fetch: () => new NativeResponse(SCRIPT) })
})
afterAll(() => {
  _resetOperationRegistryForTests()
  server.stop(true)
  rmSync(testDir, { recursive: true, force: true })
})
beforeEach(() => {
  _resetOperationRegistryForTests()
  fetchGate = null
  buildGate = null
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'bakin-plugin.json'), JSON.stringify({
    id: 'toolplug', name: 'toolplug', version: '1.0.0', bakin: '*', description: 'declares a binary',
    requires: { bins: [{ name: 'tool', version: '1.0.0', install: { [platform]: { url: `http://127.0.0.1:${server.port}/tool`, sha256: sha256(SCRIPT) } } }] },
  }))
  writeFileSync(join(source, 'index.ts'), "export default { id: 'toolplug', activate() {} }")
})

describe('plugin install preview', () => {
  it('answers 202 at once, holds nothing, installs nothing, and ends awaiting consent with a token', async () => {
    const { status, operationId, elapsedMs } = await start({ source, type: 'local' })
    expect(status).toBe(202)
    expect(elapsedMs).toBeLessThan(500)
    const view = await getOperationRegistry().await(operationId)
    expect(view.kind).toBe('fetch')
    expect(view.resources).toEqual([])
    expect(view.plan.pointOfNoReturn).toBeNull()
    expect(view.outcome?.code).toBe('awaiting_consent')
    const body = view.result!.body as { awaitingConsent: boolean; consentToken: string; bins: Array<{ name: string }> }
    expect(body.awaitingConsent).toBe(true)
    expect(body.bins.map((b) => b.name)).toEqual(['tool'])
    expect(typeof body.consentToken).toBe('string')
    expect(existsSync(pluginDir())).toBe(false)
  })

  it('cancelled during its fetch it leaves nothing — no plugin dir, no staging', async () => {
    const hold = gate()
    fetchGate = hold.promise
    const { operationId } = await start({ source, type: 'local' })
    await waitUntil(() => getOperationRegistry().get(operationId)?.stages[0]?.status === 'active', { label: 'preview fetching' })
    expect(getOperationRegistry().cancel(operationId)).toBe('cancelling')
    hold.open()
    const view = await getOperationRegistry().await(operationId)
    expect(view.status).toBe('cancelled')
    expect(existsSync(pluginDir())).toBe(false)
    const leftovers = existsSync(join(testDir, 'plugins')) ? readdirSync(join(testDir, 'plugins')).filter((n) => n.startsWith('.staging')) : []
    expect(leftovers).toEqual([])
  })
})

describe('plugin install commit', () => {
  it('owns install-state and reports fetch → check → replace → place → build → bins → record → activate', async () => {
    const { consentToken } = await preview()
    const { status, operationId } = await start({ source, type: 'local', accepted: true, consentToken })
    expect(status).toBe(202)
    const view = await getOperationRegistry().await(operationId)
    expect(view.kind).toBe('install')
    expect(view.resources).toEqual(['install-state'])
    expect(view.status).toBe('succeeded')
    expect(view.stages.map((s) => s.id)).toEqual(['fetch', 'check', 'replace', 'place', 'build', 'bins', 'record', 'activate'])
    expect(view.stages.slice(0, 7).every((s) => s.status === 'done')).toBe(true)
    expect(view.stages.find((s) => s.id === 'build')?.items).toEqual([{ id: 'server-build', label: 'Build the server bundle', status: 'done' }])
    const bin = view.stages.find((s) => s.id === 'bins')?.items?.[0]
    expect(bin).toMatchObject({ id: 'bin:tool', status: 'done' })
    expect(bin?.bytes?.received).toBe(SCRIPT.length)
    expect(readPluginLockfile().plugins.toolplug?.installedBins).toEqual([{ name: 'tool', sha256: sha256(SCRIPT) }])
  })

  it('cancelled before the rename (waiting for install-state) it installs nothing', async () => {
    const { consentToken } = await preview()
    const release = gate()
    const held = gate()
    void holdNow(['install-state'], { title: 'Install skill weather' }, async () => {
      held.open()
      await release.promise
    })
    await held.promise
    const { operationId } = await start({ source, type: 'local', accepted: true, consentToken })
    await waitUntil(() => getOperationRegistry().get(operationId)?.waitingFor !== undefined, { label: 'commit waiting' })
    expect(getOperationRegistry().cancel(operationId)).toBe('cancelling')
    release.open()
    const view = await getOperationRegistry().await(operationId)
    expect(view.status).toBe('cancelled')
    expect(existsSync(pluginDir())).toBe(false)
    expect(readPluginLockfile().plugins.toolplug).toBeUndefined()
  })

  it('refuses cancel once the rename has happened, and completes', async () => {
    const { consentToken } = await preview()
    const hold = gate()
    buildGate = hold.promise
    const { operationId } = await start({ source, type: 'local', accepted: true, consentToken })
    await waitUntil(() => getOperationRegistry().get(operationId)?.stages.find((s) => s.id === 'build')?.status === 'active', { label: 'commit building' })
    expect(getOperationRegistry().cancel(operationId)).toBe('not_cancellable')
    hold.open()
    const view = await getOperationRegistry().await(operationId)
    expect(view.status).toBe('succeeded')
    expect(readPluginLockfile().plugins.toolplug?.version).toBe('1.0.0')
  })
})
