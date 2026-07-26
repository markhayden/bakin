/**
 * adapter-pi sessions.contextStats (#737) — the honest context reading,
 * file-only at rest, mirroring the Pi SDK's own getContextUsage
 * semantics: last VALID assistant usage anchors the exact reading
 * (+ chars÷4 for entries after it), a post-compaction gap reads
 * tokens: null, the threshold is window − reserveTokens, and unmapped
 * threads read null.
 *
 * FIXTURE REALISM MATTERS (review finding): real Pi message timestamps
 * are epoch-ms NUMBERS (compaction entries carry ISO strings), message
 * content is an array of {type:'text',text} parts, and the session
 * header's version is numeric. ISO-string fixture timestamps masked a
 * dead compaction guard once — keep these shapes true to disk.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-pi-context-stats-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = pathJoin(testDir, 'pi')
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

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
import { sessionContextStats, __resetContextStatsCacheForTest } from '../../packages/adapter-pi/src/context-stats'
import { findPiModel } from '../../packages/adapter-pi/src/models'

resetPiHome()

const AGENT = 'main'
const MODEL_PROVIDER = 'anthropic'
const MODEL_ID = 'claude-sonnet-4-5'
/** Resolve the expected window from the live catalog — a hardcoded number
 *  would fail confusingly on an SDK catalog bump. */
const CATALOG_WINDOW = findPiModel(`${MODEL_PROVIDER}/${MODEL_ID}`)?.contextWindow ?? 0

const T_BASE = 1_785_000_000_000 // epoch ms — the REAL message timestamp shape

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  __resetContextStatsCacheForTest()
})

interface FixtureEntry { [key: string]: unknown }

let entrySeq = 0
function eid(): string {
  entrySeq += 1
  return `e${String(entrySeq).padStart(4, '0')}`
}

function sessionHeader(id: string): FixtureEntry {
  return { type: 'session', version: 3, id, timestamp: new Date(T_BASE).toISOString(), cwd: getAgentWorkspaceDir(AGENT) }
}

function modelChange(provider = MODEL_PROVIDER, modelId = MODEL_ID): FixtureEntry {
  return { type: 'model_change', id: eid(), parentId: null, timestamp: new Date(T_BASE + 1).toISOString(), provider, modelId }
}

function thinkingLevelChange(): FixtureEntry {
  return { type: 'thinking_level_change', id: eid(), parentId: null, timestamp: new Date(T_BASE + 2).toISOString(), thinkingLevel: 'medium' }
}

function userMessage(text: string): FixtureEntry {
  return {
    type: 'message',
    id: eid(),
    parentId: null,
    timestamp: new Date(T_BASE + 3).toISOString(),
    message: { role: 'user', content: [{ type: 'text', text }], timestamp: T_BASE + 3 },
  }
}

function assistantMessage(opts: {
  totalTokens: number
  stopReason?: string
  text?: string
  tsMs?: number
  provider?: string
  model?: string
}): FixtureEntry {
  const tsMs = opts.tsMs ?? T_BASE + 4
  return {
    type: 'message',
    id: eid(),
    parentId: null,
    timestamp: new Date(tsMs).toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: opts.text ?? 'a reply' }],
      api: 'anthropic-messages',
      provider: opts.provider ?? MODEL_PROVIDER,
      model: opts.model ?? MODEL_ID,
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
      // REAL shape: epoch-ms number, NOT an ISO string.
      timestamp: tsMs,
    },
  }
}

function compactionEntry(opts: { tokensBefore: number; tsMs: number }): FixtureEntry {
  return {
    type: 'compaction',
    id: eid(),
    parentId: null,
    timestamp: new Date(opts.tsMs).toISOString(),
    summary: 'compacted summary of the earlier conversation',
    firstKeptEntryId: 'kept',
    tokensBefore: opts.tokensBefore,
    details: { readFiles: [], modifiedFiles: [] },
    fromHook: false,
  }
}

/** Write a session file + thread mapping, return the threadId. */
function seedSession(entries: FixtureEntry[]): { threadId: string; file: string } {
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
  map.threads[threadId] = { sessionId, file, createdAt: new Date(T_BASE).toISOString(), updatedAt: new Date(T_BASE).toISOString() }
  writeFileSync(mapPath, JSON.stringify(map))
  return { threadId, file }
}

function chain(entries: FixtureEntry[]): FixtureEntry[] {
  let prev: string | null = null
  for (const e of entries) {
    if (e.type === 'session') continue
    e.parentId = prev
    prev = (e.id as string) ?? prev
  }
  return entries
}

