import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { dispatchCli } from '../../src/core/cli'

const mockFetch = mock()

describe('bakin plugins restore CLI dispatch', () => {
  const originalFetch = globalThis.fetch
  const originalLog = console.log

  beforeEach(() => {
    mock.clearAllMocks()
    globalThis.fetch = mockFetch as unknown as typeof fetch
    console.log = mock() as unknown as typeof console.log
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        id: 'demo-plugin',
        snapshotInfo: { filename: 'demo-plugin-2026-05-04T00-00-00-000Z.tar.gz' },
        skills: { restored: 0, names: [] },
        activated: true,
        message: 'Restored "demo-plugin".',
      }),
      text: () => Promise.resolve(''),
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    console.log = originalLog
  })

  it('posts restore options to /api/plugins/restore', async () => {
    const result = await dispatchCli([
      'bun',
      'bakin',
      'plugins',
      'restore',
      'demo-plugin',
      '--snapshot',
      'demo-plugin-2026-05-04T00-00-00-000Z.tar.gz',
      '--force',
    ])

    expect(result).toEqual({ startServer: false, exitCode: 0 })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3737/api/plugins/restore',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          pluginId: 'demo-plugin',
          snapshot: 'demo-plugin-2026-05-04T00-00-00-000Z.tar.gz',
          force: true,
          listOnly: false,
        }),
      }),
    )
  })
})
