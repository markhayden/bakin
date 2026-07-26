/**
 * adapter-openclaw sessions.contextStats (#737) — a pure session-store
 * read: threadId → deterministic CLI session id → explicit store key →
 * sessions.json entry. `totalTokens` (the gateway's last-call prompt
 * snapshot) gated on `totalTokensFresh === true`; window from
 * `contextTokens`; threshold ONLY from a runtime-written
 * contextBudgetStatus (config guessing is banned — codex-native
 * compaction is opaque); lastCompaction from compactionCheckpoints.
 * The trajectory is NEVER read (billing-aggregate trap — the 109% class).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const contentDir = mkdtempSync(join(tmpdir(), 'bakin-ctx-stats-content-'))
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => contentDir,
  getBakinPaths: () => ({ root: contentDir, db: join(contentDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => contentDir,
  getBakinPaths: () => ({ root: contentDir, db: join(contentDir, 'bakin.db') }),
}))
afterAll(() => rmSync(contentDir, { recursive: true, force: true }))

import {
  openClawCliSessionId,
  openClawExplicitSessionKey,
  __resetSessionStoreCacheForTest,
} from '../../packages/adapter-openclaw/src/session-store'
import { openClawSessionContextStats } from '../../packages/adapter-openclaw/src/context-stats'

describe('OpenClaw sessions.contextStats', () => {
  let testDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-ctx-stats-'))
    originalHome = process.env.OPENCLAW_HOME
    process.env.OPENCLAW_HOME = testDir
    __resetSessionStoreCacheForTest()
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalHome
    rmSync(testDir, { recursive: true, force: true })
  })

  function seedStore(agentId: string, entries: Record<string, unknown>) {
    const sessionsDir = join(testDir, 'agents', agentId, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify(entries))
  }

  function entryKeyFor(agentId: string, threadId: string): string {
    return openClawExplicitSessionKey(agentId, openClawCliSessionId(agentId, threadId))
  }

  it('reads fresh totalTokens as the context with the stored window', async () => {
    const threadId = 'chat:11111111-1111-1111-1111-111111111111'
    seedStore('main', {
      [entryKeyFor('main', threadId)]: {
        sessionId: openClawCliSessionId('main', threadId),
        updatedAt: 1_785_000_000_000,
        model: 'gpt-5.5',
        totalTokens: 200_233,
        totalTokensFresh: true,
        contextTokens: 272_000,
      },
    })
    const stats = await openClawSessionContextStats({ agentId: 'main', threadId })
    expect(stats).toMatchObject({
      tokens: 200_233,
      contextWindow: 272_000,
      compactionThreshold: null, // codex-native compaction is opaque
      model: 'gpt-5.5',
    })
  })

  it('stale totalTokens (totalTokensFresh false/absent) reads tokens null — never the stale number', async () => {
    const threadId = 'chat:22222222-2222-2222-2222-222222222222'
    seedStore('main', {
      [entryKeyFor('main', threadId)]: {
        sessionId: openClawCliSessionId('main', threadId),
        totalTokens: 999_999,
        totalTokensFresh: false,
        contextTokens: 272_000,
      },
    })
    const stats = await openClawSessionContextStats({ agentId: 'main', threadId })
    expect(stats!.tokens).toBeNull()
    expect(stats!.contextWindow).toBe(272_000)
  })

  it('missing entry / missing store reads null — never a throw', async () => {
    seedStore('main', {})
    expect(await openClawSessionContextStats({ agentId: 'main', threadId: 'chat:missing' })).toBeNull()
    expect(await openClawSessionContextStats({ agentId: 'ghost-agent', threadId: 'chat:missing' })).toBeNull()
  })

  it('threshold comes ONLY from a runtime-written contextBudgetStatus', async () => {
    const threadId = 'chat:33333333-3333-3333-3333-333333333333'
    seedStore('main', {
      [entryKeyFor('main', threadId)]: {
        sessionId: openClawCliSessionId('main', threadId),
        totalTokens: 100_000,
        totalTokensFresh: true,
        contextTokens: 272_000,
        contextBudgetStatus: { contextTokenBudget: 272_000, reserveTokens: 24_000, shouldCompact: false },
      },
    })
    const stats = await openClawSessionContextStats({ agentId: 'main', threadId })
    expect(stats!.compactionThreshold).toBe(248_000)
  })

  it('lastCompaction surfaces the newest compaction checkpoint', async () => {
    const threadId = 'chat:44444444-4444-4444-4444-444444444444'
    seedStore('main', {
      [entryKeyFor('main', threadId)]: {
        sessionId: openClawCliSessionId('main', threadId),
        totalTokens: 40_000,
        totalTokensFresh: true,
        contextTokens: 272_000,
        compactionCount: 2,
        compactionCheckpoints: [
          { checkpointId: 'c1', createdAt: 1_784_000_000_000, reason: 'auto-threshold', tokensBefore: 250_000 },
          { checkpointId: 'c2', createdAt: 1_785_000_000_000, reason: 'manual', tokensBefore: 180_000 },
        ],
      },
    })
    const stats = await openClawSessionContextStats({ agentId: 'main', threadId })
    expect(stats!.lastCompaction).toMatchObject({
      at: new Date(1_785_000_000_000).toISOString(),
      reason: 'manual',
      tokensBefore: 180_000,
    })
  })

  it('window absent from the store → contextWindow null (never fabricated), tokens still honest', async () => {
    const threadId = 'chat:55555555-5555-5555-5555-555555555555'
    seedStore('main', {
      [entryKeyFor('main', threadId)]: {
        sessionId: openClawCliSessionId('main', threadId),
        totalTokens: 12_345,
        totalTokensFresh: true,
      },
    })
    const stats = await openClawSessionContextStats({ agentId: 'main', threadId })
    expect(stats!.tokens).toBe(12_345)
    expect(stats!.contextWindow).toBeNull()
    expect(stats!.compactionThreshold).toBeNull()
  })
})
