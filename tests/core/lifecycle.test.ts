import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import type { Server } from 'http'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

// Defensive content-dir mocks (CLAUDE.md test isolation rules) — lifecycle
// transitively imports server-lock → content-dir; nothing here may ever
// resolve to the real ~/.bakin/.
const lifecycleTestDir = '/tmp/bakin-lifecycle-test-sentinel'
const contentDirMock = () => ({
  getContentDir: () => lifecycleTestDir,
  getBakinPaths: () => ({ home: lifecycleTestDir, db: `${lifecycleTestDir}/bakin.db`, logs: `${lifecycleTestDir}/logs`, audit: `${lifecycleTestDir}/audit.jsonl` }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

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

const mockReleaseServerLock = mock()
mock.module('../../src/core/server-lock', () => ({
  releaseServerLock: mockReleaseServerLock,
  acquireServerLock: mock(() => ({ acquired: true })),
  readServerLock: mock(() => null),
  formatBindFailureHelp: (port: number) => `port ${port}`,
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
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
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
      { signal: 'SIGINT', exitCode: 0 },
    )
  })

  it('shutdown releases the server singleton lock', async () => {
    registerShutdownHandlers(mockServer(), '/tmp/test')
    await processListeners['SIGTERM']()
    expect(mockReleaseServerLock).toHaveBeenCalled()
  })

  it('triggerShutdown runs the full chain outside a signal (EADDRINUSE path, #459)', async () => {
    const mod = await import('../../src/core/lifecycle')
    const server = mockServer()
    registerShutdownHandlers(server, '/tmp/test')

    mod.triggerShutdown('EADDRINUSE', 1)
    // Drain the async chain (the trigger is fire-and-forget by design).
    await vi.advanceTimersByTimeAsync(10)

    // The antfly child lives behind search.shutdown — it MUST be reached.
    expect(mockSearchShutdown).toHaveBeenCalled()
    expect(mockReleaseServerLock).toHaveBeenCalled()
    expect(mockAppendAudit).toHaveBeenCalledWith(
      '/tmp/test',
      'system.shutdown',
      'system',
      { signal: 'EADDRINUSE', exitCode: 1 },
    )
  })

  it('shutdown is idempotent — second signal is ignored', async () => {
    registerShutdownHandlers(mockServer(), '/tmp/test')
    await processListeners['SIGTERM']()
    await processListeners['SIGTERM']()
    expect(mockShutdownAll).toHaveBeenCalledTimes(1)
  })
})
