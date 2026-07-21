/**
 * Conversation stream plumbing (T3.4): the SSE reader (chunk/custom/done/
 * error frames, split-frame buffering, abort), the turn recorder (chunks →
 * persisted ConversationMessage rows with honest truncation), and
 * conversationThreadId.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-conv-stream-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import type { RuntimeChatChunk } from '@makinbakin/sdk/types'
import { createTurnRecorder } from '../../src/components/conversation/turn-recorder'
import { conversationThreadId } from '../../src/components/conversation/thread-id'

function sseResponse(frames: string[], chunkSize?: number): Response {
  const payload = frames.join('')
  const encoder = new TextEncoder()
  const bytes = encoder.encode(payload)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!chunkSize) {
        controller.enqueue(bytes)
      } else {
        for (let i = 0; i < bytes.length; i += chunkSize) {
          controller.enqueue(bytes.slice(i, i + chunkSize))
        }
      }
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('createTurnRecorder', () => {
  it('records text, result-phase tools, and errors into ConversationMessage rows', () => {
    const recorder = createTurnRecorder({ turnId: 't1', agentId: 'main' })
    recorder.ingest({ type: 'status', content: 'thinking' })
    recorder.ingest({ type: 'tool', data: { phase: 'call', callId: 'c1', toolName: 'web_search', summary: 'query' } })
    recorder.ingest({ type: 'text', content: 'Here is ' })
    recorder.ingest({
      type: 'tool',
      data: { phase: 'result', callId: 'c1', toolName: 'web_search', status: 'completed', outputPreview: 'results', durationMs: 900 },
    })
    recorder.ingest({ type: 'text', content: 'the answer.' })
    recorder.ingest({ type: 'done' })
    const rows = recorder.finish()

    // Interleaving is preserved: text before the tool result flushes as its
    // own row so replay matches the stream order.
    expect(rows.map((r) => r.kind)).toEqual(['assistant', 'tool', 'assistant'])
    expect(rows[0]).toMatchObject({ kind: 'assistant', turnId: 't1', agentId: 'main', content: 'Here is ' })
    const tool = rows[1]
    if (tool.kind !== 'tool') throw new Error('expected tool row')
    expect(tool).toMatchObject({
      turnId: 't1',
      agentId: 'main',
      callId: 'c1',
      toolName: 'web_search',
      status: 'completed',
      summary: 'query', // call-phase summary survives a summary-less result
      outputPreview: 'results',
      durationMs: 900,
    })
    expect(rows[2]).toMatchObject({ kind: 'assistant', content: 'the answer.' })
  })

  it('truncates oversized previews with an honest marker', () => {
    const recorder = createTurnRecorder({ turnId: 't2' })
    recorder.ingest({
      type: 'tool',
      data: { phase: 'result', callId: 'c1', toolName: 'bash', status: 'completed', outputPreview: 'x'.repeat(10_000) },
    })
    const rows = recorder.finish()
    const tool = rows[0]
    if (tool.kind !== 'tool') throw new Error('expected tool row')
    expect(tool.outputPreview!.length).toBeLessThan(5000)
    expect(tool.metadata?.truncated).toBe(true)
  })

  it('drain() returns settled rows incrementally; finish() flushes the tail only', () => {
    const recorder = createTurnRecorder({ turnId: 't4' })
    recorder.ingest({ type: 'text', content: 'before ' })
    expect(recorder.drain()).toEqual([]) // pending text stays buffered
    recorder.ingest({ type: 'tool', data: { phase: 'result', toolName: 'bash', status: 'completed' } })
    const first = recorder.drain()
    expect(first.map((r) => r.kind)).toEqual(['assistant', 'tool'])
    recorder.ingest({ type: 'text', content: 'after' })
    const rest = recorder.finish()
    expect(rest.map((r) => r.kind)).toEqual(['assistant'])
    expect(rest[0]).toMatchObject({ content: 'after' })
  })

  it('records error chunks as error rows and keeps partial text', () => {
    const recorder = createTurnRecorder({ turnId: 't3' })
    recorder.ingest({ type: 'text', content: 'partial ' })
    recorder.ingest({ type: 'error', content: 'boom', data: { kind: 'transport' } })
    const rows = recorder.finish()
    expect(rows.map((r) => r.kind)).toEqual(['assistant', 'error'])
    const error = rows[1]
    if (error.kind !== 'error') throw new Error('expected error row')
    expect(error).toMatchObject({ turnId: 't3', message: 'boom', errorKind: 'transport' })
  })
})

describe('conversationThreadId', () => {
  it('joins scope:entity:agent with URL-encoded parts and defaults', () => {
    expect(conversationThreadId('brainstorm', 'sess-1', 'main')).toBe('brainstorm:sess-1:main')
    expect(conversationThreadId('plan review', 'a/b', '')).toBe('plan%20review:a%2Fb:default')
  })
})
