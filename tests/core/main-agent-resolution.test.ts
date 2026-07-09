/**
 * Neutral main-agent resolution (P2.6): the orchestrator is a
 * runtime-DECLARED fact — id 'main' convention, role 'orchestrator'
 * generalization, first-agent degraded fallback — never a baked constant.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure resolver suite; content-dir mocked to satisfy the isolation guard.
const testDir = join(tmpdir(), `bakin-test-main-resolution-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { selectRuntimeMainAgent, getRuntimeMainAgentId } from '../../packages/core/src/adapters/runtime/helpers'
import type { AgentRuntimeAdapter, RuntimeAgent } from '../../packages/core/src/adapters/runtime'

const agent = (id: string, role?: string): RuntimeAgent => ({ id, name: id, role, status: 'active' })

describe('selectRuntimeMainAgent', () => {
  it("prefers the declared id 'main'", () => {
    expect(selectRuntimeMainAgent([agent('pixel'), agent('main'), agent('boss', 'Orchestrator')])?.id).toBe('main')
  })

  it("resolves a NON-'main' orchestrator by declared role (case-insensitive)", () => {
    expect(selectRuntimeMainAgent([agent('pixel'), agent('atlas', 'Orchestrator')])?.id).toBe('atlas')
    expect(selectRuntimeMainAgent([agent('pixel'), agent('atlas', 'orchestrator')])?.id).toBe('atlas')
  })

  it('degrades to the first agent when nothing is declared', () => {
    expect(selectRuntimeMainAgent([agent('solo')])?.id).toBe('solo')
  })

  it('returns null for an empty roster', () => {
    expect(selectRuntimeMainAgent([])).toBeNull()
  })

  it('a persona claiming Orchestrator never outranks the declared main agent', () => {
    expect(selectRuntimeMainAgent([agent('impostor', 'Orchestrator'), agent('main')])?.id).toBe('main')
  })
})

describe('getRuntimeMainAgentId', () => {
  const runtimeWith = (agents: RuntimeAgent[]) =>
    ({ agents: { list: async () => agents } }) as unknown as AgentRuntimeAdapter

  it("resolves a non-'main' orchestrator id from the live roster", async () => {
    expect(await getRuntimeMainAgentId(runtimeWith([agent('atlas', 'orchestrator')]))).toBe('atlas')
  })

  it('uses the fallback only for an empty roster (degraded mode)', async () => {
    expect(await getRuntimeMainAgentId(runtimeWith([]))).toBe('main')
    expect(await getRuntimeMainAgentId(runtimeWith([]), 'nobody')).toBe('nobody')
  })
})
