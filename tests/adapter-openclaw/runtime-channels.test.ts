import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('OpenClaw runtime channels', () => {
  let testDir: string
  let originalOpenClawHome: string | undefined
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-channel-test-'))
    originalOpenClawHome = process.env.OPENCLAW_HOME
    originalFetch = globalThis.fetch
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
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
    rmSync(testDir, { recursive: true, force: true })
  })

  it('lists configured channels without claiming interactive approval support', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const channels = await runtime.channels.list()
    expect(channels).toEqual([expect.objectContaining({
      id: 'discord',
      capabilities: ['message', 'rich-content'],
      metadata: { approvalResponses: 'render-only' },
    })])
  })

  it('renders approval requests with an explicit Bakin UI decision notice', async () => {
    const calls: Array<Record<string, unknown>> = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
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

    expect(calls).toHaveLength(1)
    const args = calls[0]!.args as Record<string, unknown>
    expect(args.message).toContain('Runtime channel approvals are render-only')
    expect(args.message).toContain('Approve or reject this gate in the Bakin UI')
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
      deliveries: [],
      response: {
        selectedOption: 'approve',
        respondedAt: '2026-04-28T12:00:00Z',
        actor: { type: 'human', id: 'roscoe' },
      },
    })
    unsubscribe()

    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0]![0]).toContain('approval responses are not implemented')
    expect(warn.mock.calls[1]![0]).toContain('approval resolve is render-only')
  })
})
