import { describe, expect, it } from 'bun:test'

import {
  agentUsageResponseSchema,
  isAgentUsageResponse,
  isAgentUsageSnapshotResponse,
} from '../../../plugins/health/lib/agent-route-schemas'

const base = {
  agent: 'main',
  sessionId: 'session-1',
  sessionStarted: '2026-07-15T12:00:00.000Z',
  model: 'gpt-test',
  messages: 2,
  tokens: { input: 200, output: 100, cacheRead: 0, cacheWrite: 0, total: 300 },
  cost: {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    total: 0.03,
    source: 'runtime' as const,
  },
}

describe('latest-session cost coverage wire contract', () => {
  it('requires coverage on current server rows', () => {
    const current = {
      ...base,
      lastMessageAt: '2026-07-15T12:02:00.000Z',
      costedMessages: 1,
    }

    expect(agentUsageResponseSchema.safeParse([current]).success).toBe(true)
    expect(agentUsageResponseSchema.safeParse([{
      ...base,
      lastMessageAt: '2026-07-15T12:02:00.000Z',
    }]).success).toBe(false)
  })

  it('accepts exact prior wire generations but rejects impossible hybrids', () => {
    const oldestLegacy = { ...base }
    const priorSnapshotRow = {
      ...base,
      lastMessageAt: '2026-07-15T12:02:00.000Z',
    }
    const current = { ...priorSnapshotRow, costedMessages: 1 }

    expect(isAgentUsageResponse([oldestLegacy])).toBe(true)
    expect(isAgentUsageResponse([priorSnapshotRow])).toBe(true)
    expect(isAgentUsageResponse([current])).toBe(true)
    expect(isAgentUsageResponse([{ ...oldestLegacy, costedMessages: 1 }])).toBe(false)
    expect(isAgentUsageResponse([oldestLegacy, current])).toBe(false)

    expect(isAgentUsageSnapshotResponse({
      generatedAt: '2026-07-15T12:03:00.000Z',
      source: { status: 'complete', reason: 'complete', failedAgents: [] },
      sessions: [priorSnapshotRow],
    })).toBe(true)
    expect(isAgentUsageSnapshotResponse({
      generatedAt: '2026-07-15T12:03:00.000Z',
      source: { status: 'complete', reason: 'complete', failedAgents: [] },
      sessions: [priorSnapshotRow, current],
    })).toBe(false)
  })

  it('accepts a known partial subtotal but rejects impossible coverage payloads', () => {
    const current = {
      ...base,
      lastMessageAt: '2026-07-15T12:02:00.000Z',
      costedMessages: 1,
    }

    expect(agentUsageResponseSchema.safeParse([{ ...current, costedMessages: 3 }]).success).toBe(false)
    expect(agentUsageResponseSchema.safeParse([{
      ...current,
      costedMessages: 0,
    }]).success).toBe(true)
    expect(agentUsageResponseSchema.safeParse([{
      ...current,
      costedMessages: 1,
      cost: {
        input: null,
        output: null,
        cacheRead: null,
        cacheWrite: null,
        total: null,
        source: 'unavailable',
      },
    }]).success).toBe(false)
  })
})
