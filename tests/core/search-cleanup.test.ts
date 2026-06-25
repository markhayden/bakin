import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { createSearchAdapterHarness } from '../helpers/search-adapter'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mock(() => ({
    search: {
      adapter: 'antfly',
      settings: {
        enabled: true,
        cleanupInterval: '24h',
      },
    },
  })),
}))

let searchHarness: ReturnType<typeof createSearchAdapterHarness>

mock.module('@/core/search-registry', () => ({
  getContentTypes: mock(),
}))

mock.module('@/core/app-services', () => ({
  getAppServices: () => ({
    search: searchHarness.adapter,
  }),
}))

import { runCleanup } from '@/core/search-cleanup'
import { getContentTypes } from '@/core/search-registry'

const mockGetContentTypes = getContentTypes as ReturnType<typeof mock>

describe('search-cleanup', () => {
  beforeEach(() => {
    mock.clearAllMocks()
    searchHarness = createSearchAdapterHarness()
    // Reset the running flag
    ;(globalThis as any).__bakinSearchCleanupRunning = false
  })

  it('removes orphaned documents', async () => {
    const verifyExists = mock()
      .mockResolvedValueOnce(true)  // key-1 exists
      .mockResolvedValueOnce(false) // key-2 orphan
      .mockResolvedValueOnce(true)  // key-3 exists

    mockGetContentTypes.mockReturnValue(
      new Map([
        ['bakin_tasks', {
          table: 'tasks',
          pluginId: 'tasks',
          verifyExists,
          reindex: async function* () {},
        }],
      ])
    )

    searchHarness.setScanItems('bakin_tasks', [
      { key: 'key-1', document: {} },
      { key: 'key-2', document: {} },
      { key: 'key-3', document: {} },
    ])

    const stats = await runCleanup()

    expect(stats).toHaveLength(1)
    expect(stats[0].table).toBe('bakin_tasks')
    expect(stats[0].scanned).toBe(3)
    expect(stats[0].orphans).toBe(1)
    expect(searchHarness.calls.documentsBatchRemove).toHaveBeenCalledWith('bakin_tasks', ['key-2'])
  })

  it('handles empty tables', async () => {
    mockGetContentTypes.mockReturnValue(
      new Map([
        ['bakin_empty', {
          table: 'empty',
          pluginId: 'empty',
          verifyExists: mock(),
          reindex: async function* () {},
        }],
      ])
    )

    searchHarness.setScanItems('bakin_empty', [])

    const stats = await runCleanup()

    expect(stats).toHaveLength(1)
    expect(stats[0].scanned).toBe(0)
    expect(stats[0].orphans).toBe(0)
    expect(searchHarness.calls.documentsBatchRemove).not.toHaveBeenCalled()
  })

  it('handles verifyExists errors gracefully', async () => {
    const verifyExists = mock()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('boom'))

    mockGetContentTypes.mockReturnValue(
      new Map([
        ['bakin_tasks', {
          table: 'tasks',
          pluginId: 'tasks',
          verifyExists,
          reindex: async function* () {},
        }],
      ])
    )

    searchHarness.setScanItems('bakin_tasks', [
      { key: 'key-1', document: {} },
      { key: 'key-2', document: {} },
    ])

    const stats = await runCleanup()

    expect(stats[0].errors).toBe(1)
    expect(stats[0].scanned).toBe(2)
  })

  it('skips if already running', async () => {
    ;(globalThis as any).__bakinSearchCleanupRunning = true
    mockGetContentTypes.mockReturnValue(new Map())

    const stats = await runCleanup()
    expect(stats).toEqual([])
  })

  it('handles multiple content types', async () => {
    mockGetContentTypes.mockReturnValue(
      new Map([
        ['bakin_tasks', {
          table: 'tasks',
          pluginId: 'tasks',
          verifyExists: mock().mockResolvedValue(true),
          reindex: async function* () {},
        }],
        ['bakin_assets', {
          table: 'assets',
          pluginId: 'assets',
          verifyExists: mock().mockResolvedValue(false),
          reindex: async function* () {},
        }],
      ])
    )

    searchHarness.setScanItems('bakin_tasks', [{ key: 'doc-1', document: {} }])
    searchHarness.setScanItems('bakin_assets', [{ key: 'doc-1', document: {} }])

    const stats = await runCleanup()

    expect(stats).toHaveLength(2)
    expect(stats[0].orphans).toBe(0) // tasks: all exist
    expect(stats[1].orphans).toBe(1) // assets: all orphans
  })
})
