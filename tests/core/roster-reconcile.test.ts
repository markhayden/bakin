/**
 * Roster-reconcile unit coverage the integration switch tests don't reach:
 * the honest failed[] report when target.agents.create throws, and the
 * "unique bare-model match only, never guess" mapping rule under ambiguity.
 */
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, it, expect, mock } from 'bun:test'

const testDir = join(tmpdir(), `bakin-test-roster-reconcile-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { CARRIED_SUBAGENT_MODEL_KEY, mapModelToCatalog, reconcileRoster } from '../../src/core/roster-reconcile'
import type { AgentRuntimeAdapter, RuntimeAgent } from '@bakin/core/adapters/runtime'

function targetWith(overrides: {
  existing?: string[]
  catalog?: string[]
  createImpl?: (input: { id: string; name?: string; model?: string; metadata?: Record<string, unknown> }) => Promise<unknown>
  updateImpl?: (agentId: string, input: { subagentModel?: string | null }) => Promise<unknown>
  perAgentSubagentModel?: boolean
}): AgentRuntimeAdapter {
  return {
    agents: {
      list: async () => (overrides.existing ?? []).map((id) => ({ id, name: id })),
      create: overrides.createImpl ?? (async (input: { id: string }) => ({ id: input.id, name: input.id })),
      update: overrides.updateImpl ?? (async (agentId: string) => ({ id: agentId, name: agentId })),
    },
    models: {
      listAvailable: async () => (overrides.catalog ?? []).map((id) => ({ id, name: id, available: true })),
      routingSupport: () => ({ perAgentSubagentModel: overrides.perAgentSubagentModel ?? true }),
    },
  } as unknown as AgentRuntimeAdapter
}

describe('mapModelToCatalog — never guess under ambiguity', () => {
  it('exact id wins', () => {
    expect(mapModelToCatalog('openai/gpt-5.5', ['openai/gpt-5.5', 'openai-codex/gpt-5.5'])).toBe('openai/gpt-5.5')
  })

  it('unique bare-model match maps across providers', () => {
    expect(mapModelToCatalog('openai/gpt-5.5', ['openai-codex/gpt-5.5', 'google/gemini-flash'])).toBe('openai-codex/gpt-5.5')
  })

  it('AMBIGUOUS bare-model match refuses to map', () => {
    expect(mapModelToCatalog('openai/gpt-5.5', ['openai-codex/gpt-5.5', 'azure/gpt-5.5'])).toBeNull()
  })

  it('no match refuses to map', () => {
    expect(mapModelToCatalog('openai/gpt-5.5', ['google/gemini-flash'])).toBeNull()
  })
})

describe('reconcileRoster — honest reporting', () => {
  const source: RuntimeAgent[] = [
    { id: 'main', name: 'Main', model: 'openai/gpt-5.5' },
    { id: 'pixel', name: 'Pixel', model: 'openai/gpt-image' },
  ]

  it('a create() throw lands in failed[], never thrown, never skipped silently', async () => {
    const target = targetWith({
      catalog: ['openai-codex/gpt-5.5'],
      createImpl: async (input) => {
        if (input.id === 'pixel') throw new Error('registry write denied')
        return { id: input.id, name: input.id }
      },
    })
    const report = await reconcileRoster(source, target)
    expect(report.carried.map((c) => c.agentId)).toEqual(['main'])
    expect(report.failed).toEqual([{ agentId: 'pixel', error: 'registry write denied' }])
  })

  it('an ambiguous model is REPORTED unmapped and the agent carries modelless', async () => {
    const created: Array<{ id: string; model?: string }> = []
    const target = targetWith({
      catalog: ['openai-codex/gpt-5.5', 'azure/gpt-5.5'],
      createImpl: async (input) => {
        created.push(input)
        return { id: input.id, name: input.id }
      },
    })
    const report = await reconcileRoster([source[0]], target)
    expect(report.unmappedModels).toEqual([{ agentId: 'main', sourceModel: 'openai/gpt-5.5', field: 'model' }])
    expect(created[0].model).toBeUndefined()
    expect(report.carried).toEqual([{ agentId: 'main' }])
  })
})

describe('reconcileRoster — subagentModel carry', () => {
  const withSubagent: RuntimeAgent[] = [
    { id: 'main', name: 'Main', model: 'openai/gpt-5.5', subagentModel: 'openai/gpt-5.5-mini' },
  ]

  it('maps the subagent model against the target catalog and applies it via agents.update', async () => {
    const updates: Array<{ agentId: string; subagentModel?: string | null }> = []
    const target = targetWith({
      catalog: ['openai-codex/gpt-5.5', 'openai-codex/gpt-5.5-mini'],
      updateImpl: async (agentId, input) => {
        updates.push({ agentId, ...input })
        return { id: agentId, name: agentId }
      },
    })
    const report = await reconcileRoster(withSubagent, target)
    expect(updates).toEqual([{ agentId: 'main', subagentModel: 'openai-codex/gpt-5.5-mini' }])
    expect(report.carried).toEqual([
      { agentId: 'main', model: 'openai-codex/gpt-5.5', mappedFrom: 'openai/gpt-5.5', subagentModel: 'openai-codex/gpt-5.5-mini' },
    ])
    expect(report.unmappedModels).toEqual([])
  })

  it('an unmappable subagent model is REPORTED, never guessed, never updated', async () => {
    const updates: string[] = []
    const target = targetWith({
      catalog: ['openai-codex/gpt-5.5'],
      updateImpl: async (agentId) => {
        updates.push(agentId)
        return { id: agentId, name: agentId }
      },
    })
    const report = await reconcileRoster(withSubagent, target)
    expect(updates).toEqual([])
    expect(report.unmappedModels).toEqual([
      { agentId: 'main', sourceModel: 'openai/gpt-5.5-mini', field: 'subagentModel' },
    ])
  })

  it('a runtime without per-agent subagent models PRESERVES the value in metadata, no update call', async () => {
    const updates: string[] = []
    const created: Array<{ id: string; metadata?: Record<string, unknown> }> = []
    const target = targetWith({
      catalog: ['openai-codex/gpt-5.5', 'openai-codex/gpt-5.5-mini'],
      perAgentSubagentModel: false,
      createImpl: async (input) => {
        created.push({ id: input.id, metadata: input.metadata })
        return { id: input.id, name: input.name }
      },
      updateImpl: async (agentId) => {
        updates.push(agentId)
        return { id: agentId, name: agentId }
      },
    })
    const report = await reconcileRoster(withSubagent, target)
    expect(updates).toEqual([])
    expect(report.unmappedModels).toEqual([])
    expect(report.preserved).toEqual([{ agentId: 'main', sourceModel: 'openai/gpt-5.5-mini' }])
    expect(created[0]?.metadata?.[CARRIED_SUBAGENT_MODEL_KEY]).toBe('openai/gpt-5.5-mini')
  })

  it('round trip: a stashed subagent model is RESTORED on an honoring target and the stash is not re-carried', async () => {
    const stashedSource: RuntimeAgent[] = [
      {
        id: 'main',
        name: 'Main',
        model: 'openai-codex/gpt-5.5',
        metadata: { [CARRIED_SUBAGENT_MODEL_KEY]: 'openai/gpt-5.5-mini', emoji: '🤖' },
      },
    ]
    const updates: Array<{ agentId: string; subagentModel?: string | null }> = []
    const created: Array<{ id: string; metadata?: Record<string, unknown> }> = []
    const target = targetWith({
      catalog: ['openai/gpt-5.5', 'openai/gpt-5.5-mini'],
      createImpl: async (input) => {
        created.push({ id: input.id, metadata: input.metadata })
        return { id: input.id, name: input.name }
      },
      updateImpl: async (agentId, input) => {
        updates.push({ agentId, ...input })
        return { id: agentId, name: agentId }
      },
    })
    const report = await reconcileRoster(stashedSource, target)
    expect(updates).toEqual([{ agentId: 'main', subagentModel: 'openai/gpt-5.5-mini' }])
    expect(report.preserved).toEqual([])
    // The stash key is reconciler-owned — consumed, never re-carried.
    expect(created[0]?.metadata?.[CARRIED_SUBAGENT_MODEL_KEY]).toBeUndefined()
    expect(created[0]?.metadata?.emoji).toBe('🤖')
  })

  it('dryRun classifies identically but never calls create or update', async () => {
    const created: string[] = []
    const updates: string[] = []
    const target = targetWith({
      existing: ['main'],
      catalog: ['openai-codex/gpt-5.5', 'openai-codex/gpt-5.5-mini'],
      createImpl: async (input) => {
        created.push(input.id)
        return { id: input.id, name: input.id }
      },
      updateImpl: async (agentId) => {
        updates.push(agentId)
        return { id: agentId, name: agentId }
      },
    })
    const source: RuntimeAgent[] = [
      { id: 'main', name: 'Main' },
      { id: 'pixel', name: 'Pixel', model: 'openai/gpt-5.5', subagentModel: 'openai/gpt-5.5-mini' },
      { id: 'rolo', name: 'Rolo', model: 'anthropic/claude-nope' },
    ]
    const report = await reconcileRoster(source, target, { dryRun: true })
    expect(created).toEqual([])
    expect(updates).toEqual([])
    expect(report.existing).toEqual(['main'])
    expect(report.carried).toEqual([
      { agentId: 'pixel', model: 'openai-codex/gpt-5.5', mappedFrom: 'openai/gpt-5.5', subagentModel: 'openai-codex/gpt-5.5-mini' },
      { agentId: 'rolo' },
    ])
    expect(report.unmappedModels).toEqual([
      { agentId: 'rolo', sourceModel: 'anthropic/claude-nope', field: 'model' },
    ])
    expect(report.failed).toEqual([])
  })

  it('a subagentModel update throw lands in failed[] while the agent stays carried', async () => {
    const target = targetWith({
      catalog: ['openai-codex/gpt-5.5', 'openai-codex/gpt-5.5-mini'],
      updateImpl: async () => {
        throw new Error('update denied')
      },
    })
    const report = await reconcileRoster(withSubagent, target)
    expect(report.carried.map((c) => c.agentId)).toEqual(['main'])
    expect(report.failed).toEqual([
      { agentId: 'main', error: 'subagentModel update: update denied' },
    ])
  })
})
