/**
 * Chat auto-titling (T4.3) — after the first exchange, a budget-gated
 * ephemeral LLM call upgrades the fallback title. User renames are never
 * overwritten, blocked budget skips silently, later turns never re-title.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-chat-title-${Date.now()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    chat: join(testDir, 'chat'),
    logs: join(testDir, 'logs'),
    settings: join(testDir, 'settings.json'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// The gate is the ONE spend engine's primitives — mock its decisions.
let paused = false
let gateAction: 'proceed' | 'defer' = 'proceed'
mock.module('../../../src/core/dispatch-turns', () => ({
  dispatchPaused: () => paused,
  budgetGate: async () => ({ action: gateAction, rule: { scope: 'global', lane: 'metered' }, window: 'daily', unit: 'usd_micros' }),
}))

// Capture metering: the title call itself is attributed spend (T2.2) —
// mocked so tests never touch the real ledger.
const meteredTurns: Array<Record<string, unknown>> = []
mock.module('../../../src/core/agent-cost', () => ({
  meterAgentTurn: async (opts: Record<string, unknown>) => { meteredTurns.push(opts) },
  meterImageTurn: async () => {},
}))

import chatPlugin from '../../../plugins/chat'
import { createChat, getChatSummary, readTranscript } from '../../../plugins/chat/lib/store'
import { startChatTurn, waitForTurn } from '../../../plugins/chat/lib/stream-bridge'
import { activatePlugin, type ActivatedPlugin } from '../test-helpers'
import type { ChatChunk, MessageArgs } from '../../../packages/core/src/adapters/runtime/concepts'

let activated: ActivatedPlugin
let sendCalls: MessageArgs[] = []
let titleReply = 'Reddit Post Hunt'

beforeAll(async () => {
  activated = await activatePlugin(chatPlugin, testDir)
  await activated.ctx.runtime.agents.create({ id: 'main', name: 'Main' })
  activated.ctx.runtime.messaging.stream = ((_args: MessageArgs) =>
    (async function* () {
      yield { type: 'text', content: 'Here is the post you wanted.' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })()) as typeof activated.ctx.runtime.messaging.stream
  activated.ctx.runtime.messaging.send = (async (args: MessageArgs) => {
    sendCalls.push(args)
    return { id: 'turn-1', content: titleReply }
  }) as typeof activated.ctx.runtime.messaging.send
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('chat auto-titling', () => {
  test('first completed turn upgrades the fallback title via an ephemeral send', async () => {
    sendCalls = []
    const chat = await createChat({ agentId: 'main' })
    await startChatTurn(activated.ctx, chat.id, 'can you find a reddit post about openclaw')
    await waitForTurn(chat.id)

    const after = getChatSummary(chat.id)
    expect(after?.title).toBe('Reddit Post Hunt')

    // The title send is attributed spend: work class 'auto-title', run id on
    // the durable chat:<id>:title prefix (the v8 backfill's safe prefix).
    const titleMeter = meteredTurns.find((m) => m.workClass === 'auto-title')
    expect(titleMeter).toMatchObject({ agent: 'main', activityClass: 'system', runId: `chat:${chat.id}:title` })
    expect(after?.titleSource).toBe('llm')
    // the titling call is ephemeral and never rides the chat thread
    expect(sendCalls).toHaveLength(1)
    expect(sendCalls[0]?.ephemeral).toBe(true)
    expect(sendCalls[0]?.threadId).not.toBe(`chat:${chat.id}`)
    // the transcript never contains the titling exchange
    expect(readTranscript(chat.id).some((r) => r.kind === 'user' && r.content.includes('title'))).toBe(false)
  })

  test('a user rename is never overwritten by the LLM title', async () => {
    sendCalls = []
    const chat = await createChat({ agentId: 'main', title: 'My name stays' })
    // createChat with an explicit title records a user titleSource
    await startChatTurn(activated.ctx, chat.id, 'hello')
    await waitForTurn(chat.id)
    expect(getChatSummary(chat.id)?.title).toBe('My name stays')
    expect(getChatSummary(chat.id)?.titleSource).toBe('user')
    expect(sendCalls).toHaveLength(0) // skipped before spending anything
  })

  test('budget defer skips titling silently; later turns never re-title', async () => {
    sendCalls = []
    gateAction = 'defer'
    const chat = await createChat({ agentId: 'main' })
    await startChatTurn(activated.ctx, chat.id, 'first question here')
    await waitForTurn(chat.id)
    expect(sendCalls).toHaveLength(0)
    expect(getChatSummary(chat.id)?.titleSource).toBe('fallback')
    expect(getChatSummary(chat.id)?.title).toBe('first question here')

    // budget recovers, but this is now the SECOND turn — no retro-titling
    gateAction = 'proceed'
    await startChatTurn(activated.ctx, chat.id, 'second question')
    await waitForTurn(chat.id)
    expect(sendCalls).toHaveLength(0)
  })

  test('kill switch blocks titling', async () => {
    sendCalls = []
    paused = true
    const chat = await createChat({ agentId: 'main' })
    await startChatTurn(activated.ctx, chat.id, 'question while paused')
    await waitForTurn(chat.id)
    expect(sendCalls).toHaveLength(0)
    paused = false
  })

  test('messy LLM replies clean up; junk replies leave the fallback', async () => {
    sendCalls = []
    titleReply = '"Weekly Ops Review."\nExtra line'
    const chat = await createChat({ agentId: 'main' })
    await startChatTurn(activated.ctx, chat.id, 'plan the weekly ops review')
    await waitForTurn(chat.id)
    expect(getChatSummary(chat.id)?.title).toBe('Weekly Ops Review')

    titleReply = '   '
    const chat2 = await createChat({ agentId: 'main' })
    await startChatTurn(activated.ctx, chat2.id, 'another chat needing a name')
    await waitForTurn(chat2.id)
    expect(getChatSummary(chat2.id)?.title).toBe('another chat needing a name')
    expect(getChatSummary(chat2.id)?.titleSource).toBe('fallback')
    titleReply = 'Reddit Post Hunt'
  })
})
