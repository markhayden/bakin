import { describe, expect, it } from 'bun:test'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import {
  getRuntimeMainAgentId,
  getRuntimeMainAgentName,
  selectRuntimeMainAgent,
  type RuntimeAgent,
} from '@bakin/core/adapters/runtime'

describe('runtime main agent helpers', () => {
  it('prefers the explicit main agent id', () => {
    const agents: RuntimeAgent[] = [
      { id: 'orchestrator', name: 'Orchestrator', role: 'Orchestrator' },
      { id: 'main', name: 'Main', role: 'Worker' },
    ]

    expect(selectRuntimeMainAgent(agents)?.id).toBe('main')
  })

  it('falls back to an orchestrator role, then the first agent', () => {
    expect(selectRuntimeMainAgent([
      { id: 'boss', name: 'Boss', role: 'Orchestrator' },
      { id: 'pixel', name: 'Pixel' },
    ])?.id).toBe('boss')

    expect(selectRuntimeMainAgent([{ id: 'pixel', name: 'Pixel' }])?.id).toBe('pixel')
    expect(selectRuntimeMainAgent([])).toBeNull()
  })

  it('resolves id and name through the runtime adapter with fallbacks', async () => {
    const runtime = createMockRuntimeAdapter()
    await runtime.agents.create({ id: 'boss', name: 'Boss', role: 'Orchestrator' })

    expect(await getRuntimeMainAgentId(runtime)).toBe('boss')
    expect(await getRuntimeMainAgentName(runtime)).toBe('Boss')

    const emptyRuntime = createMockRuntimeAdapter()
    expect(await getRuntimeMainAgentId(emptyRuntime)).toBe('main')
    expect(await getRuntimeMainAgentName(emptyRuntime)).toBe('Main')
  })
})
