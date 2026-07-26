/**
 * Chat per-turn usage decoration (#733) — GET /chats/:chatId joins the
 * ledger's run_costs rows (runId chat:<id>:turn:<turnId>) into a
 * per-turn `usage` map + `usageTotals`, honoring unit-per-lane (metered →
 * costUsd; subscription/unknown → tokens only) and honest absence
 * (ledger down or no row → no field, never zeros).
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-chat-usage-${Date.now()}-${randomUUID()}`)

function testPaths() {
  return {
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    chat: join(testDir, 'chat'),
    logs: join(testDir, 'logs'),
    settings: join(testDir, 'settings.json'),
    db: join(testDir, 'bakin.db'),
  }
}

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: testPaths,
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import chatPlugin from '../../../plugins/chat'
import { createChat } from '../../../plugins/chat/lib/store'
import { recordRunCost } from '../../../src/core/execution-ledger'
import { closeDb } from '../../../packages/core/src/storage/db'
import { buildTurnUsage, chatTurnUsage } from '../../../plugins/chat/lib/usage'
import { activatePlugin, callRoute, findRoute, type ActivatedPlugin } from '../test-helpers'

let activated: ActivatedPlugin
const T0 = 1_760_000_000_000

beforeAll(async () => {
  activated = await activatePlugin(chatPlugin, testDir)
  await activated.ctx.runtime.agents.create({ id: 'main', name: 'Main' })
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('GET /chats/:chatId usage decoration', () => {
  test('joins per-turn rows with unit-per-lane costs and sums totals; auto-title spend never pollutes', async () => {
    const chat = await createChat({ agentId: 'main' })
    recordRunCost({
      workClass: 'chat',
      runId: `chat:${chat.id}:turn:turn-metered`,
      agent: 'main',
      model: 'anthropic/claude-sonnet-5',
      lane: 'metered',
      inputTokens: 14_200,
      outputTokens: 890,
      totalTokens: 15_090,
      costUsdMicros: 30_000,
      occurredAt: T0 + 1000,
    })
    recordRunCost({
      workClass: 'chat',
      runId: `chat:${chat.id}:turn:turn-sub`,
      agent: 'main',
      model: 'pi/pi-local',
      lane: 'subscription',
      inputTokens: 22_100,
      outputTokens: 1_200,
      totalTokens: 23_300,
      occurredAt: T0 + 2000,
    })
    // Auto-title spend rides chat:<id>:title — MUST NOT appear as a turn.
    recordRunCost({ workClass: 'auto-title', runId: `chat:${chat.id}:title`, agent: 'main', totalTokens: 60, costUsdMicros: 100, lane: 'metered', occurredAt: T0 + 3000 })

    const get = findRoute(activated.routes, 'GET', '/chats/:chatId')!
    const res = await callRoute(get, activated.ctx, { path: `/chats/${chat.id}` })
    expect(res.status).toBe(200)
    const usage = res.body.usage as Record<string, Record<string, unknown>>
    expect(Object.keys(usage).sort()).toEqual(['turn-metered', 'turn-sub'])
    expect(usage['turn-metered']).toMatchObject({
      inputTokens: 14_200,
      outputTokens: 890,
      costUsd: 0.03,
      model: 'anthropic/claude-sonnet-5',
      lane: 'metered',
    })
    // Subscription lane: tokens only — NEVER a fabricated dollar figure.
    expect(usage['turn-sub']).toMatchObject({ inputTokens: 22_100, lane: 'subscription' })
    expect(usage['turn-sub'].costUsd).toBeUndefined()

    const totals = res.body.usageTotals as Record<string, unknown>
    expect(totals).toMatchObject({
      turns: 2,
      inputTokens: 36_300,
      outputTokens: 2_090,
      totalTokens: 38_390,
      costUsd: 0.03,
    })
  })

  test('an all-subscription chat sums tokens with NO costUsd on totals (unit-per-lane, negative direction)', async () => {
    const chat = await createChat({ agentId: 'main' })
    recordRunCost({
      workClass: 'chat', runId: `chat:${chat.id}:turn:s1`, agent: 'main', model: 'pi/pi-local',
      lane: 'subscription', inputTokens: 10_000, outputTokens: 500, totalTokens: 10_500, occurredAt: T0 + 1,
    })
    recordRunCost({
      workClass: 'chat', runId: `chat:${chat.id}:turn:s2`, agent: 'main', model: 'pi/pi-local',
      lane: 'subscription', inputTokens: 12_000, outputTokens: 700, totalTokens: 12_700, occurredAt: T0 + 2,
    })
    const get = findRoute(activated.routes, 'GET', '/chats/:chatId')!
    const res = await callRoute(get, activated.ctx, { path: `/chats/${chat.id}` })
    const totals = res.body.usageTotals as Record<string, unknown>
    expect(totals).toMatchObject({ turns: 2, totalTokens: 23_200 })
    expect(totals.costUsd).toBeUndefined()
  })

  test('a chat with no recorded turns gets an empty map and NO totals field', async () => {
    const chat = await createChat({ agentId: 'main' })
    const get = findRoute(activated.routes, 'GET', '/chats/:chatId')!
    const res = await callRoute(get, activated.ctx, { path: `/chats/${chat.id}` })
    expect(res.body.usage).toEqual({})
    expect(res.body.usageTotals).toBeUndefined()
  })
})

describe('GET /chats/:chatId contextStats decoration (#737)', () => {
  test('decorates from the adapter member with the chat threadId; throwing member omits honestly', async () => {
    const chat = await createChat({ agentId: 'main' })
    const calls: Array<{ agentId: string; threadId: string }> = []
    ;(activated.ctx.runtime.sessions as { contextStats?: unknown }).contextStats = async (opts: { agentId: string; threadId: string }) => {
      calls.push(opts)
      return { tokens: 45_300, contextWindow: 272_000, compactionThreshold: 255_616, model: 'gpt-5.5' }
    }
    const get = findRoute(activated.routes, 'GET', '/chats/:chatId')!
    const res = await callRoute(get, activated.ctx, { path: `/chats/${chat.id}` })
    expect(res.body.contextStats).toMatchObject({ tokens: 45_300, contextWindow: 272_000 })
    expect(calls[0]).toEqual({ agentId: 'main', threadId: `chat:${chat.id}` })

    // A throwing member serves the transcript WITHOUT the field.
    ;(activated.ctx.runtime.sessions as { contextStats?: unknown }).contextStats = async () => {
      throw new Error('adapter exploded')
    }
    const res2 = await callRoute(get, activated.ctx, { path: `/chats/${chat.id}` })
    expect(res2.status).toBe(200)
    expect(res2.body.contextStats).toBeUndefined()

    // Absent member (capability off) → field absent.
    delete (activated.ctx.runtime.sessions as { contextStats?: unknown }).contextStats
    const res3 = await callRoute(get, activated.ctx, { path: `/chats/${chat.id}` })
    expect(res3.body.contextStats).toBeUndefined()
  })

  test('a null adapter reading (no session yet) omits the field', async () => {
    const chat = await createChat({ agentId: 'main' })
    ;(activated.ctx.runtime.sessions as { contextStats?: unknown }).contextStats = async () => null
    const get = findRoute(activated.routes, 'GET', '/chats/:chatId')!
    const res = await callRoute(get, activated.ctx, { path: `/chats/${chat.id}` })
    expect(res.body.contextStats).toBeUndefined()
    delete (activated.ctx.runtime.sessions as { contextStats?: unknown }).contextStats
  })
})

describe('buildTurnUsage (pure mapping)', () => {
  test('a metered row with a cost but unknown lane shows tokens only (unknown never fabricates)', () => {
    const { usage } = buildTurnUsage([
      {
        runId: 'chat:c1:turn:t1',
        model: 'm',
        lane: null,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cacheReadTokens: null,
        costUsdMicros: 999,
        occurredAt: 1,
      },
    ])
    expect(usage.t1.costUsd).toBeUndefined()
    expect(usage.t1.inputTokens).toBe(10)
  })

  test('a throwing loader yields honest absence — undefined, never zeros', () => {
    const result = chatTurnUsage('c-down', () => {
      throw new Error('ledger unavailable')
    })
    expect(result).toBeUndefined()
  })
})
