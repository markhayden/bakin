import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

function installOpenClawCliRecorder(testDir: string): { binaryPath: string; calls: () => string[][] } {
  const cliLog = join(testDir, `openclaw-cli-calls-${randomUUID()}.jsonl`)
  const shimPath = join(testDir, `openclaw-shim-${randomUUID()}.ts`)
  writeFileSync(shimPath, [
    '#!/usr/bin/env bun',
    'import { appendFileSync } from "fs"',
    'appendFileSync(process.env.OPENCLAW_CLI_LOG!, JSON.stringify(process.argv.slice(2)) + "\\n")',
    'process.stdout.write(JSON.stringify({ ok: true, messageId: "discord-message-123" }))',
    '',
  ].join('\n'), 'utf-8')
  chmodSync(shimPath, 0o755)
  process.env.OPENCLAW_CLI_LOG = cliLog

  return {
    binaryPath: shimPath,
    calls: () => readFileSync(cliLog, 'utf-8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
  }
}

function messageArg(call: string[]): string {
  const index = call.indexOf('--message')
  return index >= 0 ? call[index + 1] ?? '' : ''
}

describe('OpenClaw runtime channels', () => {
  let testDir: string
  let originalOpenClawHome: string | undefined
  let originalOpenClawCliLog: string | undefined
  let originalFetch: typeof globalThis.fetch
  let originalWebSocket: typeof globalThis.WebSocket

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-channel-test-'))
    originalOpenClawHome = process.env.OPENCLAW_HOME
    originalOpenClawCliLog = process.env.OPENCLAW_CLI_LOG
    originalFetch = globalThis.fetch
    originalWebSocket = globalThis.WebSocket
    FakeWebSocket.instances.length = 0
    process.env.OPENCLAW_HOME = testDir
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, 'openclaw.json'), JSON.stringify({
      gateway: { auth: { token: 'test-token' } },
      channels: {
        discord: { token: 'discord-token' },
      },
    }), 'utf-8')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
    if (originalOpenClawCliLog === undefined) delete process.env.OPENCLAW_CLI_LOG
    else process.env.OPENCLAW_CLI_LOG = originalOpenClawCliLog
    rmSync(testDir, { recursive: true, force: true })
  })

  it('lists configured channels without claiming interactive approval support', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const channels = await runtime.channels.list()
    expect(channels).toEqual([expect.objectContaining({
      id: 'discord',
      capabilities: ['message', 'rich-content'],
      metadata: expect.objectContaining({ approvalResponses: 'render-only' }),
    })])
  })

  it('advertises interactive approvals only for configured native approval channels', async () => {
    writeFileSync(join(testDir, 'openclaw.json'), JSON.stringify({
      gateway: { auth: { token: 'test-token' } },
      channels: {
        discord: {
          token: 'discord-token',
          execApprovals: { enabled: true, approvers: ['202168845362921483'], target: 'both' },
        },
      },
    }), 'utf-8')

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const channels = await runtime.channels.list()
    expect(channels).toEqual([expect.objectContaining({
      id: 'discord',
      capabilities: ['message', 'rich-content', 'interactive-approval'],
      metadata: expect.objectContaining({
        approvalResponses: 'interactive',
        approvalMode: 'openclaw-plugin-approval',
      }),
    })])
  })

  it('sends channel messages through the OpenClaw message CLI without requiring a Gateway tool', async () => {
    const calls: Array<Record<string, unknown>> = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify({
        ok: false,
        error: { type: 'not_found', message: 'Tool not available: message_send' },
      }), { status: 404 })
    }) as unknown as typeof fetch

    const recorder = installOpenClawCliRecorder(testDir)
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: recorder.binaryPath } })
    await runtime.initialize({ contentDir: testDir })

    const result = await runtime.channels.deliverContent({
      channels: ['discord'],
      content: {
        title: 'Launch post',
        body: 'Ship it.',
        files: [{ name: 'hero.png', path: '/tmp/hero.png', contentType: 'image/png' }],
      },
    })

    expect(result.deliveries).toEqual([expect.objectContaining({ channelId: 'discord', ref: 'message:discord-message-123' })])
    expect(calls).toHaveLength(0)
    expect(recorder.calls()).toEqual([[
      'message',
      'send',
      '--channel',
      'discord',
      '--message',
      'Launch post\n\nShip it.',
      '--media',
      '/tmp/hero.png',
      '--json',
    ]])
  })

  it('preserves direct channel message titles when rendering CLI message text', async () => {
    const recorder = installOpenClawCliRecorder(testDir)
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: recorder.binaryPath } })
    await runtime.initialize({ contentDir: testDir })

    await runtime.channels.sendMessage({
      channels: ['discord:launch-room'],
      message: {
        title: 'Workflow publish failed',
        body: 'Channel delivery failed.',
        threadId: 'thread-123',
      },
    })

    expect(recorder.calls()).toEqual([[
      'message',
      'send',
      '--channel',
      'discord',
      '--target',
      'launch-room',
      '--message',
      'Workflow publish failed\n\nChannel delivery failed.',
      '--thread-id',
      'thread-123',
      '--json',
    ]])
  })

  it('renders approval requests with an explicit Bakin UI decision notice', async () => {
    const recorder = installOpenClawCliRecorder(testDir)
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: recorder.binaryPath } })
    await runtime.initialize({ contentDir: testDir })

    await runtime.channels.createApproval({
      approvalId: 'approval-1',
      channels: ['discord'],
      request: {
        title: 'Gate: Review',
        body: 'Review the post.',
        options: [{ id: 'approve', label: 'Approve' }],
      },
    })

    const calls = recorder.calls()
    expect(calls).toHaveLength(1)
    expect(messageArg(calls[0]!)).toContain('This channel cannot return approval decisions to Bakin')
    expect(messageArg(calls[0]!)).toContain('approve/reject this gate in the Bakin UI')
  })

  it('creates native OpenClaw plugin approvals for interactive channels', async () => {
    writeFileSync(join(testDir, 'openclaw.json'), JSON.stringify({
      gateway: { auth: { token: 'test-token' } },
      channels: {
        discord: {
          token: 'discord-token',
          execApprovals: { enabled: true, approvers: ['202168845362921483'], target: 'both' },
        },
      },
    }), 'utf-8')
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    await runtime.initialize({ contentDir: testDir })

    const result = await runtime.channels.createApproval({
      approvalId: 'approval-1',
      channels: ['discord:channel-1'],
      request: {
        title: 'Gate: Review',
        body: 'Review the post.',
        options: [
          { id: 'approve', label: 'Approve' },
          { id: 'reject', label: 'Reject' },
        ],
        context: {
          approvalUrl: 'http://localhost:3737/api/plugins/workflows/gates/task-1/decision',
        },
      },
    })

    expect(result.deliveries).toEqual([expect.objectContaining({
      channelId: 'discord:channel-1',
      ref: 'openclaw-plugin-approval:plugin:test-approval',
    })])
    const approvalRequest = FakeWebSocket.instances[0]!.sentFrames.find(frame => frame.method === 'plugin.approval.request')
    const connectRequest = FakeWebSocket.instances[0]!.sentFrames.find(frame => frame.method === 'connect')
    expect(connectRequest?.params).toEqual(expect.objectContaining({
      client: expect.objectContaining({
        id: 'gateway-client',
        mode: 'backend',
      }),
      role: 'operator',
      scopes: ['operator.approvals'],
    }))
    expect(approvalRequest?.params).toEqual(expect.objectContaining({
      pluginId: 'bakin',
      toolName: 'workflow.gate',
      toolCallId: 'approval-1',
      turnSourceChannel: 'discord',
      turnSourceTo: 'channel-1',
      timeoutMs: 600000,
      twoPhase: true,
    }))
    expect(String((approvalRequest?.params as Record<string, unknown>).description)).toContain('Bakin fallback:')
  })

  it('uses the Bakin fallback link instead of native approvals when reject reasons are required', async () => {
    writeFileSync(join(testDir, 'openclaw.json'), JSON.stringify({
      gateway: { auth: { token: 'test-token' } },
      channels: {
        discord: {
          token: 'discord-token',
          execApprovals: { enabled: true, approvers: ['202168845362921483'], target: 'both' },
        },
      },
    }), 'utf-8')
    const recorder = installOpenClawCliRecorder(testDir)
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: recorder.binaryPath } })
    await runtime.initialize({ contentDir: testDir })

    await runtime.channels.createApproval({
      approvalId: 'approval-1',
      channels: ['discord:channel-1'],
      request: {
        title: 'Gate: Review',
        body: 'Review the post.',
        options: [
          { id: 'approve', label: 'Approve' },
          { id: 'reject', label: 'Reject' },
        ],
        context: {
          requireRejectReason: true,
          approvalUrl: 'http://localhost:3737/api/plugins/workflows/gates/task-1/decision',
        },
      },
    })

    expect(FakeWebSocket.instances).toHaveLength(0)
    const calls = recorder.calls()
    expect(calls).toHaveLength(1)
    expect(messageArg(calls[0]!)).toContain('This gate requires a reject reason')
    expect(messageArg(calls[0]!)).toContain('Open in Bakin:')
  })

  it('falls back to render-only messages when approval options are not approve/reject', async () => {
    writeFileSync(join(testDir, 'openclaw.json'), JSON.stringify({
      gateway: { auth: { token: 'test-token' } },
      channels: {
        discord: {
          token: 'discord-token',
          execApprovals: { enabled: true, approvers: ['202168845362921483'], target: 'both' },
        },
      },
    }), 'utf-8')
    const recorder = installOpenClawCliRecorder(testDir)
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: recorder.binaryPath } })
    await runtime.initialize({ contentDir: testDir })

    await runtime.channels.createApproval({
      approvalId: 'approval-1',
      channels: ['discord:channel-1'],
      request: {
        title: 'Gate: Review',
        body: 'Review the post.',
        options: [
          { id: 'approve', label: 'Approve' },
          { id: 'needs_changes', label: 'Needs changes' },
        ],
        context: {
          approvalUrl: 'http://localhost:3737/api/plugins/workflows/gates/task-1/decision',
        },
      },
    })

    expect(FakeWebSocket.instances).toHaveLength(0)
    const calls = recorder.calls()
    expect(calls).toHaveLength(1)
    expect(messageArg(calls[0]!)).toContain('Needs changes')
    expect(messageArg(calls[0]!)).toContain('Open in Bakin:')
  })

  it('maps OpenClaw plugin approval resolved events into Bakin approval events', async () => {
    writeFileSync(join(testDir, 'openclaw.json'), JSON.stringify({
      gateway: { auth: { token: 'test-token' } },
      channels: {
        discord: {
          token: 'discord-token',
          execApprovals: { enabled: true, approvers: ['202168845362921483'], target: 'both' },
        },
      },
    }), 'utf-8')
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    await runtime.initialize({ contentDir: testDir })
    const events: unknown[] = []
    const unsubscribe = runtime.channels.subscribeApprovalResponses(event => events.push(event))
    await tick()

    FakeWebSocket.instances[0]!.emitMessage({
      type: 'event',
      event: 'plugin.approval.resolved',
      payload: {
        id: 'plugin:test-approval',
        decision: 'allow-once',
        resolvedBy: 'Main Operator',
        ts: Date.parse('2026-04-28T12:00:00Z'),
        request: {
          pluginId: 'bakin',
          toolName: 'workflow.gate',
          toolCallId: 'approval-1',
          turnSourceChannel: 'discord',
          turnSourceTo: 'channel-1',
        },
      },
    })
    unsubscribe()

    expect(events).toEqual([{
      approvalId: 'approval-1',
      channelId: 'discord:channel-1',
      response: {
        selectedOption: 'approve',
        respondedAt: '2026-04-28T12:00:00.000Z',
        actor: { type: 'human', id: 'Main Operator', displayName: 'Main Operator' },
      },
    }])
  })

  it('resolves native approval deliveries through OpenClaw', async () => {
    writeFileSync(join(testDir, 'openclaw.json'), JSON.stringify({
      gateway: { auth: { token: 'test-token' } },
      channels: {
        discord: {
          token: 'discord-token',
          execApprovals: { enabled: true, approvers: ['202168845362921483'], target: 'both' },
        },
      },
    }), 'utf-8')
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    await runtime.initialize({ contentDir: testDir })

    await runtime.channels.resolveApproval({
      approvalId: 'approval-1',
      deliveries: [{ channelId: 'discord', ref: 'openclaw-plugin-approval:plugin:test-approval', renderedAt: '2026-04-28T12:00:00Z' }],
      response: {
        selectedOption: 'reject',
        respondedAt: '2026-04-28T12:00:00Z',
        actor: { type: 'human', id: 'main-operator' },
      },
    })

    const resolveRequest = FakeWebSocket.instances[0]!.sentFrames.find(frame => frame.method === 'plugin.approval.resolve')
    expect(resolveRequest?.params).toEqual({
      id: 'plugin:test-approval',
      decision: 'deny',
    })
  })

  it('warns instead of silently no-oping approval response hooks', async () => {
    const warn = mock()
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    await runtime.initialize({
      contentDir: testDir,
      logger: {
        debug: mock(),
        info: mock(),
        warn,
        error: mock(),
      },
    })

    const unsubscribe = runtime.channels.subscribeApprovalResponses(() => {})
    await runtime.channels.resolveApproval({
      approvalId: 'approval-1',
      deliveries: [{ channelId: 'discord', ref: 'message:1', renderedAt: '2026-04-28T12:00:00Z' }],
      response: {
        selectedOption: 'approve',
        respondedAt: '2026-04-28T12:00:00Z',
        actor: { type: 'human', id: 'main-operator' },
      },
    })
    unsubscribe()

    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0]![0]).toContain('approval responses are render-only')
    expect(warn.mock.calls[1]![0]).toContain('approval resolve is render-only')
  })
})

interface FakeGatewayFrame {
  type: 'req'
  id: string
  method: string
  params: Record<string, unknown>
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readyState = 0
  sentFrames: FakeGatewayFrame[] = []
  private listeners = new Map<string, Set<(event: { data?: string }) => void>>()

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = 1
      this.emit('open', {})
      this.emitMessage({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'nonce-1' },
      })
    })
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: { data?: string }) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as FakeGatewayFrame
    this.sentFrames.push(frame)
    if (frame.method === 'connect') {
      this.emitMessage({ type: 'res', id: frame.id, ok: true, payload: { auth: { scopes: ['operator.approvals'] } } })
    } else if (frame.method === 'plugin.approval.request') {
      this.emitMessage({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: {
          status: 'accepted',
          id: 'plugin:test-approval',
          createdAtMs: Date.parse('2026-04-28T12:00:00Z'),
          expiresAtMs: Date.parse('2026-04-28T12:10:00Z'),
        },
      })
    } else if (frame.method === 'plugin.approval.resolve') {
      this.emitMessage({ type: 'res', id: frame.id, ok: true, payload: { ok: true } })
    }
  }

  close(): void {
    this.readyState = 3
    this.emit('close', {})
  }

  emitMessage(frame: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify(frame) })
  }

  private emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}
