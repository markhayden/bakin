import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import type { Server } from 'http'

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
}))

const mockDispatchStop = mock()
mock.module('../../src/core/dispatch', () => ({
  stop: mockDispatchStop,
}))

const mockWatchdogStop = mock()
mock.module('../../src/core/watchdog', () => ({
  stop: mockWatchdogStop,
}))

const mockMessagingStop = mock()
mock.module('../../src/core/messaging-cron', () => ({
  stop: mockMessagingStop,
}))

const mockWatcherStop = mock().mockResolvedValue(undefined)
mock.module('../../src/core/watcher', () => ({
  stop: mockWatcherStop,
}))

mock.module('../../src/core/doctor', () => ({
  stop: mock(),
}))

mock.module('../../src/core/antfly-server', () => ({
  stop: mock(),
}))

const mockShutdownAll = mock().mockResolvedValue(undefined)
mock.module('../../src/lib/plugin-registry', () => ({
  pluginRegistry: {
    shutdownAll: mockShutdownAll,
  },
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

  it('shutdown stops dispatch, watchdog, messaging cron, watcher, and SSE', async () => {
    registerShutdownHandlers(mockServer(), '/tmp/test')
    await processListeners['SIGTERM']()

    expect(mockDispatchStop).toHaveBeenCalled()
    expect(mockWatchdogStop).toHaveBeenCalled()
    expect(mockMessagingStop).toHaveBeenCalled()
    expect(mockWatcherStop).toHaveBeenCalled()
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
})
