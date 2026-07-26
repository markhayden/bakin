/**
 * adapter-pi sessions.contextStats (#737) — the honest context reading,
 * file-only at rest, mirroring the Pi SDK's own getContextUsage
 * semantics: last VALID assistant usage.totalTokens (+ chars÷4 for
 * entries after it), a post-compaction gap reads tokens: null, the
 * threshold is window − reserveTokens, and unmapped threads read null.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-pi-context-stats-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = pathJoin(testDir, 'pi')
process.env.BAKIN_HOME = testDir

import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: pathJoin(testDir, 'bakin.db') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: pathJoin(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { resetPiHome, getAgentSessionsDir, getAgentWorkspaceDir } from '../../packages/adapter-pi/src/home'
import { sessionContextStats } from '../../packages/adapter-pi/src/context-stats'

resetPiHome()

const AGENT = 'main'
const MODEL_PROVIDER = 'anthropic'
const MODEL_ID = 'claude-sonnet-4-5' // a catalog model with a known numeric window

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

interface FixtureEntry { [key: string]: unknown }

let entrySeq = 0
function eid(): string {
  entrySeq += 1
  return `e${String(entrySeq).padStart(4, '0')}`
}

function sessionHeader(id: string): FixtureEntry {
  return { type: 'session', version: '3', id, timestamp: '2026-07-26T00:00:00.000Z', cwd: getAgentWorkspaceDir(AGENT) }
}

function modelChange(parentId: string | null): FixtureEntry {
  return { type: 'model_change', id: eid(), parentId, timestamp: '2026-07-26T00:00:01.000Z', provider: MODEL_PROVIDER, modelId: MODEL_ID }
}

function userMessage(parentId: string, text: string): FixtureEntry {
  return {
    type: 'message',
    id: eid(),
    parentId,
    timestamp: '2026-07-26T00:00:02.000Z',
    message: { role: 'user', content: text, timestamp: '2026-07-26T00:00:02.000Z' },
  }
}

function assistantMessage(
  parentId: string,
  opts: { totalTokens: number; stopReason?: string; text?: string; ts?: string },
): FixtureEntry {
  return {
    type: 'message',
    id: eid(),
    parentId,
    timestamp: opts.ts ?? '2026-07-26T00:00:03.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: opts.text ?? 'a reply' }],
      api: 'anthropic-messages',
      provider: MODEL_PROVIDER,
      model: MODEL_ID,
      usage: {
        input: Math.max(0, Math.floor(opts.totalTokens * 0.1)),
        output: 100,
        cacheRead: Math.max(0, opts.totalTokens - Math.floor(opts.totalTokens * 0.1) - 100),
        cacheWrite: 0,
        reasoning: 0,
        totalTokens: opts.totalTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: opts.stopReason ?? 'stop',
      timestamp: opts.ts ?? '2026-07-26T00:00:03.000Z',
    },
  }
}

function compactionEntry(parentId: string, opts: { tokensBefore: number; ts: string }): FixtureEntry {
  return {
    type: 'compaction',
    id: eid(),
    parentId,
    timestamp: opts.ts,
    summary: 'compacted summary of the earlier conversation',
    firstKeptEntryId: parentId,
    tokensBefore: opts.tokensBefore,
    fromHook: false,
  }
}

/** Write a session file + thread mapping, return the threadId. */
function seedSession(entries: FixtureEntry[]): string {
  const sessionsDir = getAgentSessionsDir(AGENT)
  mkdirSync(getAgentWorkspaceDir(AGENT), { recursive: true })
  mkdirSync(sessionsDir, { recursive: true })
  const sessionId = randomUUID()
  const file = pathJoin(sessionsDir, `2026-07-26T00-00-00-000Z_${sessionId}.jsonl`)
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const threadId = `chat:${randomUUID()}`
  const mapPath = pathJoin(sessionsDir, 'bakin-threads.json')
  let map = { version: 1 as const, threads: {} as Record<string, unknown> }
  try {
    map = JSON.parse(readFileSync(mapPath, 'utf-8'))
  } catch {
    // first seed — start fresh
  }
  map.threads[threadId] = { sessionId, file, createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z' }
  writeFileSync(mapPath, JSON.stringify(map))
  return threadId
}

function chain(entries: FixtureEntry[]): FixtureEntry[] {
  // Fix up parentId chaining: each entry's parentId = previous entry's id.
  let prev: string | null = null
  for (const e of entries) {
    if (e.type === 'session') continue
    e.parentId = prev
    prev = (e.id as string) ?? prev
  }
  return entries
}

describe('pi sessions.contextStats', () => {
  it('reads the last VALID assistant usage.totalTokens as the context (+ tail estimate), with window + threshold', async () => {
    const sid = randomUUID()
    const threadId = seedSession(chain([
      sessionHeader(sid),
      modelChange(null),
      userMessage('x', 'first question'),
      assistantMessage('x', { totalTokens: 45_300 }),
    ]))
    const stats = await sessionContextStats({ agentId: AGENT, threadId })
    expect(stats).not.toBeNull()
    // No entries after the usage-bearing assistant → exact reading.
    expect(stats!.tokens).toBe(45_300)
    expect(stats!.contextWindow).toBeGreaterThan(45_300)
    // Threshold = window − reserveTokens (SDK default 16384, enabled).
    expect(stats!.compactionThreshold).toBe(stats!.contextWindow! - 16_384)
    expect(stats!.model).toBe(`${MODEL_PROVIDER}/${MODEL_ID}`)
  })

  it('adds a chars÷4 estimate for user entries after the last valid usage', async () => {
    const trailing = 'x'.repeat(4_000) // ~1000 estimated tokens
    const threadId = seedSession(chain([
      sessionHeader(randomUUID()),
      modelChange(null),
      userMessage('x', 'q'),
      assistantMessage('x', { totalTokens: 10_000 }),
      userMessage('x', trailing),
    ]))
    const stats = await sessionContextStats({ agentId: AGENT, threadId })
    expect(stats!.tokens).toBeGreaterThan(10_500)
    expect(stats!.tokens).toBeLessThan(12_500)
  })

  it('skips aborted/error assistant usage (the valid-usage predicate)', async () => {
    const threadId = seedSession(chain([
      sessionHeader(randomUUID()),
      modelChange(null),
      userMessage('x', 'q'),
      assistantMessage('x', { totalTokens: 20_000 }),
      assistantMessage('x', { totalTokens: 99_999, stopReason: 'aborted', ts: '2026-07-26T00:00:04.000Z' }),
    ]))
    const stats = await sessionContextStats({ agentId: AGENT, threadId })
    // The aborted message's usage is invalid — the valid 20k reading wins,
    // plus the estimate for the aborted message's text tail.
    expect(stats!.tokens).toBeGreaterThanOrEqual(20_000)
    expect(stats!.tokens).toBeLessThan(21_000)
  })

  it('post-compaction gap: tokens null + lastCompaction, never the stale pre-compaction number', async () => {
    const threadId = seedSession(chain([
      sessionHeader(randomUUID()),
      modelChange(null),
      userMessage('x', 'long conversation'),
      assistantMessage('x', { totalTokens: 250_000, ts: '2026-07-26T00:00:03.000Z' }),
      compactionEntry('x', { tokensBefore: 253_352, ts: '2026-07-26T00:10:00.000Z' }),
    ]))
    const stats = await sessionContextStats({ agentId: AGENT, threadId })
    expect(stats).not.toBeNull()
    expect(stats!.tokens).toBeNull()
    expect(stats!.lastCompaction).toMatchObject({ at: '2026-07-26T00:10:00.000Z', tokensBefore: 253_352 })
  })

  it('after a compaction, a NEW valid assistant reading takes over (the visible drop)', async () => {
    const threadId = seedSession(chain([
      sessionHeader(randomUUID()),
      modelChange(null),
      userMessage('x', 'long conversation'),
      assistantMessage('x', { totalTokens: 250_000, ts: '2026-07-26T00:00:03.000Z' }),
      compactionEntry('x', { tokensBefore: 253_352, ts: '2026-07-26T00:10:00.000Z' }),
      userMessage('x', 'continue'),
      assistantMessage('x', { totalTokens: 32_000, ts: '2026-07-26T00:11:00.000Z' }),
    ]))
    const stats = await sessionContextStats({ agentId: AGENT, threadId })
    expect(stats!.tokens).toBe(32_000)
    expect(stats!.lastCompaction).toMatchObject({ tokensBefore: 253_352 })
  })

  it('unmapped thread and missing file read as null — never a throw', async () => {
    expect(await sessionContextStats({ agentId: AGENT, threadId: `chat:${randomUUID()}` })).toBeNull()
    expect(await sessionContextStats({ agentId: 'no-such-agent', threadId: 'chat:x' })).toBeNull()
  })

  it('an unknown model yields tokens without window/threshold (never fabricated)', async () => {
    const sid = randomUUID()
    const entries = chain([
      sessionHeader(sid),
      { type: 'model_change', id: eid(), parentId: null, timestamp: '2026-07-26T00:00:01.000Z', provider: 'mystery', modelId: 'unknown-model' },
      userMessage('x', 'q'),
      {
        ...assistantMessage('x', { totalTokens: 12_000 }),
      },
    ])
    // Point the assistant message at the unknown model too.
    const last = entries[entries.length - 1] as { message: { provider: string; model: string } }
    last.message.provider = 'mystery'
    last.message.model = 'unknown-model'
    const threadId = seedSession(entries)
    const stats = await sessionContextStats({ agentId: AGENT, threadId })
    expect(stats!.tokens).toBe(12_000)
    expect(stats!.contextWindow).toBeNull()
    expect(stats!.compactionThreshold).toBeNull()
  })
})
