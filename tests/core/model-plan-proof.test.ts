/**
 * Positive model evidence for the plan (margo 2026-10-18): a model is proven
 * by tokens in usage history or a passing probe within the proof window;
 * unreadable evidence proves nothing. Probe outcomes record through the ONE
 * availability chokepoint.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-model-plan-proof-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }))

type Cell = { agent: string; day: string; model: string; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } }
let usageCells: Cell[] = []
let usageThrows = false
let usageSince: string | null = null
mock.module('@bakin/core/usage-history/store', () => ({
  readUsageByAgentModelDaySince: (sinceDay: string) => {
    usageSince = sinceDay
    if (usageThrows) throw new Error('usage.db unreadable')
    return usageCells
  },
  toLocalDayKey: (tsMs: number) => {
    const d = new Date(tsMs)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  },
}))

import { closeDb } from '../../packages/core/src/storage/db'
import { recordModelProbeSuccess } from '../../packages/core/src/execution/ledger'
import { invalidateResolvedProof, provenForRef, provenModelIds, provenModels, PROOF_WINDOW_DAYS, resolveProvenModelIds } from '../../src/core/model-plan-input'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { noteProbeOutcome } from '../../src/core/model-availability'

const DAY = 86_400_000
const tokens = (total: number) => ({ input: total, output: 0, cacheRead: 0, cacheWrite: 0, total })

beforeEach(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  usageCells = []
  usageThrows = false
  usageSince = null
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('provenModelIds', () => {
  it('counts models that produced tokens in the window; zero-token and unknown-model rows prove nothing', () => {
    usageCells = [
      { agent: 'main', day: '2026-10-18', model: 'openai-codex/gpt-6-astra', tokens: tokens(1200) },
      { agent: 'main', day: '2026-10-18', model: 'openclaw/delivery-mirror', tokens: tokens(0) },
      { agent: 'main', day: '2026-10-18', model: '', tokens: tokens(50) },
    ]
    const now = Date.parse('2026-10-18T20:00:00Z')
    expect([...provenModelIds(now)]).toEqual(['openai-codex/gpt-6-astra'])
    const since = new Date(now - PROOF_WINDOW_DAYS * DAY)
    expect(usageSince).toBe(`${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`)
  })

  it('counts a passing probe inside the window, not one older than it', () => {
    const now = Date.now()
    recordModelProbeSuccess({ model: 'openai-codex/gpt-5.6-luna', at: now - DAY })
    recordModelProbeSuccess({ model: 'openai-codex/gpt-5.4-mini', at: now - (PROOF_WINDOW_DAYS + 1) * DAY })
    expect([...provenModelIds(now)]).toEqual(['openai-codex/gpt-5.6-luna'])
  })

  it('fails closed: unreadable usage history proves nothing, probes still count', () => {
    usageThrows = true
    recordModelProbeSuccess({ model: 'openai-codex/gpt-5.6-luna' })
    expect([...provenModelIds()]).toEqual(['openai-codex/gpt-5.6-luna'])
  })
})

describe('noteProbeOutcome', () => {
  it('a passing probe becomes proof; a failing one does not', () => {
    noteProbeOutcome('openai-codex/gpt-5.6-sol', { ok: true })
    noteProbeOutcome('openai-codex/gpt-5.4-mini', { ok: false, err: new Error('timeout') })
    expect([...provenModelIds()]).toEqual(['openai-codex/gpt-5.6-sol'])
  })
})

describe('resolveProvenModelIds', () => {
  it('resolves bare usage ids through the runtime (Pi records gpt-5.5, the catalog says openai-codex/gpt-5.5)', async () => {
    usageCells = [{ agent: 'main', day: '2026-10-18', model: 'gpt-5.5', tokens: tokens(900) }]
    const runtime = { models: { resolveId: async (ref: string) => (ref === 'gpt-5.5' ? 'openai-codex/gpt-5.5' : null) } } as unknown as AgentRuntimeAdapter
    const proven = await resolveProvenModelIds(runtime, Date.parse('2026-10-18T20:00:00Z'))
    expect(proven.has('openai-codex/gpt-5.5')).toBe(true)
  })

  it('a runtime without resolveId keeps ids as recorded', async () => {
    usageCells = [{ agent: 'main', day: '2026-10-18', model: 'openai-codex/gpt-6-astra', tokens: tokens(1) }]
    const runtime = { models: {} } as unknown as AgentRuntimeAdapter
    expect([...await resolveProvenModelIds(runtime, Date.parse('2026-10-18T20:00:00Z'))]).toEqual(['openai-codex/gpt-6-astra'])
  })
})

describe('provenForRef', () => {
  it('an agent pin is proven only by THAT agent\'s own usage; install-wide refs by anyone or a probe', () => {
    usageCells = [
      { agent: 'main', day: '2026-10-18', model: 'openai-codex/gpt-6-astra', tokens: tokens(100) },
      { agent: 'jessica', day: '2026-10-18', model: 'openai-codex/gpt-5.5', tokens: tokens(100) },
    ]
    recordModelProbeSuccess({ model: 'openai-codex/gpt-5.6-luna' })
    const proven = provenModels(Date.parse('2026-10-18T20:00:00Z'))
    expect(provenForRef(proven, 'openai-codex/gpt-6-astra', 'agent:main:model')).toBe(true)
    expect(provenForRef(proven, 'openai-codex/gpt-6-astra', 'agent:jessica:model')).toBe(false)
    expect(provenForRef(proven, 'openai-codex/gpt-5.6-luna', 'agent:main:model')).toBe(false) // a probe is not this agent's access
    expect(provenForRef(proven, 'openai-codex/gpt-5.6-luna', 'route:relay')).toBe(true)
    expect(provenForRef(proven, 'openai-codex/gpt-5.5', 'policy:defaultModel')).toBe(true)
  })
})

describe('resolved proof memo', () => {
  it('serves the memo within the TTL, and invalidateResolvedProof makes new proof visible at once', async () => {
    const runtime = { models: {} } as unknown as AgentRuntimeAdapter
    const now = Date.now()
    expect((await resolveProvenModelIds(runtime, now)).has('openai-codex/gpt-5.6-terra')).toBe(false)
    recordModelProbeSuccess({ model: 'openai-codex/gpt-5.6-terra' })
    expect((await resolveProvenModelIds(runtime, now + 1_000)).has('openai-codex/gpt-5.6-terra')).toBe(false) // memo
    invalidateResolvedProof()
    expect((await resolveProvenModelIds(runtime, now + 1_000)).has('openai-codex/gpt-5.6-terra')).toBe(true)
  })
})
