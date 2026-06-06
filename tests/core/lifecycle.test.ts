import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Server } from 'http'

const testDir = join(tmpdir(), `bakin-test-lifecycle-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir }),
}))

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

const mockAppendAudit = mock()
mock.module('../../src/core/audit', () => ({
  appendAudit: mockAppendAudit,
}))

const mockSseStop = mock()
mock.module('../../src/core/sse', () => ({
  stop: mockSseStop,
  broadcast: mock(),
}))

const mockDispatchStop = mock()
mock.module('../../src/core/dispatch', () => ({
  stop: mockDispatchStop,
}))

const mockWatchdogStop = mock()
mock.module('../../src/core/watchdog', () => ({
  stop: mockWatchdogStop,
}))

const mockWatcherStop = mock().mockResolvedValue(undefined)
mock.module('../../src/core/watcher', () => ({
  stop: mockWatcherStop,
  registerSyncHook: () => () => {},
  registerUnlinkHook: () => () => {},
}))

mock.module('../../src/core/doctor', () => ({
  stop: mock(),
}))

const mockSearchShutdown = mock().mockResolvedValue(undefined)
const mockAppServices = {
  search: { shutdown: mockSearchShutdown },
}
mock.module('../../src/core/app-services', () => ({
  maybeGetAppServices: () => mockAppServices,
  getAppServices: () => mockAppServices,
  setAppServices: () => {},
  createAppServices: async () => mockAppServices,
}))

const mockShutdownAll = mock().mockResolvedValue(undefined)
mock.module('../../src/lib/plugin-registry', () => ({
  pluginRegistry: {
    shutdownAll: mockShutdownAll,
  },
  getHookRegistry: () => ({
    invoke: async () => undefined,
    has: () => false,
    register: () => () => {},
  }),
}))

describe('lifecycle', () => {
  let processListeners: Record<string, Function>
  let registerShutdownHandlers: typeof import('../../src/core/lifecycle').registerShutdownHandlers

  beforeEach(async () => {
    mock.clearAllMocks()
    processListeners = {}

    spyOn(process, 'on').mockImplementation((event: string | symbol, handler: any) => {
      processListeners[event as string] = handler
      return process
    })
    spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.useFakeTimers()

    const mod = await import('../../src/core/lifecycle')
    registerShutdownHandlers = mod.registerShutdownHandlers
    // bun:test has no vi.resetModules; reset the shutdownInProgress flag
    // via the module's test hook.
    mod._resetShutdownStateForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    mock.restore()
  })

  function mockServer(): Server {
    return { close: mock((cb: () => void) => cb()) } as unknown as Server
  }

  it('registers SIGTERM and SIGINT handlers', () => {
    registerShutdownHandlers(mockServer(), '/tmp/test')
    expect(processListeners['SIGTERM']).toBeDefined()
    expect(processListeners['SIGINT']).toBeDefined()
  })

  it('shutdown calls pluginRegistry.shutdownAll', async () => {
    registerShutdownHandlers(mockServer(), '/tmp/test')
    await processListeners['SIGTERM']()
    expect(mockShutdownAll).toHaveBeenCalled()
  })

  it('shutdown stops dispatch, watchdog, watcher, adapters, and SSE', async () => {
    registerShutdownHandlers(mockServer(), '/tmp/test')
    await processListeners['SIGTERM']()

    expect(mockDispatchStop).toHaveBeenCalled()
    expect(mockWatchdogStop).toHaveBeenCalled()
    expect(mockWatcherStop).toHaveBeenCalled()
    expect(mockSearchShutdown).toHaveBeenCalled()
    expect(mockSseStop).toHaveBeenCalled()
  })

  it('shutdown closes the HTTP server', async () => {
    const server = mockServer()
    registerShutdownHandlers(server, '/tmp/test')
    await processListeners['SIGTERM']()
    expect(server.close).toHaveBeenCalled()
  })

  it('shutdown writes audit entry', async () => {
    registerShutdownHandlers(mockServer(), '/tmp/test')
    await processListeners['SIGINT']()
    expect(mockAppendAudit).toHaveBeenCalledWith(
      '/tmp/test',
      'system.shutdown',
      'system',
      { signal: 'SIGINT' },
    )
  })

  it('shutdown is idempotent — second signal is ignored', async () => {
    registerShutdownHandlers(mockServer(), '/tmp/test')
    await processListeners['SIGTERM']()
    await processListeners['SIGTERM']()
    expect(mockShutdownAll).toHaveBeenCalledTimes(1)
  })

  it('marks shutdown ownership so dev.ts defers instead of preempting (#459)', async () => {
    // scripts/dev.ts's earlier-registered signal handlers consult this flag;
    // when set they must NOT call process.exit, or the async shutdown above
    // never runs and the antfly child is orphaned.
    const mod = await import('../../src/core/lifecycle')
    expect(mod.lifecycleOwnsShutdown()).toBe(false)
    registerShutdownHandlers(mockServer(), '/tmp/test')
    expect(mod.lifecycleOwnsShutdown()).toBe(true)
    expect((globalThis as Record<string, unknown>).__bakinLifecycleOwnsShutdown).toBe(true)
  })

  it('honors a pre-set failure exitCode instead of stamping success (#459)', async () => {
    // EADDRINUSE handling sets process.exitCode = 1 before routing through
    // the graceful shutdown — the final exit must carry it.
    const previousExitCode = process.exitCode
    process.exitCode = 1
    try {
      registerShutdownHandlers(mockServer(), '/tmp/test')
      await processListeners['SIGTERM']()
      vi.advanceTimersByTime(1100)
      expect(process.exit).toHaveBeenCalledWith(1)
    } finally {
      process.exitCode = previousExitCode
    }
  })
})
