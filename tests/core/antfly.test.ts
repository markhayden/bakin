import { describe, it, expect, vi } from 'vitest'

// Mock settings with antfly disabled
vi.mock('@/core/settings', () => ({
  getSettings: vi.fn(() => ({
    antfly: {
      enabled: false,
      url: 'http://localhost:8080',
    },
  })),
}))

describe('antfly', () => {
  it('should export expected functions', async () => {
    const antfly = await import('@/core/antfly')
    expect(typeof antfly.enabled).toBe('function')
    expect(typeof antfly.initialize).toBe('function')
    expect(typeof antfly.index).toBe('function')
    expect(typeof antfly.remove).toBe('function')
    expect(typeof antfly.search).toBe('function')
    expect(typeof antfly.syncFile).toBe('function')
    expect(typeof antfly.indexCompletedTask).toBe('function')
    expect(typeof antfly.indexAuditEvent).toBe('function')
  })

  it('should report disabled when settings say so', async () => {
    const antfly = await import('@/core/antfly')
    expect(antfly.enabled()).toBe(false)
  })

  it('search should return empty array when disabled', async () => {
    const antfly = await import('@/core/antfly')
    const results = await antfly.search('test query')
    expect(results).toEqual([])
  })

  it('index should no-op when disabled', async () => {
    const antfly = await import('@/core/antfly')
    // Should not throw
    await antfly.index('tasks', { id: 'test', content: 'test content' })
  })

  it('syncFile should no-op when disabled', async () => {
    const antfly = await import('@/core/antfly')
    // Should not throw
    await antfly.syncFile('docs/test.md', 'some content')
  })

  it('should define correct table names', async () => {
    const antfly = await import('@/core/antfly')
    expect(antfly.TABLES.tasks).toBe('beacon_tasks')
    expect(antfly.TABLES.decisions).toBe('beacon_decisions')
    expect(antfly.TABLES.audit).toBe('beacon_audit')
    expect(antfly.TABLES.content).toBe('beacon_content')
    expect(antfly.TABLES.assets).toBe('beacon_assets')
  })
})
