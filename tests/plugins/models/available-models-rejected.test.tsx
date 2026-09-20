// @vitest-environment jsdom
/**
 * #852 — the Available Models tab renders account-rejected rows (the tab
 * had never seen available:false before the rejection overlay) with a
 * visible danger badge instead of hiding or crashing.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-models-rejected-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))

import { AvailableModelsTab } from '../../../plugins/models/components/available-models-tab'
import type { AvailableModel } from '../../../plugins/models/types'
import type { ModelsData } from '../../../plugins/models/components/use-models-data'

afterEach(() => cleanup())

const models: AvailableModel[] = [
  {
    id: 'openai-codex/gpt-5.4-mini', name: 'gpt-5.4-mini', tier: 'budget', provider: 'openai-codex',
    available: false, rejection: { lastSeenAt: Date.now() - 60_000, occurrences: 14 },
  },
  { id: 'openai-codex/gpt-5.6-luna', name: 'gpt-5.6-luna', tier: 'premium', provider: 'openai-codex', available: true },
]

function makeData(): ModelsData {
  return {
    availableProviders: ['openai-codex'],
    effectiveDefaultModel: 'openai-codex/gpt-5.6-luna',
    handleRefresh: () => {},
    modelOptions: models,
    modelsCached: false,
    modelsCachedAt: null,
    modelsError: null,
    modelsLoaded: true,
    modelsStale: false,
    refreshing: false,
    saving: null,
    setAsDefault: async () => {},
  } as unknown as ModelsData
}

function renderTab() {
  return render(
    <AvailableModelsTab
      m={makeData()}
      query=""
      providers={[]}
      pageValue=""
      showAllValue=""
      onQueryChange={() => {}}
      onProvidersChange={() => {}}
      onPageChange={() => {}}
      onShowAllChange={() => {}}
    />,
  )
}

describe('AvailableModelsTab — rejected rows (#852)', () => {
  it('shows a visible "Rejected by account" badge on the rejected row and keeps the row listed', () => {
    renderTab()
    // Flip, not filter: both rows render.
    expect(screen.getByText('gpt-5.4-mini')).toBeTruthy()
    expect(screen.getByText('gpt-5.6-luna')).toBeTruthy()
    const badge = screen.getByText('Rejected by account')
    expect(badge).toBeTruthy()
    // The badge carries the evidence as a plain-words tooltip.
    expect(badge.closest('[title]')?.getAttribute('title')).toContain('14')
  })

  it('healthy rows carry no rejected badge', () => {
    renderTab()
    expect(screen.getAllByText('Rejected by account')).toHaveLength(1)
  })
})
