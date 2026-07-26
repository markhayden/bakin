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

  test('usageContext reports the LAST settled turn\'s prompt size + the model\'s numeric window via the models hook', async () => {
    const chat = await createChat({ agentId: 'main' })
    recordRunCost({
      workClass: 'chat',
      runId: `chat:${chat.id}:turn:t-old`,
      agent: 'main',
      model: 'gpt-5.5',
      lane: 'metered',
      inputTokens: 10_000,
      outputTokens: 200,
      occurredAt: T0 + 1000,
    })
    recordRunCost({
      workClass: 'chat',
      runId: `chat:${chat.id}:turn:t-last`,
      agent: 'main',
      model: 'gpt-5.5',
      lane: 'metered',
      inputTokens: 40_000,
      cacheReadTokens: 9_500,
      outputTokens: 700,
      occurredAt: T0 + 2000,
    })
    // The harness hooks are inert mocks — stub the invoker the route hands
    // to the usage join.
    activated.ctx.hooks.has = ((name: string) => name === 'models.getAvailableModels') as typeof activated.ctx.hooks.has
    activated.ctx.hooks.invoke = (async (name: string) =>
      name === 'models.getAvailableModels'
        ? [
            { id: 'gpt-5.5', contextWindow: 200_000 },
            { id: 'other-model', contextWindow: 1_000_000 },
          ]
        : undefined) as typeof activated.ctx.hooks.invoke

    const get = findRoute(activated.routes, 'GET', '/chats/:chatId')!
    const res = await callRoute(get, activated.ctx, { path: `/chats/${chat.id}` })
    // Prompt size = input + cache reads of the LAST turn (compaction shows
    // up as this number dropping); window from the models hook.
    expect(res.body.usageContext).toMatchObject({ tokens: 49_500, model: 'gpt-5.5', window: 200_000 })
  })

  test('unknown model window → usageContext carries tokens only (no fabricated window)', async () => {
    const chat = await createChat({ agentId: 'main' })
    recordRunCost({
      workClass: 'chat',
      runId: `chat:${chat.id}:turn:t-1`,
      agent: 'main',
      model: 'mystery-model',
      lane: 'subscription',
      inputTokens: 12_000,
      occurredAt: T0 + 1000,
    })
    const get = findRoute(activated.routes, 'GET', '/chats/:chatId')!
    const res = await callRoute(get, activated.ctx, { path: `/chats/${chat.id}` })
    expect(res.body.usageContext).toMatchObject({ tokens: 12_000, model: 'mystery-model' })
    expect((res.body.usageContext as Record<string, unknown>).window).toBeUndefined()
  })

  test('a chat with no recorded turns gets an empty map and NO totals field', async () => {
    const chat = await createChat({ agentId: 'main' })
    const get = findRoute(activated.routes, 'GET', '/chats/:chatId')!
    const res = await callRoute(get, activated.ctx, { path: `/chats/${chat.id}` })
    expect(res.body.usage).toEqual({})
    expect(res.body.usageTotals).toBeUndefined()
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

  test('a throwing loader yields honest absence — undefined, never zeros', async () => {
    const result = await chatTurnUsage('c-down', undefined, () => {
      throw new Error('ledger unavailable')
    })
    expect(result).toBeUndefined()
  })
})
