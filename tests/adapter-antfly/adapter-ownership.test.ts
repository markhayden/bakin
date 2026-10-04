import { afterAll, beforeEach, expect, it, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
const root = mkdtempSync(join(tmpdir(), 'bakin-adapter-ownership-'))
const home = join(root, 'home')
process.env.ANTFLY_HOME = join(root, 'engine')
const paths = () => ({ getContentDir: () => home, getBakinPaths: () => ({ home, db: join(home, 'bakin.db'), logs: join(home, 'logs') }) })
mock.module('../../src/core/content-dir', paths)
mock.module('../../packages/core/src/content-dir', paths)
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(root, 'openclaw'), getOpenClawPath: (...p: string[]) => join(root, 'openclaw', ...p), resetOpenClawHome: () => {} }))
const logger = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../src/core/logger', logger)
mock.module('../../packages/core/src/logger', logger)
const { AntflyAdapter } = await import('../../packages/adapter-antfly/src/adapter')
const { DEFAULT_SETTINGS } = await import('../../packages/adapter-antfly/src/defaults')
const { renderLaunchdPlist, buildServiceArgv, servicePaths, launchdPlistPath } = await import('../../packages/adapter-antfly/src/service')
const { configureOutboxPump, enqueueIndex, nudgeOutboxPump, outboxStats, stopOutboxPump } = await import('../../src/core/search-outbox')
const { resetOutboxForTests } = await import('../../packages/core/src/search/outbox')
const { closeAllDbs } = await import('../../packages/core/src/storage/db')
const { SearchEngineUnavailableError } = await import('../../packages/core/src/adapters/search/errors')
import type { ServiceIo } from '../../packages/adapter-antfly/src/service'
const io: ServiceIo = {
  platform: 'darwin', env: { HOME: join(root, 'os') }, tempRoots: [],
  hasCommand: () => true, modelReady: () => false, portsReleased: async () => true,
  exec: mock(async () => ({ code: 0, stdout: '', stderr: '' })),
}
const requests = mock(async () => Response.json({ health: 'ok' }))
const originalFetch = globalThis.fetch
globalThis.fetch = requests as unknown as typeof fetch
function seed(owner: string) {
  const unit = launchdPlistPath(io)
  mkdirSync(dirname(unit), { recursive: true })
  const paths = { ...servicePaths(), dataDir: join(owner, 'antfly'), logFile: join(owner, 'logs', 'antfly.log') }
  writeFileSync(unit, renderLaunchdPlist(buildServiceArgv(DEFAULT_SETTINGS, paths, { modelReady: () => false }), paths.logFile))
  return readFileSync(unit, 'utf8')
}
beforeEach(() => {
  stopOutboxPump()
  resetOutboxForTests()
  requests.mockClear()
  ;(io.exec as ReturnType<typeof mock>).mockClear()
  io.tempRoots = []
})
afterAll(() => {
  globalThis.fetch = originalFetch
  stopOutboxPump()
  closeAllDbs()
  rmSync(root, { recursive: true, force: true })
})

it('foreign boot completes with zero HTTP and retains real outbox work as transient', async () => {
  const original = seed(join(root, 'other'))
  const adapter = new AntflyAdapter({ serviceIo: io })
  await adapter.initialize()
  expect(await adapter.available()).toBe(false)
  await Promise.allSettled([
    adapter.query('t', { text: 'query' }), adapter.multiQuery([{ table: 't', query: { text: 'q' } }]),
    adapter.tables.list(), adapter.tables.create('t', { fields: {} }), adapter.tables.drop('t'), adapter.tables.stats('t'), adapter.tables.health('t'),
    adapter.documents.index('t', 'k', {}), adapter.documents.remove('t', 'k'), adapter.documents.get('t', 'k'),
    adapter.documents.batchRemove('t', ['k']), adapter.documents.transform('t', 'k', (doc) => doc),
    adapter.rerank('q', ['a']), (async () => { for await (const row of adapter.scan('t', {})) void row })(),
  ])
  await expect(adapter.documents.batchIndex('t', [{ key: 'k', doc: {} }])).rejects.toBeInstanceOf(SearchEngineUnavailableError)
  configureOutboxPump({ adapter, resolveTargets: (logical) => [logical] })
  enqueueIndex('t', 'pending', { title: 'stays local' })
  expect((await nudgeOutboxPump())?.failedTransient).toBe(1)
  expect(outboxStats().pending).toBe(1)
  expect(outboxStats().quarantined).toBe(0)
  expect(requests).not.toHaveBeenCalled()
  expect(io.exec).not.toHaveBeenCalled()
  expect(readFileSync(launchdPlistPath(io), 'utf8')).toBe(original)
})

it('transfer revokes cached availability and every subsequent HTTP request', async () => {
  seed(home)
  const adapter = new AntflyAdapter({ serviceIo: io })
  await adapter.initialize()
  expect(await adapter.available()).toBe(true)
  expect(requests).toHaveBeenCalledTimes(1)
  seed(join(root, 'other'))
  expect(await adapter.available()).toBe(false)
  await expect(adapter.documents.index('t', 'k', {})).rejects.toBeInstanceOf(SearchEngineUnavailableError)
  expect(requests).toHaveBeenCalledTimes(1)
})

it('temporary default home stays blocked across initialization and can use an explicit guest', async () => {
  seed(home)
  io.tempRoots = [root]
  const adapter = new AntflyAdapter({ serviceIo: io })
  await adapter.initialize()
  expect(await adapter.available()).toBe(false)
  await adapter.initialize({ contentDir: home, settings: { url: 'http://isolated:3838' } })
  expect(await adapter.available()).toBe(true)
  await adapter.initialize({ contentDir: home, settings: { url: DEFAULT_SETTINGS.url } })
  expect(await adapter.available()).toBe(false)
  expect(requests).toHaveBeenCalledTimes(1)
  expect(io.exec).not.toHaveBeenCalled()
})

it('a deferred scan cannot authorize its old default endpoint with new guest settings', async () => {
  seed(join(root, 'other'))
  const adapter = new AntflyAdapter({ serviceIo: io })
  await adapter.initialize()
  const scan = adapter.scan('t', {})
  await adapter.initialize({ contentDir: home, settings: { url: 'http://isolated:3838' } })
  await expect((async () => { for await (const row of scan) void row })()).rejects.toBeInstanceOf(SearchEngineUnavailableError)
  expect(requests).not.toHaveBeenCalled()
  expect(await adapter.available()).toBe(true)
})
