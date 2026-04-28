import { beforeEach, describe, expect, it, mock } from 'bun:test'

const getEntry = mock(async (...args: [string, string]): Promise<{ content: string } | null> => {
  void args
  return null
})
const services = {
  runtime: {
    memory: {
      getEntry,
    },
  },
}

mock.module('@/core/app-services', () => ({
  getAppServices: () => services,
}))

mock.module('../../src/core/app-services', () => ({
  getAppServices: () => services,
}))

import { get } from '../../packages/host/src/api/plugins/memory/gateway'

describe('memory gateway route', () => {
  beforeEach(() => {
    getEntry.mockReset()
  })

  it('reads gateway logs through runtime memory', async () => {
    getEntry.mockResolvedValueOnce({
      content: [
        '2026-04-27T10:00:00.000Z info gateway {"id":1} first line',
        '2026-04-27T10:01:00.000Z error gateway {"id":2} second line',
      ].join('\n'),
    })

    const url = new URL('http://localhost/api/plugins/memory/gateway?date=2026-04-27&offset=0&limit=1')
    const res = await get(new Request(url), url)
    const body = await res.json() as { entries: Array<{ id: string; level: string; message: string }>; total: number; hasMore: boolean }

    expect(getEntry).toHaveBeenCalledWith('runtime-gateway-log', '2026-04-27')
    expect(body.total).toBe(2)
    expect(body.hasMore).toBe(true)
    expect(body.entries).toEqual([expect.objectContaining({
      id: '2026-04-27-1',
      level: 'error',
      message: 'second line',
    })])
  })

  it('returns an empty page when the runtime has no log entry', async () => {
    getEntry.mockResolvedValueOnce(null)

    const url = new URL('http://localhost/api/plugins/memory/gateway?date=2026-04-27')
    const res = await get(new Request(url), url)
    const body = await res.json()

    expect(body).toEqual({ entries: [], total: 0, hasMore: false })
  })
})
