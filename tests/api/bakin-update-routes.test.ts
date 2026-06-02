import { describe, expect, it } from 'bun:test'
import * as statusRoute from '../../packages/host/src/api/update/status'
import * as applyRoute from '../../packages/host/src/api/update/apply'

function req(method: string, path: string): { req: Request; url: URL } {
  const url = new URL(`http://localhost:3737${path}`)
  return { req: new Request(url, { method }), url }
}

describe('bakin update routes', () => {
  it('reports self-update as unsupported in source/dev mode', async () => {
    const { req: request, url } = req('GET', '/api/update/status')
    const res = await statusRoute.get(request, url)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.supported).toBe(false)
    expect(body.updateAvailable).toBe(false)
    expect(body.reason).toBe('source/dev runtime')
  })

  it('refuses to apply self-update in source/dev mode', async () => {
    const { req: request, url } = req('POST', '/api/update/apply')
    const res = await applyRoute.post(request, url)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.supported).toBe(false)
    expect(body.error).toContain('source/dev runtime')
  })

  it('applies a supported self-update and schedules an automatic restart', async () => {
    const { req: request, url } = req('POST', '/api/update/apply')
    const res = await applyRoute.post(request, url, {
      getStatus: async () => ({
        ok: true,
        supported: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
        latestTag: 'v0.2.0',
        updateAvailable: true,
        checkedAt: '2026-06-01T12:00:00.000Z',
      }),
      runSelfUpdate: async (reporter) => {
        reporter?.log('Updated to v0.2.0')
        return 0
      },
      scheduleRestart: () => ({
        ok: true,
        strategy: 'standalone-child',
        restartDelayMs: 750,
        childPid: 12345,
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.message).toContain('Restarting Bakin now')
    expect(body.restart).toMatchObject({ ok: true, strategy: 'standalone-child' })
    expect(body.events).toContainEqual({ level: 'info', message: 'Updated to v0.2.0' })
  })
})