describe('pi sessions.contextStats', () => {
  it('reads the last VALID assistant usage.totalTokens as the context, with window + threshold from the catalog', async () => {
    expect(CATALOG_WINDOW).toBeGreaterThan(0) // catalog sanity for this suite
    const { threadId } = seedSession(chain([
      sessionHeader(randomUUID()),
      modelChange(),
      thinkingLevelChange(),
      userMessage('first question'),
      assistantMessage({ totalTokens: 45_300 }),
    ]))
    const stats = await sessionContextStats({ agentId: AGENT, threadId })
    expect(stats).not.toBeNull()
    expect(stats!.tokens).toBe(45_300)
    expect(stats!.contextWindow).toBe(CATALOG_WINDOW)
    expect(stats!.compactionThreshold).toBe(CATALOG_WINDOW - 16_384)
    expect(stats!.model).toBe(`${MODEL_PROVIDER}/${MODEL_ID}`)
  })

  it('adds a chars÷4 estimate for entries after the last valid usage', async () => {
    const trailing = 'x'.repeat(4_000) // ~1000 estimated tokens
    const { threadId } = seedSession(chain([
      sessionHeader(randomUUID()),
      modelChange(),
      userMessage('q'),
      assistantMessage({ totalTokens: 10_000 }),
      userMessage(trailing),
    ]))
    const stats = await sessionContextStats({ agentId: AGENT, threadId })
    expect(stats!.tokens).toBeGreaterThan(10_500)
    expect(stats!.tokens).toBeLessThan(12_500)
  })

  it('a toolUse-stopReason assistant anchors the reading (the common mid-loop shape)', async () => {
    const { threadId } = seedSession(chain([
      sessionHeader(randomUUID()),
      modelChange(),
      userMessage('q'),
      assistantMessage({ totalTokens: 30_000, stopReason: 'toolUse' }),
    ]))
    const stats = await sessionContextStats({ agentId: AGENT, threadId })
    expect(stats!.tokens).toBe(30_000)
  })

  it('skips aborted AND error assistant usage (the valid-usage predicate)', async () => {
    const { threadId } = seedSession(chain([
      sessionHeader(randomUUID()),
      modelChange(),
      userMessage('q'),
      assistantMessage({ totalTokens: 20_000 }),
      assistantMessage({ totalTokens: 99_999, stopReason: 'aborted', tsMs: T_BASE + 10 }),
      assistantMessage({ totalTokens: 88_888, stopReason: 'error', tsMs: T_BASE + 11 }),
    ]))
    const stats = await sessionContextStats({ agentId: AGENT, threadId })
    expect(stats!.tokens).toBeGreaterThanOrEqual(20_000)
    expect(stats!.tokens).toBeLessThan(21_000)
  })

  it('post-compaction gap: tokens null + lastCompaction — the guard works on REAL numeric message timestamps', async () => {
    const { threadId } = seedSession(chain([
      sessionHeader(randomUUID()),
      modelChange(),
      userMessage('long conversation'),
      assistantMessage({ totalTokens: 250_000, tsMs: T_BASE + 100 }),
      compactionEntry({ tokensBefore: 253_352, tsMs: T_BASE + 600_000 }),
    ]))
    const stats = await sessionContextStats({ agentId: AGENT, threadId })
    expect(stats).not.toBeNull()
    // The pre-compaction 250k anchor must NOT leak as the current reading.
    expect(stats!.tokens).toBeNull()
    expect(stats!.lastCompaction).toMatchObject({
      at: new Date(T_BASE + 600_000).toISOString(),
      tokensBefore: 253_352,
    })
  })

  it('after a compaction, a NEW valid assistant reading takes over (the visible drop)', async () => {
    const { threadId } = seedSession(chain([
      sessionHeader(randomUUID()),
      modelChange(),
      userMessage('long conversation'),
      assistantMessage({ totalTokens: 250_000, tsMs: T_BASE + 100 }),
      compactionEntry({ tokensBefore: 253_352, tsMs: T_BASE + 600_000 }),
      userMessage('continue'),
      assistantMessage({ totalTokens: 32_000, tsMs: T_BASE + 700_000 }),
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
    const { threadId } = seedSession(chain([
      sessionHeader(randomUUID()),
      modelChange('mystery', 'unknown-model'),
      userMessage('q'),
      assistantMessage({ totalTokens: 12_000, provider: 'mystery', model: 'unknown-model' }),
    ]))
    const stats = await sessionContextStats({ agentId: AGENT, threadId })
    expect(stats!.tokens).toBe(12_000)
    expect(stats!.contextWindow).toBeNull()
    expect(stats!.compactionThreshold).toBeNull()
  })

  it('a session with NO valid usage reads tokens null (deliberate SDK divergence: absence over unanchored estimate)', async () => {
    const { threadId } = seedSession(chain([
      sessionHeader(randomUUID()),
      modelChange(),
      userMessage('question with no reply yet'),
    ]))
    const stats = await sessionContextStats({ agentId: AGENT, threadId })
    expect(stats).not.toBeNull()
    expect(stats!.tokens).toBeNull()
  })

  it('caches per file on mtime+size and refreshes when the session grows', async () => {
    const entries = chain([
      sessionHeader(randomUUID()),
      modelChange(),
      userMessage('q'),
      assistantMessage({ totalTokens: 10_000 }),
    ])
    const { threadId, file } = seedSession(entries)
    expect((await sessionContextStats({ agentId: AGENT, threadId }))!.tokens).toBe(10_000)
    // Repeat read (cache hit) — same honest value.
    expect((await sessionContextStats({ agentId: AGENT, threadId }))!.tokens).toBe(10_000)
    // The session grows (append is the ONLY mutation turns perform) —
    // chained onto the current leaf, exactly like a real turn.
    const grown = assistantMessage({ totalTokens: 22_000, tsMs: T_BASE + 900_000 })
    grown.parentId = entries[entries.length - 1].id
    appendFileSync(file, JSON.stringify(grown) + '\n')
    expect((await sessionContextStats({ agentId: AGENT, threadId }))!.tokens).toBe(22_000)
  })
})
