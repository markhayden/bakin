import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}

function sseResponse(frames: unknown[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('OpenClaw runtime stream parsing', () => {
  let testDir: string
  let originalOpenClawHome: string | undefined
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-stream-test-'))
    originalOpenClawHome = process.env.OPENCLAW_HOME
    originalFetch = globalThis.fetch
    process.env.OPENCLAW_HOME = testDir
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, 'openclaw.json'), JSON.stringify({
      gateway: { auth: { token: 'test-token' } },
    }), 'utf-8')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
    rmSync(testDir, { recursive: true, force: true })
  })

  it('preserves OpenClaw status and tool frames as chat chunks', async () => {
    globalThis.fetch = mock(async () => sseResponse([
      { type: 'status', content: 'Checking project notes' },
      { type: 'tool', content: 'Read project file', data: { tool: 'bakin_exec_projects_get' } },
      { choices: [{ delta: { content: 'Done.' } }] },
    ])) as unknown as typeof fetch

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const chunks = await collect(runtime.messaging.stream({
      agentId: 'main',
      content: 'hello',
      threadId: 'thread-1',
    }))

    expect(chunks).toEqual([
      { type: 'status', content: 'Checking project notes', data: undefined },
      { type: 'tool', content: 'Read project file', data: { tool: 'bakin_exec_projects_get' } },
      { type: 'text', content: 'Done.' },
      { type: 'done' },
    ])
  })

  it('maps OpenAI tool_calls deltas to tool chunks', async () => {
    globalThis.fetch = mock(async () => sseResponse([
      {
        choices: [{
          delta: {
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'bakin_exec_projects_get', arguments: '{"projectId":"p1"}' },
            }],
          },
        }],
      },
    ])) as unknown as typeof fetch

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const chunks = await collect(runtime.messaging.stream({
      agentId: 'main',
      content: 'hello',
      threadId: 'thread-1',
    }))

    expect(chunks[0]).toEqual({
      type: 'tool',
      content: 'bakin_exec_projects_get',
      data: {
        toolCalls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'bakin_exec_projects_get', arguments: '{"projectId":"p1"}' },
        }],
      },
    })
  })
})
