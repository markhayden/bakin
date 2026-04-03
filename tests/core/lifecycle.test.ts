import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Server } from 'http'

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const mockAppendAudit = vi.fn()
vi.mock('../../src/core/audit', () => ({
  appendAudit: mockAppendAudit,
}))

const mockSseStop = vi.fn()
vi.mock('../../src/core/sse', () => ({
  stop: mockSseStop,
}))

const mockDispatchStop = vi.fn()
vi.mock('../../src/core/dispatch', () => ({
  stop: mockDispatchStop,
}))

const mockWatchdogStop = vi.fn()
vi.mock('../../src/core/watchdog', () => ({
  stop: mockWatchdogStop,
}))

const mockCalendarStop = vi.fn()
vi.mock('../../src/core/calendar-cron', () => ({
  stop: mockCalendarStop,
}))

const mockWatcherStop = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/core/watcher', () => ({
  stop: mockWatcherStop,
}))

vi.mock('../../src/core/doctor', () => ({
  stop: vi.fn(),
}))

vi.mock('../../src/core/antfly-server', () => ({
  stop: vi.fn(),
}))

const mockShutdownAll = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/lib/plugin-registry', () => ({
  pluginRegistry: {
    shutdownAll: mockShutdownAll,
  },
}))

describe('lifecycle', () => {
  let processListeners: Record<string, Function>
  let registerShutdownHandlers: typeof import('../../src/core/lifecycle').registerShutdownHandlers

  beforeEach(async () => {
    vi.clearAllMocks()
    processListeners = {}

    vi.spyOn(process, 'on').mockImplementation((event: string | symbol, handler: any) => {
      processListeners[event as string] = handler
      return process
    })
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.useFakeTimers()

    // Reset module to get fresh shutdownInProgress state
    vi.resetModules()
    const mod = await import('../../src/core/lifecycle')
    registerShutdownHandlers = mod.registerShutdownHandlers
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function mockServer(): Server {
    return { close: vi.fn((cb: () => void) => cb()) } as unknown as Server
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

  it('shutdown stops dispatch, watchdog, calendar cron, watcher, and SSE', async () => {
    registerShutdownHandlers(mockServer(), '/tmp/test')
    await processListeners['SIGTERM']()

    expect(mockDispatchStop).toHaveBeenCalled()
    expect(mockWatchdogStop).toHaveBeenCalled()
    expect(mockCalendarStop).toHaveBeenCalled()
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
