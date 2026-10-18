/**
 * Local search setup installs (#895, D7): identity covers the settings the
 * install depends on, and the component is built from the settings in force
 * once `search-engine` is held — never from a snapshot taken before the wait.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-search-setup-install-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import type { SearchAdapterSetupComponent, SearchAdapterSetupOptions } from '@bakin/core/adapters/search'
import { holdNow } from '@bakin/core/operations'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../src/core/operations'
import { installSearchComponentLocally } from '../../src/core/search-setup-install'
import { waitUntil } from '../helpers/wait'

const plan = { stages: [{ id: 'download', kind: 'downloading' as const, label: 'Download' }], pointOfNoReturn: null }
let models: string[] = []
const installedWith: string[][] = []

function resolve() {
  const snapshot = [...models]
  const component: SearchAdapterSetupComponent = {
    name: 'models',
    plan,
    check: async () => ({ name: 'models', status: 'ok', message: '' }),
    install: async (_opts: SearchAdapterSetupOptions) => {
      installedWith.push(snapshot)
      return { name: 'models', status: 'installed', message: `Pulled ${snapshot.join(', ')}`, durationMs: 0 }
    },
  }
  return { component, settings: { models: snapshot } }
}

const approved = { interactive: false, autoApprove: true, json: false }
const meta = { kind: 'install:search-models' as const, title: 'Download the search models', failureCode: 'models_install_failed' }

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  models = ['embedder']
  installedWith.length = 0
  _resetOperationRegistryForTests()
})
afterEach(() => _resetOperationRegistryForTests())
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('installSearchComponentLocally', () => {
  it('a request for other settings never attaches to a waiting install, and each runs on the settings in force when it starts', async () => {
    let release!: () => void
    const held = holdNow(['search-engine'], { title: 'Reset the search engine' }, () => new Promise<void>((r) => { release = r }))

    const first = installSearchComponentLocally(resolve, approved, meta)
    await waitUntil(() => getOperationRegistry().list().some((v) => v.waitingFor), { label: 'the first install waits for search-engine' })
    models = ['embedder', 'reranker']
    const second = installSearchComponentLocally(resolve, approved, meta)
    await waitUntil(() => getOperationRegistry().list().length === 2, { label: 'the second request is its own operation' })

    release()
    await held
    const [a, b] = await Promise.all([first, second])

    expect(a.status).toBe('installed')
    expect(b.status).toBe('installed')
    // The first request's settings moved while it waited, so it started again
    // under the current identity and attached to the second: one install, on
    // the settings in force.
    expect(installedWith).toEqual([['embedder', 'reranker']])
    expect(a.message).toBe('Pulled embedder, reranker')
    expect(b.message).toBe('Pulled embedder, reranker')
  })

  it('settings that flip A → B → A never hand an A request a result installed for B', async () => {
    let entered = 0
    let open!: () => void
    const gate = new Promise<void>((r) => { open = r })
    const gated = () => {
      const resolved = resolve()
      const install = resolved.component.install
      return { ...resolved, component: { ...resolved.component, install: async (o: SearchAdapterSetupOptions) => { entered += 1; await gate; return install(o) } } }
    }
    let release!: () => void
    const held = holdNow(['search-engine'], { title: 'Reset the search engine' }, () => new Promise<void>((r) => { release = r }))
    const first = installSearchComponentLocally(gated, approved, meta)
    await waitUntil(() => getOperationRegistry().list().some((v) => v.waitingFor), { label: 'the A install waits for search-engine' })

    models = ['embedder', 'reranker']
    release()
    await held
    await waitUntil(() => entered === 1, { label: 'the install is running with B' })
    models = ['embedder']
    const third = installSearchComponentLocally(gated, approved, meta)
    open()
    const [a, c] = await Promise.all([first, third])

    expect(a.message).toBe('Pulled embedder, reranker')
    expect(c.message).toBe('Pulled embedder')
    expect(installedWith).toEqual([['embedder', 'reranker'], ['embedder']])
  })

  it('an identical request attaches to the install already queued', async () => {
    let release!: () => void
    const held = holdNow(['search-engine'], { title: 'Reset the search engine' }, () => new Promise<void>((r) => { release = r }))

    const first = installSearchComponentLocally(resolve, approved, meta)
    const second = installSearchComponentLocally(resolve, approved, meta)
    await waitUntil(() => getOperationRegistry().list().some((v) => v.waitingFor), { label: 'the install waits for search-engine' })
    expect(getOperationRegistry().list()).toHaveLength(1)

    release()
    await held
    await Promise.all([first, second])
    expect(installedWith).toHaveLength(1)
  })
})
