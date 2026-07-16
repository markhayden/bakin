import { describe, expect, it } from 'bun:test'

import { parseSessionUsageContent } from '../../src/core/agent-usage'

function session(messages: object[]): string {
  return [
    JSON.stringify({ type: 'session', id: 'session-cost-coverage', timestamp: '2026-07-15T12:00:00Z' }),
    ...messages.map((message) => JSON.stringify(message)),
  ].join('\n')
}

function assistantUsage(cost?: object) {
  return {
    type: 'message',
    timestamp: '2026-07-15T12:01:00Z',
    message: {
      role: 'assistant',
      model: 'gpt-test',
      usage: {
        input: 100,
        output: 50,
        totalTokens: 150,
        ...(cost ? { cost } : {}),
      },
    },
  }
}

describe('latest-session cost coverage', () => {
  it('counts only assistant messages that reported a usable runtime cost', () => {
    const usage = parseSessionUsageContent(session([
      assistantUsage({ total: 0.03 }),
      assistantUsage(),
      assistantUsage({ input: 0.01, output: 0.02 }),
    ]), 'main')

    expect(usage).not.toBeNull()
    expect(usage?.messages).toBe(3)
    expect(usage?.costedMessages).toBe(2)
    expect(usage?.cost.total).toBeCloseTo(0.06)
  })

  it('reports zero costed messages when runtime cost is unavailable', () => {
    const usage = parseSessionUsageContent(session([
      assistantUsage(),
      assistantUsage({}),
    ]), 'main')

    expect(usage).not.toBeNull()
    expect(usage?.messages).toBe(2)
    expect(usage?.costedMessages).toBe(0)
    expect(usage?.cost).toEqual({
      input: null,
      output: null,
      cacheRead: null,
      cacheWrite: null,
      total: null,
      source: 'unavailable',
    })
  })

  it('keeps a partial component subtotal without calling the message fully costed', () => {
    const usage = parseSessionUsageContent(session([
      assistantUsage({ input: 0.01 }),
    ]), 'main')

    expect(usage).not.toBeNull()
    expect(usage?.messages).toBe(1)
    expect(usage?.costedMessages).toBe(0)
    expect(usage?.cost.total).toBeCloseTo(0.01)
    expect(usage?.cost.source).toBe('runtime')
  })

  it('requires cache cost components when the corresponding cache tokens are positive', () => {
    const content = session([{
      type: 'message',
      timestamp: '2026-07-15T12:01:00Z',
      message: {
        role: 'assistant',
        model: 'gpt-test',
        usage: {
          input: 100,
          output: 50,
          cacheRead: 25,
          totalTokens: 175,
          cost: { input: 0.01, output: 0.02 },
        },
      },
    }])

    const usage = parseSessionUsageContent(content, 'main')

    expect(usage?.costedMessages).toBe(0)
    expect(usage?.cost.total).toBeCloseTo(0.03)
  })
})
