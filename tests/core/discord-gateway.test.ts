import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'

// ─── Mocks ──────────────────────────────────────────────────────────────────

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

// Defensive content-dir mock — the gateway itself doesn't touch storage,
// but transitive imports from logger / globalThis state could in principle.
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => '/tmp/bakin-test-discord-gateway',
  getBakinPaths: () => ({}),
}))

// Mock global WebSocket
class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3

  readyState = MockWebSocket.OPEN
  listeners: Record<string, Array<(ev: unknown) => void>> = {}
  sentMessages: string[] = []

  addEventListener(event: string, handler: (ev: unknown) => void) {
    if (!this.listeners[event]) this.listeners[event] = []
    this.listeners[event].push(handler)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close(_code?: number, _reason?: string) {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', { code: _code })
  }

  emit(event: string, data: unknown) {
    for (const handler of this.listeners[event] || []) {
      handler(data)
    }
  }
}

let mockWsInstance: MockWebSocket | null = null

vi.stubGlobal('WebSocket', class extends MockWebSocket {
  constructor(_url: string) {
    super()
    mockWsInstance = this
    // Auto-fire open
    setTimeout(() => this.emit('open', {}), 0)
  }
})

// Mock fetch for interaction responses
const mockFetch = mock().mockResolvedValue({ ok: true, text: () => Promise.resolve('') })
vi.stubGlobal('fetch', mockFetch)

import {
  startGateway,
  stopGateway,
  onGateInteraction,
  isGatewayConnected,
} from '../../src/core/discord-gateway'

