/**
 * Tests for `plugins/workflows/lib/edge-rules.ts`.
 *
 * canConnect is the pure validator xyflow's `isValidConnection` calls on
 * every pending connection. Cases covered:
 *   1. agent → second outbound rejected (maxOutbound: 1)
 *   2. gate → second outbound rejected (maxOutbound: 1)
 *   3. output as source → any outbound rejected (maxOutbound: 0)
 *   4. parallel target → unlimited inbound OK
 *   5. plugin kinds default to agent-style (maxOutbound: 1)
 *   6. self-loops rejected
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-edge-rules-${Date.now()}`)

// CLAUDE.md — required test isolation mocks.
vi.mock('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: vi.fn(),
  initBakinHome: vi.fn(),
  isUsingBakinHome: () => false,
}))
vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: vi.fn(),
  initBakinHome: vi.fn(),
  isUsingBakinHome: () => false,
}))
vi.mock('../../../plugins/tasks/lib/flow-store', () => ({
  createTask: vi.fn(),
  addTaskLog: vi.fn(),
  moveTask: vi.fn(),
  readTaskboard: vi.fn(() => ({ columns: {} })),
  getTask: vi.fn(() => null),
  getTaskWithColumn: vi.fn(() => null),
}))

import { canConnect } from '../../../plugins/workflows/lib/edge-rules'
import {
  registerPluginNodeType,
  unregisterPluginNodeTypes,
} from '../../../plugins/workflows/lib/node-type-registry'

type Edge = { source: string; target: string }

const STEPS: Record<string, string> = {
  agent1: 'agent',
  agent2: 'agent',
  agent3: 'agent',
  gate1: 'gate',
  output1: 'output',
  parallel1: 'parallel',
  plugin1: 'fx.echo',
  plugin2: 'fx.echo',
}

const kindResolver = (id: string) => STEPS[id]

describe('canConnect', () => {
  beforeEach(() => {
    registerPluginNodeType('fx', {
      kind: 'echo',
      zodSchema: z.object({
        id: z.string(),
        type: z.literal('fx.echo'),
        label: z.string(),
      }),
      formFields: [],
    })
  })

  afterEach(() => {
    unregisterPluginNodeTypes('fx')
  })

  it('allows the first outbound from an agent', () => {
    const result = canConnect('agent1', 'agent2', [], kindResolver)
    expect(result.ok).toBe(true)
  })

  it('rejects a second outbound from an agent (maxOutbound: 1)', () => {
    const edges: Edge[] = [{ source: 'agent1', target: 'agent2' }]
    const result = canConnect('agent1', 'agent3', edges, kindResolver)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('agent')
    expect(result.reason).toContain('1')
  })

  it('rejects a second outbound from a gate (maxOutbound: 1)', () => {
    const edges: Edge[] = [{ source: 'gate1', target: 'agent1' }]
    const result = canConnect('gate1', 'agent2', edges, kindResolver)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('gate')
  })

  it('rejects any outbound from an output node (maxOutbound: 0)', () => {
    const result = canConnect('output1', 'agent1', [], kindResolver)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('output')
  })

  it('allows many inbound to a parallel node (no maxInbound)', () => {
    const edges: Edge[] = [
      { source: 'agent1', target: 'parallel1' },
      { source: 'agent2', target: 'parallel1' },
    ]
    const result = canConnect('agent3', 'parallel1', edges, kindResolver)
    expect(result.ok).toBe(true)
  })

  it('applies agent-style rules by default to plugin kinds (second outbound rejected)', () => {
    const edges: Edge[] = [{ source: 'plugin1', target: 'agent1' }]
    const result = canConnect('plugin1', 'agent2', edges, kindResolver)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('fx.echo')
  })

  it('allows the first outbound from a plugin kind', () => {
    const result = canConnect('plugin1', 'agent1', [], kindResolver)
    expect(result.ok).toBe(true)
  })

  it('rejects self-loops', () => {
    const result = canConnect('agent1', 'agent1', [], kindResolver)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('itself')
  })

  it('is permissive when either endpoint kind is unknown', () => {
    // Pre-activation / legacy definitions shouldn't block the editor.
    const result = canConnect('ghost', 'agent1', [], () => undefined)
    expect(result.ok).toBe(true)
  })
})
