import { describe, it, expect, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

// We test the SSE module's event buffer and ID logic
// by importing the module and calling broadcast/getCurrentEventId

// sse.ts reaches getSettings (handleSSE path) — pin the content dir to a
// temp home so nothing can ever touch ~/.bakin (CLAUDE.md isolation rules).
const testDir = join(tmpdir(), `bakin-test-sse-${Date.now()}-${randomUUID()}`)
const mockedContentDir = {
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    settings: join(testDir, 'settings.json'),
    db: join(testDir, 'bakin.db'),
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
  }),
}
mock.module('../../src/core/content-dir', () => mockedContentDir)
mock.module('../../packages/core/src/content-dir', () => mockedContentDir)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}))

describe('SSE module', () => {
  // Since SSE holds module-level state, we test the exported functions
  // The actual ServerResponse writing is hard to unit test, so we focus on
  // the event ID and buffer logic

  it('should export expected functions', async () => {
    const sse = await import('@/core/sse')
    expect(typeof sse.broadcast).toBe('function')
    expect(typeof sse.broadcastEphemeral).toBe('function')
    expect(typeof sse.broadcastAuditEvent).toBe('function')
    expect(typeof sse.handleSSE).toBe('function')
    expect(typeof sse.getClientCount).toBe('function')
    expect(typeof sse.getCurrentEventId).toBe('function')
    expect(typeof sse.stop).toBe('function')
  })

  it('broadcastEphemeral never enters the replay buffer or advances event ids', async () => {
    const sse = await import('@/core/sse')
    const state = (globalThis as { __bakinSSEState?: { eventCounter: number; eventBuffer: { id: number; data: string }[] } }).__bakinSSEState
    expect(state).toBeDefined()

    const bufferBefore = state!.eventBuffer.length
    const idBefore = sse.getCurrentEventId()

    sse.broadcastEphemeral({ type: 'turn-activity', taskId: 't1', chunk: { type: 'status' } })

    // Ephemeral: no buffer entry, no id consumed — a reconnecting client's
    // Last-Event-ID replay window is untouched by any volume of these.
    expect(state!.eventBuffer.length).toBe(bufferBefore)
    expect(sse.getCurrentEventId()).toBe(idBefore)

    // Durable broadcast still buffers + advances, proving the seam split.
    sse.broadcast({ type: 'durable-probe' })
    expect(state!.eventBuffer.length).toBe(bufferBefore + 1)
    expect(sse.getCurrentEventId()).toBe(idBefore + 1)
    expect(state!.eventBuffer.at(-1)?.data).toContain('durable-probe')
    expect(state!.eventBuffer.some((e) => e.data.includes('turn-activity'))).toBe(false)
  })

  it('exposes the ephemeral seam on globalThis', async () => {
    const sse = await import('@/core/sse')
    const g = globalThis as { __bakinBroadcastEphemeral?: unknown }
    expect(g.__bakinBroadcastEphemeral).toBe(sse.broadcastEphemeral)
  })
})