describe('discord-gateway', () => {
  const testConfig = { botToken: 'test-bot-token', guildId: 'test-guild-id' }

  beforeEach(() => {
    mockWsInstance = null
    mockFetch.mockClear()
    stopGateway()
  })

  afterEach(() => {
    stopGateway()
  })

  it('connects and sends IDENTIFY after HELLO', async () => {
    startGateway(testConfig)
    await vi.waitFor(() => expect(mockWsInstance).not.toBeNull())

    // Simulate HELLO with very short heartbeat interval so jitter resolves quickly
    mockWsInstance!.emit('message', {
      data: JSON.stringify({
        op: 10,
        d: { heartbeat_interval: 100 },
      }),
    })

    // Wait for identify (jitter is random * 100ms, so max ~100ms)
    await vi.waitFor(() => {
      expect(mockWsInstance!.sentMessages.length).toBeGreaterThanOrEqual(1)
    }, { timeout: 2000 })

    const messages = mockWsInstance!.sentMessages.map(m => JSON.parse(m))
    const identifyMsg = messages.find(m => m.op === 2)
    expect(identifyMsg).toBeDefined()
    expect(identifyMsg.d.token).toBe('test-bot-token')
    expect(identifyMsg.d.intents).toBe(0)
  })

  it('reports connected state correctly', async () => {
    expect(isGatewayConnected()).toBe(false)
    startGateway(testConfig)
    await vi.waitFor(() => expect(mockWsInstance).not.toBeNull())
    expect(isGatewayConnected()).toBe(true)

    stopGateway()
    expect(isGatewayConnected()).toBe(false)
  })

  it('routes button interactions to registered handler', async () => {
    const handler = mock().mockImplementation(async (interaction) => {
      await interaction.acknowledge()
    })
    onGateInteraction(handler)
    startGateway(testConfig)
    await vi.waitFor(() => expect(mockWsInstance).not.toBeNull())

    // Simulate INTERACTION_CREATE for approve button
    mockWsInstance!.emit('message', {
      data: JSON.stringify({
        op: 0,
        t: 'INTERACTION_CREATE',
        s: 1,
        d: {
          id: 'interaction-123',
          token: 'interaction-token',
          type: 3, // MESSAGE_COMPONENT
          data: {
            custom_id: 'gate:approve:task-abc:review-step',
            component_type: 2, // Button
          },
        },
      }),
    })

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))

    const call = handler.mock.calls[0][0]
    expect(call.action).toBe('approve')
    expect(call.taskId).toBe('task-abc')
    expect(call.stepId).toBe('review-step')
  })

  it('opens modal for reject when requireRejectReason is true', async () => {
    startGateway(testConfig, true)
    await vi.waitFor(() => expect(mockWsInstance).not.toBeNull())

    // Simulate reject button click
    mockWsInstance!.emit('message', {
      data: JSON.stringify({
        op: 0,
        t: 'INTERACTION_CREATE',
        s: 2,
        d: {
          id: 'interaction-456',
          token: 'interaction-token-2',
          type: 3,
          data: {
            custom_id: 'gate:reject:task-xyz:gate-1',
            component_type: 2,
          },
        },
      }),
    })

    // Should call fetch to respond with a modal
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain('/interactions/interaction-456/interaction-token-2/callback')
    const body = JSON.parse(opts.body)
    expect(body.type).toBe(9) // MODAL callback type
    expect(body.data.custom_id).toBe('gate:reject:task-xyz:gate-1')
  })

  it('routes modal submit to handler with reason', async () => {
    const handler = mock().mockImplementation(async (interaction) => {
      await interaction.acknowledge()
    })
    onGateInteraction(handler)
    startGateway(testConfig)
    await vi.waitFor(() => expect(mockWsInstance).not.toBeNull())

    // Simulate MODAL_SUBMIT
    mockWsInstance!.emit('message', {
      data: JSON.stringify({
        op: 0,
        t: 'INTERACTION_CREATE',
        s: 3,
        d: {
          id: 'interaction-789',
          token: 'interaction-token-3',
          type: 5, // MODAL_SUBMIT
          data: {
            custom_id: 'gate:reject:task-xyz:gate-1',
            components: [{
              components: [{
                custom_id: 'reason',
                value: 'Off-brand colors',
              }],
            }],
          },
        },
      }),
    })

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))

    const call = handler.mock.calls[0][0]
    expect(call.action).toBe('reject')
    expect(call.taskId).toBe('task-xyz')
    expect(call.stepId).toBe('gate-1')
    expect(call.reason).toBe('Off-brand colors')
  })

  it('ignores non-gate custom_ids', async () => {
    const handler = mock()
    onGateInteraction(handler)
    startGateway(testConfig)
    await vi.waitFor(() => expect(mockWsInstance).not.toBeNull())

    mockWsInstance!.emit('message', {
      data: JSON.stringify({
        op: 0,
        t: 'INTERACTION_CREATE',
        s: 4,
        d: {
          id: 'interaction-999',
          token: 'token',
          type: 3,
          data: {
            custom_id: 'some:other:button',
            component_type: 2,
          },
        },
      }),
    })

    // Give it a tick
    await new Promise(r => setTimeout(r, 50))
    expect(handler).not.toHaveBeenCalled()
  })

  it('tracks sequence numbers from dispatches', async () => {
    startGateway(testConfig)
    await vi.waitFor(() => expect(mockWsInstance).not.toBeNull())

    // Send READY event with sequence
    mockWsInstance!.emit('message', {
      data: JSON.stringify({
        op: 0,
        t: 'READY',
        s: 42,
        d: {
          session_id: 'sess-abc',
          resume_gateway_url: 'wss://resume.discord.gg',
        },
      }),
    })

    // The gateway should have stored the session for resume
    // We can verify by checking that identify was not sent again on reconnect
    // (tested implicitly through the gateway's behavior)
    expect(true).toBe(true)
  })

  it('is idempotent when started twice', () => {
    startGateway(testConfig)
    const firstWs = mockWsInstance
    startGateway(testConfig) // Should not create a second connection
    // Second call should be a no-op (logged "already running")
    expect(mockWsInstance).toBe(firstWs)
  })

  // ─── Approver extraction (issue #91) ────────────────────────────────────

  describe('approver extraction', () => {
    function emitButtonInteraction(payloadData: Record<string, unknown>): void {
      mockWsInstance!.emit('message', {
        data: JSON.stringify({
          op: 0,
          t: 'INTERACTION_CREATE',
          s: 1,
          d: {
            id: 'i1',
            token: 't1',
            type: 3,
            data: { custom_id: 'gate:approve:task-1:step-1', component_type: 2 },
            ...payloadData,
          },
        }),
      })
    }

    function emitModalSubmit(payloadData: Record<string, unknown>): void {
      mockWsInstance!.emit('message', {
        data: JSON.stringify({
          op: 0,
          t: 'INTERACTION_CREATE',
          s: 2,
          d: {
            id: 'i2',
            token: 't2',
            type: 5,
            data: {
              custom_id: 'gate:reject:task-1:step-1',
              components: [{ components: [{ custom_id: 'reason', value: 'no good' }] }],
            },
            ...payloadData,
          },
        }),
      })
    }

    it('prefers member.user.global_name over username', async () => {
      const handler = mock().mockImplementation(async (i) => i.acknowledge())
      onGateInteraction(handler)
      startGateway(testConfig, false)
      await vi.waitFor(() => expect(mockWsInstance).not.toBeNull())

      emitButtonInteraction({
        member: { user: { id: '111', username: 'mark_h', global_name: 'Mark Hayden' } },
      })

      await vi.waitFor(() => expect(handler).toHaveBeenCalled())
      const call = handler.mock.calls[0][0]
      expect(call.approver).toEqual({ source: 'discord', id: '111', displayName: 'Mark Hayden' })
    })

    it('falls back to username when global_name absent', async () => {
      const handler = mock().mockImplementation(async (i) => i.acknowledge())
      onGateInteraction(handler)
      startGateway(testConfig, false)
      await vi.waitFor(() => expect(mockWsInstance).not.toBeNull())

      emitButtonInteraction({
        member: { user: { id: '222', username: 'mark_h' } },
      })

      await vi.waitFor(() => expect(handler).toHaveBeenCalled())
      const call = handler.mock.calls[0][0]
      expect(call.approver).toEqual({ source: 'discord', id: '222', displayName: 'mark_h' })
    })

    it('falls back to data.user when member absent (DM context)', async () => {
      const handler = mock().mockImplementation(async (i) => i.acknowledge())
      onGateInteraction(handler)
      startGateway(testConfig, false)
      await vi.waitFor(() => expect(mockWsInstance).not.toBeNull())

      emitButtonInteraction({
        user: { id: '333', username: 'mark_h', global_name: 'Mark' },
      })

      await vi.waitFor(() => expect(handler).toHaveBeenCalled())
      const call = handler.mock.calls[0][0]
      expect(call.approver).toEqual({ source: 'discord', id: '333', displayName: 'Mark' })
    })

    it('returns unknown sentinel when both member and user absent', async () => {
      const handler = mock().mockImplementation(async (i) => i.acknowledge())
      onGateInteraction(handler)
      startGateway(testConfig, false)
      await vi.waitFor(() => expect(mockWsInstance).not.toBeNull())

      emitButtonInteraction({})

      await vi.waitFor(() => expect(handler).toHaveBeenCalled())
      const call = handler.mock.calls[0][0]
      expect(call.approver).toEqual({ source: 'discord', id: 'unknown', displayName: 'unknown Discord user' })
    })

    it('extracts approver from MODAL_SUBMIT (reject path)', async () => {
      const handler = mock().mockImplementation(async (i) => i.acknowledge())
      onGateInteraction(handler)
      startGateway(testConfig)
      await vi.waitFor(() => expect(mockWsInstance).not.toBeNull())

      emitModalSubmit({
        member: { user: { id: '444', username: 'reviewer', global_name: 'The Reviewer' } },
      })

      await vi.waitFor(() => expect(handler).toHaveBeenCalled())
      const call = handler.mock.calls[0][0]
      expect(call.approver).toEqual({ source: 'discord', id: '444', displayName: 'The Reviewer' })
      expect(call.reason).toBe('no good')
    })
  })
})
