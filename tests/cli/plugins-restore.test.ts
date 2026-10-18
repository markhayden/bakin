import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { dispatchCli } from '../../src/core/cli'
import { TEST_BOOT_ID, finishedOperation } from '../helpers/operation-fetch'

const mockFetch = mock()

describe('bakin plugins restore CLI dispatch', () => {
  const originalFetch = globalThis.fetch
  const originalLog = console.log

  beforeEach(() => {
    mock.clearAllMocks()
    globalThis.fetch = mockFetch as unknown as typeof fetch
    console.log = mock() as unknown as typeof console.log
    // A restore is an operation (#895): 202, then the finished view carries the old body.
    const restored = finishedOperation('op-restore', { httpStatus: 200, body: {
      ok: true,
      id: 'demo-plugin',
      snapshotInfo: { filename: 'demo-plugin-2026-05-04T00-00-00-000Z.tar.gz' },
      skills: { restored: 0, names: [] },
      activated: true,
      message: 'Restored "demo-plugin".',
    } })
    mockFetch.mockImplementation(async (input: string) => {
      const url = String(input)
      if (url.includes('/api/operations/op-restore')) return new Response(JSON.stringify({ bootId: TEST_BOOT_ID, operation: restored, children: [] }), { status: 200 })
      if (url.endsWith('/api/events')) return new Response('{}', { status: 503 })
      return new Response(JSON.stringify({ operationId: 'op-restore', bootId: TEST_BOOT_ID }), { status: 202 })
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
      `${process.env.BAKIN_URL}/api/plugins/restore`,
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
