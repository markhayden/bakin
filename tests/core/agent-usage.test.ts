import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock the agents directory before importing
const testDir = join(tmpdir(), `bakin-usage-test-${Date.now()}`)

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => testDir }
})

const { getAllAgentUsage } = await import('../../src/core/agent-usage')

function writeSession(agent: string, filename: string, lines: object[]) {
  const dir = join(testDir, '.openclaw', 'agents', agent, 'sessions')
  mkdirSync(dir, { recursive: true })
  const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n'
  writeFileSync(join(dir, filename), content)
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('getAllAgentUsage', () => {
  it('returns empty array when no agents exist', () => {
    const result = getAllAgentUsage()
    expect(result).toEqual([])
  })

  it('parses a single agent session with usage data', () => {
    writeSession('pixel', 'session-1.jsonl', [
      { type: 'session', id: 'sess-1', timestamp: '2026-03-26T10:00:00Z' },
      {
        type: 'message', id: 'msg-1', timestamp: '2026-03-26T10:01:00Z',
        message: {
          role: 'assistant', model: 'claude-opus-4-6',
          usage: {
            input: 1000, output: 500, cacheRead: 200, cacheWrite: 300, totalTokens: 2000,
            cost: { input: 0.01, output: 0.005, cacheRead: 0.001, cacheWrite: 0.002, total: 0.018 },
          },
        },
      },
    ])

    const result = getAllAgentUsage()
    expect(result).toHaveLength(1)
    expect(result[0].agent).toBe('pixel')
    expect(result[0].sessionId).toBe('sess-1')
    expect(result[0].model).toBe('claude-opus-4-6')
    expect(result[0].messages).toBe(1)
    expect(result[0].tokens.total).toBe(2000)
    expect(result[0].cost.total).toBeCloseTo(0.018)
  })

  it('sums usage across multiple messages', () => {
    const msg = (input: number, output: number) => ({
      type: 'message', id: `msg-${input}`,
      message: {
        role: 'assistant', model: 'claude-opus-4-6',
        usage: {
          input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output,
          cost: { input: input * 0.00001, output: output * 0.00001, cacheRead: 0, cacheWrite: 0, total: (input + output) * 0.00001 },
        },
      },
    })

    writeSession('trainer', 'session-1.jsonl', [
      { type: 'session', id: 'sess-1', timestamp: '2026-03-26T10:00:00Z' },
      msg(1000, 200),
      msg(2000, 400),
      msg(3000, 600),
    ])

    const result = getAllAgentUsage()
    expect(result).toHaveLength(1)
    expect(result[0].messages).toBe(3)
    expect(result[0].tokens.input).toBe(6000)
    expect(result[0].tokens.output).toBe(1200)
    expect(result[0].tokens.total).toBe(7200)
  })

  it('uses the most recent session file', () => {
    // Older session
    writeSession('explorer', 'aaa-old.jsonl', [
      { type: 'session', id: 'old', timestamp: '2026-03-20T10:00:00Z' },
      {
        type: 'message', id: 'msg-old',
        message: {
          role: 'assistant', model: 'claude-opus-4-6',
          usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 } },
        },
      },
    ])

    // Newer session — write after so mtime is later
    writeSession('explorer', 'zzz-new.jsonl', [
      { type: 'session', id: 'new', timestamp: '2026-03-26T10:00:00Z' },
      {
        type: 'message', id: 'msg-new',
        message: {
          role: 'assistant', model: 'claude-opus-4-6',
          usage: { input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0, totalTokens: 7000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.05 } },
        },
      },
    ])

    const result = getAllAgentUsage()
    expect(result).toHaveLength(1)
    expect(result[0].sessionId).toBe('new')
    expect(result[0].tokens.total).toBe(7000)
  })

  it('skips deleted session files', () => {
    const dir = join(testDir, '.openclaw', 'agents', 'chef', 'sessions')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'abc.jsonl.deleted.2026-03-20'), JSON.stringify({ type: 'session', id: 'del' }) + '\n')

    const result = getAllAgentUsage()
    expect(result).toEqual([])
  })

  it('skips user messages (only counts assistant)', () => {
    writeSession('patch', 'session-1.jsonl', [
      { type: 'session', id: 'sess-1', timestamp: '2026-03-26T10:00:00Z' },
      {
        type: 'message', id: 'msg-user',
        message: { role: 'user', content: 'hello' },
      },
      {
        type: 'message', id: 'msg-asst',
        message: {
          role: 'assistant', model: 'claude-opus-4-6',
          usage: { input: 500, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 600, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.005 } },
        },
      },
    ])

    const result = getAllAgentUsage()
    expect(result).toHaveLength(1)
    expect(result[0].messages).toBe(1)
  })

  it('returns multiple agents sorted by total tokens descending', () => {
    writeSession('small', 'session-1.jsonl', [
      { type: 'session', id: 's1', timestamp: '2026-03-26T10:00:00Z' },
      {
        type: 'message', id: 'msg-1',
        message: {
          role: 'assistant', model: 'claude-haiku-4-5',
          usage: { input: 100, output: 50, totalTokens: 150, cost: { total: 0.001 } },
        },
      },
    ])

    writeSession('big', 'session-1.jsonl', [
      { type: 'session', id: 's2', timestamp: '2026-03-26T10:00:00Z' },
      {
        type: 'message', id: 'msg-1',
        message: {
          role: 'assistant', model: 'claude-opus-4-6',
          usage: { input: 50000, output: 10000, totalTokens: 60000, cost: { total: 0.50 } },
        },
      },
    ])

    const result = getAllAgentUsage()
    expect(result).toHaveLength(2)
    expect(result[0].agent).toBe('big')
    expect(result[1].agent).toBe('small')
  })

  it('handles malformed JSONL lines gracefully', () => {
    const dir = join(testDir, '.openclaw', 'agents', 'broken', 'sessions')
    mkdirSync(dir, { recursive: true })
    const content = [
      JSON.stringify({ type: 'session', id: 'sess-1', timestamp: '2026-03-26T10:00:00Z' }),
      'this is not json',
      JSON.stringify({
        type: 'message', id: 'msg-1',
        message: {
          role: 'assistant', model: 'claude-opus-4-6',
          usage: { input: 100, output: 50, totalTokens: 150, cost: { total: 0.001 } },
        },
      }),
    ].join('\n') + '\n'
    writeFileSync(join(dir, 'session-1.jsonl'), content)

    const result = getAllAgentUsage()
    expect(result).toHaveLength(1)
    expect(result[0].messages).toBe(1)
  })
})
