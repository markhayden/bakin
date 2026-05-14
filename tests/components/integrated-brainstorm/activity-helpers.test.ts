import { describe, expect, it } from 'bun:test'
import {
  brainstormActivityMessageFromCustom,
  brainstormThreadId,
  normalizeBrainstormActivityForStorage,
  readBrainstormSseResponse,
  runtimeChunkToBrainstormActivity,
  toBrainstormTimeline,
} from '@/components/integrated-brainstorm'
import type { BrainstormMessage } from '@/components/integrated-brainstorm'
import { runtimeChunkToBrainstormActivity as runtimeChunkToBrainstormActivityFromUtils } from '@makinbakin/sdk/utils'
import type { RuntimeChatChunk } from '@makinbakin/sdk/types'

function sseResponse(events: Array<{ event: string; data: unknown }>): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const item of events) {
        controller.enqueue(encoder.encode(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`))
      }
      controller.close()
    },
  }), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('brainstorm activity helpers', () => {
  it('maps normalized runtime tool chunks to brainstorm activity records', () => {
    const chunk: RuntimeChatChunk = {
      type: 'tool',
      content: 'exec: gh issue list',
      data: {
        phase: 'call',
        callId: 'call-1',
        toolName: 'exec',
        status: 'running',
        inputPreview: '{"command":"gh issue list"}',
      },
    }

    expect(runtimeChunkToBrainstormActivity(chunk)).toEqual({
      kind: 'tool_call',
      content: 'exec: gh issue list',
      data: chunk.data,
    })
    expect(runtimeChunkToBrainstormActivityFromUtils(chunk)).toEqual({
      kind: 'tool_call',
      content: 'exec: gh issue list',
      data: chunk.data,
    })
  })

  it('maps status and error chunks to brainstorm activity records', () => {
    expect(runtimeChunkToBrainstormActivity({
      type: 'status',
      content: 'Reading context',
      data: { step: 'context' },
    })).toEqual({
      kind: 'runtime_status',
      content: 'Reading context',
      data: { step: 'context' },
    })

    expect(runtimeChunkToBrainstormActivity({
      type: 'error',
      content: 'runtime rejected',
    })).toEqual({
      kind: 'error',
      content: 'runtime rejected',
    })
  })

  it('creates activity messages from custom SSE payloads', () => {
    expect(brainstormActivityMessageFromCustom('activity', {
      activity: {
        id: 'act-1',
        kind: 'tool_call',
        content: 'read: plan.md',
        data: { phase: 'call', toolName: 'read' },
        timestamp: '2026-05-09T10:00:00.000Z',
      },
    })).toEqual({
      id: 'act-1',
      role: 'activity',
      kind: 'tool_call',
      content: 'read: plan.md',
      data: { phase: 'call', toolName: 'read' },
      timestamp: '2026-05-09T10:00:00.000Z',
    })
  })

  it('builds stable URL-safe brainstorm thread ids', () => {
    expect(brainstormThreadId('projects', 'proj/one', 'main agent')).toBe('projects:proj%2Fone:main%20agent')
    expect(brainstormThreadId('projects', 'proj/one', 'main agent')).toBe('projects:proj%2Fone:main%20agent')
  })

  it('normalizes activity payloads before durable storage', () => {
    const huge = 'x'.repeat(2500)
    const normalized = normalizeBrainstormActivityForStorage({
      kind: 'tool_call',
      content: '  Reading project details  ',
      data: {
        phase: 'call',
        toolName: 'exec',
        inputPreview: huge,
        nested: { value: huge },
      },
    })

    expect(normalized).toEqual({
      kind: 'tool_call',
      content: 'Reading project details',
      data: {
        phase: 'call',
        toolName: 'exec',
        inputPreview: `${'x'.repeat(1997)}...`,
        nested: expect.stringContaining('"value"'),
      },
    })
  })

  it('builds a chronological brainstorm timeline from durable plugin records', () => {
    const timeline = toBrainstormTimeline('main', {
      messages: [
        { id: 'm2', role: 'assistant', content: 'Done', timestamp: '2026-05-09T10:00:03.000Z' },
        { id: 'm1', role: 'user', content: 'Look this up', timestamp: '2026-05-09T10:00:00.000Z' },
      ],
      activities: [
        {
          id: 'a1',
          kind: 'tool_call',
          content: 'exec: gh issue list',
          timestamp: '2026-05-09T10:00:01.000Z',
          data: { phase: 'call', callId: 'call-1', toolName: 'exec' },
        },
      ],
    })

    expect(timeline).toEqual([
      { id: 'm1', role: 'user', content: 'Look this up', timestamp: '2026-05-09T10:00:00.000Z' },
      {
        id: 'a1',
        role: 'activity',
        kind: 'tool_call',
        content: 'exec: gh issue list',
        timestamp: '2026-05-09T10:00:01.000Z',
        data: { phase: 'call', callId: 'call-1', toolName: 'exec' },
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'Done',
        agentId: 'main',
        timestamp: '2026-05-09T10:00:03.000Z',
      },
    ] satisfies BrainstormMessage[])
  })
})

describe('readBrainstormSseResponse', () => {
  it('streams tokens, forwards activity/custom events, and returns final content', async () => {
    const tokens: string[] = []
    const custom: Array<{ event: string; data: unknown }> = []
    const sideEffects: Array<{ event: string; data: unknown }> = []

    const result = await readBrainstormSseResponse(
      sseResponse([
        { event: 'token', data: { text: 'Hel' } },
        { event: 'activity', data: { activity: { id: 'a1', kind: 'tool_call', content: 'exec: ls' } } },
        { event: 'proposal', data: { id: 'p1' } },
        { event: 'token', data: { text: 'lo' } },
        { event: 'done', data: { content: 'Hello final' } },
      ]),
      {
        signal: new AbortController().signal,
        onToken: (text) => tokens.push(text),
        onCustom: (event, data) => custom.push({ event, data }),
      },
      {
        onCustomEvent: (event, data) => {
          sideEffects.push({ event, data })
        },
      },
    )

    expect(tokens).toEqual(['Hel', 'lo'])
    expect(custom).toEqual([
      { event: 'activity', data: { activity: { id: 'a1', kind: 'tool_call', content: 'exec: ls' } } },
      { event: 'proposal', data: { id: 'p1' } },
    ])
    expect(sideEffects).toEqual([{ event: 'proposal', data: { id: 'p1' } }])
    expect(result).toEqual({ content: 'Hello final' })
  })

  it('throws a useful error for SSE error events', async () => {
    await expect(readBrainstormSseResponse(
      sseResponse([{ event: 'error', data: { message: 'runtime rejected' } }]),
      {
        signal: new AbortController().signal,
        onToken: () => {},
      },
    )).rejects.toThrow('runtime rejected')
  })

  it('lets callers own custom event handling when needed', async () => {
    const custom: Array<{ event: string; data: unknown }> = []
    const sideEffects: Array<{ event: string; data: unknown }> = []

    await readBrainstormSseResponse(
      sseResponse([{ event: 'proposals', data: { proposals: [{ id: 'p1' }] } }]),
      {
        signal: new AbortController().signal,
        onToken: () => {},
        onCustom: (event, data) => custom.push({ event, data }),
      },
      {
        onCustomEvent: (event, data) => {
          sideEffects.push({ event, data })
          return true
        },
      },
    )

    expect(sideEffects).toEqual([{ event: 'proposals', data: { proposals: [{ id: 'p1' }] } }])
    expect(custom).toEqual([])
  })
})
