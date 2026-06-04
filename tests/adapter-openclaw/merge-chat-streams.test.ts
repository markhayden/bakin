import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-merge-streams-${Date.now()}`)
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))

import { mergeChatStreams } from '../../packages/adapter-openclaw/src/runtime'
import type { ChatChunk } from '../../packages/core/src/adapters/runtime'

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function slowPrimary(): AsyncIterable<ChatChunk> {
  return (async function* () {
    yield { type: 'text', content: 'first' } as ChatChunk
    await tick(1000) // long-pending turn; consumer abandons before this resolves
    yield { type: 'done' } as ChatChunk
  })()
}

function pollingSecondary(state: { polls: number; aborted: boolean }): AsyncIterable<ChatChunk> {
  return (async function* () {
    while (!state.aborted) {
      state.polls += 1
      yield { type: 'tool', content: `poll-${state.polls}` } as ChatChunk
      await tick(10)
    }
  })()
}

describe('mergeChatStreams consumer-abandonment', () => {
  it('aborts the secondary poller when the consumer breaks early (C2 leak regression)', async () => {
    const state = { polls: 0, aborted: false }
    const stream = mergeChatStreams(slowPrimary(), pollingSecondary(state), () => {
      state.aborted = true
    })

    for await (const chunk of stream) {
      void chunk
      break // consumer abandons the stream after the first chunk
    }

    // Give the leaked poller time to keep spinning if the abort never fired.
    const pollsAtBreak = state.polls
    await tick(100)

    expect(state.aborted).toBe(true)
    expect(state.polls - pollsAtBreak).toBeLessThanOrEqual(1)
  })

  it('still aborts the secondary when the primary finishes normally', async () => {
    const state = { polls: 0, aborted: false }
    const primary = (async function* () {
      yield { type: 'text', content: 'only' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })()

    const chunks: ChatChunk[] = []
    for await (const chunk of mergeChatStreams(primary, pollingSecondary(state), () => {
      state.aborted = true
    })) {
      chunks.push(chunk)
    }

    expect(state.aborted).toBe(true)
    expect(chunks.at(-1)?.type).toBe('done')
  })
})
