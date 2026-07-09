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

import { mapModelToCatalog, reconcileRoster } from '../../src/core/roster-reconcile'
import type { AgentRuntimeAdapter, RuntimeAgent } from '@bakin/core/adapters/runtime'

function targetWith(overrides: {
  existing?: string[]
  catalog?: string[]
  createImpl?: (input: { id: string; model?: string }) => Promise<unknown>
}): AgentRuntimeAdapter {
  return {
    agents: {
      list: async () => (overrides.existing ?? []).map((id) => ({ id, name: id })),
      create: overrides.createImpl ?? (async (input: { id: string }) => ({ id: input.id, name: input.id })),
    },
    models: {
      listAvailable: async () => (overrides.catalog ?? []).map((id) => ({ id, name: id, available: true })),
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
    expect(report.unmappedModels).toEqual([{ agentId: 'main', sourceModel: 'openai/gpt-5.5' }])
    expect(created[0].model).toBeUndefined()
    expect(report.carried).toEqual([{ agentId: 'main' }])
  })
})
