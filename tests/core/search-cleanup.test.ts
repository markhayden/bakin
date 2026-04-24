import { describe, it, expect, beforeEach, mock } from 'bun:test'

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@/core/settings', () => ({
  getSettings: mock(() => ({
    antfly: {
      enabled: true,
      cleanupInterval: '24h',
    },
  })),
}))

mock.module('@/core/antfly', () => ({
  enabled: mock(() => true),
  scanTable: mock(),
  batchRemove: mock(async () => 0),
}))

mock.module('@/core/search-registry', () => ({
  getContentTypes: mock(),
}))

import { runCleanup } from '@/core/search-cleanup'
import * as antflyMod from '@/core/antfly'
import { getContentTypes } from '@/core/search-registry'

const mockScanTable = antflyMod.scanTable as ReturnType<typeof mock>
const mockBatchRemove = antflyMod.batchRemove as ReturnType<typeof mock>
const mockGetContentTypes = getContentTypes as ReturnType<typeof mock>

describe('search-cleanup', () => {
  beforeEach(() => {
    mock.clearAllMocks()
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

    mockScanTable.mockImplementation(async function* () {
      yield { key: 'key-1', doc: {} }
      yield { key: 'key-2', doc: {} }
      yield { key: 'key-3', doc: {} }
    })

    const stats = await runCleanup()

    expect(stats).toHaveLength(1)
    expect(stats[0].table).toBe('bakin_tasks')
    expect(stats[0].scanned).toBe(3)
    expect(stats[0].orphans).toBe(1)
    expect(mockBatchRemove).toHaveBeenCalledWith('bakin_tasks', ['key-2'])
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

    mockScanTable.mockImplementation(async function* () {})

    const stats = await runCleanup()

    expect(stats).toHaveLength(1)
    expect(stats[0].scanned).toBe(0)
    expect(stats[0].orphans).toBe(0)
    expect(mockBatchRemove).not.toHaveBeenCalled()
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

    mockScanTable.mockImplementation(async function* () {
      yield { key: 'key-1', doc: {} }
      yield { key: 'key-2', doc: {} }
    })

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

    mockScanTable.mockImplementation(async function* () {
      yield { key: 'doc-1', doc: {} }
    })

    const stats = await runCleanup()

    expect(stats).toHaveLength(2)
    expect(stats[0].orphans).toBe(0) // tasks: all exist
    expect(stats[1].orphans).toBe(1) // assets: all orphans
  })
})
