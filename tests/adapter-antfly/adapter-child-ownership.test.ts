/** Strict-child lifecycle with no supervisor, real engine, or port traffic. */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'events'
import { closeSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ChildProcess } from 'child_process'
import type { ServiceIo } from '../../packages/adapter-antfly/src/service'

const sandbox = mkdtempSync(join(tmpdir(), 'bakin-test-child-ownership-'))
const home = join(sandbox, 'home')
const engineHome = join(sandbox, 'engine')
const savedEnv = {
  HOME: process.env.HOME,
  BAKIN_HOME: process.env.BAKIN_HOME,
  OPENCLAW_HOME: process.env.OPENCLAW_HOME,
  ANTFLY_HOME: process.env.ANTFLY_HOME,
  ANTFLY_PATH: process.env.ANTFLY_PATH,
}
process.env.HOME = join(sandbox, 'os-home')
process.env.BAKIN_HOME = home
process.env.OPENCLAW_HOME = join(sandbox, 'openclaw')
process.env.ANTFLY_HOME = engineHome
process.env.ANTFLY_PATH = join(engineHome, 'bin', 'antfly')
const contentDirMock = () => ({
  getContentDir: () => home,
  getBakinPaths: () => ({
    home,
    logs: join(home, 'logs'),
    db: join(home, 'bakin.db'),
    media: join(home, 'media'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(sandbox, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(sandbox, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

let occupied = false
const logDescriptors: number[] = []
const spawnChild = mock((_command: string, _args: string[], options: { stdio: [string, number, number] }) => {
  logDescriptors.push(options.stdio[1])
  occupied = true
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    exitCode: null as number | null,
    kill: mock(() => {
      occupied = false
      child.exitCode = 0
      child.emit('exit', 0)
      return true
    }),
  })
  return child as unknown as ChildProcess
})
mock.module('child_process', () => ({ spawn: spawnChild }))

const { AntflyAdapter } = await import('../../packages/adapter-antfly/src/adapter')
const { stopChild } = await import('../../packages/adapter-antfly/src/service')
const { SearchEngineUnavailableError } = await import('../../packages/core/src/adapters/search/errors')
const originalFetch = globalThis.fetch
const requests = mock(async () => Response.json({ health: 'ok' }))
const portsReleased = mock(async () => !occupied)
const io: ServiceIo = {
  platform: 'linux',
  env: { HOME: join(sandbox, 'os-home') },
  hasCommand: () => false,
  tempRoots: [],
  modelReady: () => false,
  portsReleased,
  exec: async () => { throw new Error('A supervisor-free child must not run supervisor commands') },
}

beforeEach(() => {
  occupied = false
  spawnChild.mockClear()
  portsReleased.mockClear()
  requests.mockClear()
  globalThis.fetch = requests as unknown as typeof fetch
  mkdirSync(join(engineHome, 'bin'), { recursive: true })
  writeFileSync(join(engineHome, 'bin', 'antfly'), 'never executed; spawn is fake')
})
afterEach(() => {
  stopChild()
  process.removeListener('exit', stopChild)
  for (const fd of logDescriptors.splice(0)) {
    try { closeSync(fd) } catch { /* The implementation may already have closed its parent descriptor. */ }
  }
  globalThis.fetch = originalFetch
  rmSync(join(engineHome, 'service.lock'), { force: true })
})
afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(sandbox, { recursive: true, force: true })
})

describe('strict-child adapter ownership', () => {
  it('reinitializing its running child remains available without spawning or checking occupied ports again', async () => {
    const adapter = new AntflyAdapter({ serviceIo: io })
    await adapter.initialize()
    expect(await adapter.available()).toBe(true)
    expect(occupied).toBe(true)

    await adapter.initialize()

    expect(await adapter.available()).toBe(true)
    expect(spawnChild).toHaveBeenCalledTimes(1)
    expect(portsReleased).toHaveBeenCalledTimes(1)
    expect(requests).toHaveBeenCalledTimes(2)
  })

  it('an unrelated listener blocks the first child start and all search HTTP', async () => {
    occupied = true
    const adapter = new AntflyAdapter({ serviceIo: io })

    await adapter.initialize()

    expect(await adapter.available()).toBe(false)
    await expect(adapter.documents.index('tasks', 'queued', { title: 'local only' })).rejects.toBeInstanceOf(SearchEngineUnavailableError)
    expect(spawnChild).not.toHaveBeenCalled()
    expect(portsReleased).toHaveBeenCalledTimes(1)
    expect(requests).not.toHaveBeenCalled()
  })

  it('a failed initialization stays unavailable until initialization succeeds', async () => {
    occupied = true
    const adapter = new AntflyAdapter({ serviceIo: io })
    await adapter.initialize()
    occupied = false

    expect(await adapter.available()).toBe(false)
    expect(requests).not.toHaveBeenCalled()
    await adapter.initialize()

    expect(await adapter.available()).toBe(true)
    expect(spawnChild).toHaveBeenCalledTimes(1)
  })

  it('a busy service lock overrides cached child availability before any further HTTP', async () => {
    const adapter = new AntflyAdapter({ serviceIo: io })
    await adapter.initialize()
    expect(await adapter.available()).toBe(true)
    writeFileSync(join(engineHome, 'service.lock'), '')

    expect(await adapter.available()).toBe(false)
    await expect(adapter.documents.index('tasks', 'queued', { title: 'local only' })).rejects.toBeInstanceOf(SearchEngineUnavailableError)
    expect(requests).toHaveBeenCalledTimes(1)
  })
})
