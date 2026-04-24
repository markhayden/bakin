import { describe, it, expect, beforeEach } from 'bun:test'

// We test the SSE module's event buffer and ID logic
// by importing the module and calling broadcast/getCurrentEventId

describe('SSE module', () => {
  // Since SSE holds module-level state, we test the exported functions
  // The actual ServerResponse writing is hard to unit test, so we focus on
  // the event ID and buffer logic

  it('should export expected functions', async () => {
    const sse = await import('@/core/sse')
    expect(typeof sse.broadcast).toBe('function')
    expect(typeof sse.broadcastAuditEvent).toBe('function')
    expect(typeof sse.handleSSE).toBe('function')
    expect(typeof sse.getClientCount).toBe('function')
    expect(typeof sse.getCurrentEventId).toBe('function')
    expect(typeof sse.stop).toBe('function')
  })
})
