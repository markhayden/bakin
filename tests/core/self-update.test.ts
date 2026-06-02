import { afterEach, describe, expect, it, mock } from 'bun:test'
import { fetchLatestRelease, getSelfUpdateStatus } from '../../src/core/self-update'

describe('fetchLatestRelease', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    mock.restore()
  })

  function response(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response
  }

  function release(tagName: string, options: { draft?: boolean; prerelease?: boolean } = {}) {
    return {
      tag_name: tagName,
      draft: options.draft ?? false,
      prerelease: options.prerelease ?? false,
      assets: [],
    }
  }

  it('uses GitHub latest when a stable release exists', async () => {
    const logs: string[] = []
    const fetchMock = mock(() => Promise.resolve(response(200, release('v0.0.2'))))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const resolved = await fetchLatestRelease({ log: message => logs.push(message) })

    expect(resolved.tag_name).toBe('v0.0.2')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logs).toEqual([
      'Fetching latest release from https://api.github.com/repos/markhayden/bakin/releases/latest',
    ])
  })

  it('falls back to the newest published prerelease when no stable release exists', async () => {
    const logs: string[] = []
    const fetchMock = mock()
      .mockResolvedValueOnce(response(404, { message: 'Not Found' }))
      .mockResolvedValueOnce(response(200, [
        release('v0.0.1-rc.2', { prerelease: true }),
        release('v0.0.1-rc.1', { prerelease: true }),
      ]))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const resolved = await fetchLatestRelease({ log: message => logs.push(message) })

    expect(resolved.tag_name).toBe('v0.0.1-rc.2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.github.com/repos/markhayden/bakin/releases?per_page=20')
    expect(logs).toContain('No stable release found; checking releases from https://api.github.com/repos/markhayden/bakin/releases?per_page=20')
  })

  it('preserves non-404 latest release failures', async () => {
    const fetchMock = mock(() => Promise.resolve(response(500, { message: 'Server Error' })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(fetchLatestRelease({ log: () => {} })).rejects.toThrow('HTTP 500')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('getSelfUpdateStatus', () => {
  function release(tagName: string) {
    return {
      tag_name: tagName,
      draft: false,
      prerelease: false,
      assets: [],
    }
  }

  it('reports update availability for compiled bakin binaries', async () => {
    const status = await getSelfUpdateStatus({
      currentVersion: '0.1.0',
      execPath: '/usr/local/bin/bakin',
      fetchRelease: async () => release('v0.2.0'),
      now: () => new Date('2026-06-01T12:00:00.000Z'),
    })

    expect(status.supported).toBe(true)
    expect(status.currentVersion).toBe('0.1.0')
    expect(status.latestVersion).toBe('0.2.0')
    expect(status.latestTag).toBe('v0.2.0')
    expect(status.updateAvailable).toBe(true)
    expect(status.checkedAt).toBe('2026-06-01T12:00:00.000Z')
  })

  it('does not offer self-update in dev/source mode', async () => {
    let fetched = false
    const status = await getSelfUpdateStatus({
      currentVersion: '0.0.0-dev',
      execPath: '/Users/roscoe/.bun/bin/bun',
      fetchRelease: async () => {
        fetched = true
        return release('v1.0.0')
      },
    })

    expect(status.supported).toBe(false)
    expect(status.updateAvailable).toBe(false)
    expect(status.reason).toBe('source/dev runtime')
    expect(fetched).toBe(false)
  })

  it('returns a non-throwing error status when release lookup fails', async () => {
    const status = await getSelfUpdateStatus({
      currentVersion: '0.1.0',
      execPath: '/usr/local/bin/bakin',
      fetchRelease: async () => {
        throw new Error('network unavailable')
      },
    })

    expect(status.supported).toBe(true)
    expect(status.updateAvailable).toBe(false)
    expect(status.error).toBe('network unavailable')
  })
})
