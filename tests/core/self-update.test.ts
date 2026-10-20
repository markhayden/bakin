import { afterEach, describe, expect, it, mock } from 'bun:test'
import { createHash } from 'node:crypto'
import { readdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createBakinTarGz } from '../../src/core/release-archive'
import { fetchLatestRelease, getSelfUpdateStatus, selfUpdate } from '../../src/core/self-update'

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

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

  it('uses GitHub latest when a stable release exists, under a bounded signal (review r4 #4)', async () => {
    const logs: string[] = []
    const fetchMock = mock(() => Promise.resolve(response(200, release('v0.0.2'))))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const resolved = await fetchLatestRelease({ log: message => logs.push(message) })

    expect(resolved.tag_name).toBe('v0.0.2')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = (fetchMock.mock.calls[0] as unknown as [string, { signal?: AbortSignal }])[1]
    expect(init.signal).toBeInstanceOf(AbortSignal)
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

describe('selfUpdate', () => {
  it('downloads, verifies, extracts, and replaces from the release archive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-self-update-'))
    const execPath = join(dir, 'bakin')
    const newBinary = Buffer.from('#!/usr/bin/env bash\necho 0.2.0\n')
    const archive = createBakinTarGz(newBinary)
    const checksums = `${sha256(archive)}  bakin-linux-x64.tar.gz\n`
    const logs: string[] = []
    const errors: string[] = []

    writeFileSync(execPath, 'old-binary')

    try {
      const exitCode = await selfUpdate({
        log: (message) => logs.push(message),
        error: (message) => errors.push(message),
      }, {
        platform: 'linux',
        arch: 'x64',
        execPath,
        fetchRelease: async () => ({
          tag_name: 'v0.2.0',
          draft: false,
          prerelease: false,
          assets: [
            { name: 'bakin-linux-x64.tar.gz', browser_download_url: 'https://example.test/archive' },
            { name: 'checksums.txt', browser_download_url: 'https://example.test/checksums' },
          ],
        }),
        downloadTo: async (url, dest) => {
          if (url.endsWith('/archive')) {
            writeFileSync(dest, archive)
          } else if (url.endsWith('/checksums')) {
            writeFileSync(dest, checksums)
          } else {
            throw new Error(`unexpected url: ${url}`)
          }
        },
      })

      expect(exitCode).toBe(0)
      expect(readFileSync(execPath, 'utf-8')).toBe(newBinary.toString('utf-8'))
      expect(errors).toEqual([])
      expect(logs).toContain('Downloading bakin-linux-x64.tar.gz (v0.2.0)...')
      expect(logs).toContain('Updated to v0.2.0. Restart to run the new version.')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('selfUpdate staging + the pre-swap hook (#1007 D7.11)', () => {
  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-self-update-'))
    const execPath = join(dir, 'bakin')
    const newBinary = Buffer.from('#!/usr/bin/env bash\necho 0.2.0\n')
    const archive = createBakinTarGz(newBinary)
    const checksums = `${sha256(archive)}  bakin-linux-x64.tar.gz\n`
    writeFileSync(execPath, 'old-binary')
    const options = {
      platform: 'linux', arch: 'x64', execPath,
      fetchRelease: async () => ({ tag_name: 'v0.2.0', draft: false, prerelease: false, assets: [
        { name: 'bakin-linux-x64.tar.gz', browser_download_url: 'https://example.test/archive' },
        { name: 'checksums.txt', browser_download_url: 'https://example.test/checksums' },
      ] }),
      downloadTo: async (url: string, dest: string) => { writeFileSync(dest, url.endsWith('/archive') ? archive : checksums) },
    }
    return { dir, execPath, newBinary, options }
  }

  it('stages under <exec>.<suffix>.* so two attempts never share a path, and reports each stage in order', async () => {
    const { dir, execPath, newBinary, options } = fixture()
    const stages: string[] = []
    const seen: string[] = []
    try {
      const exitCode = await selfUpdate({ log: () => {}, error: () => {} }, {
        ...options,
        stagingSuffix: 'op-123.new',
        onStage: (stage) => stages.push(stage),
        beforeReplace: async ({ newPath }) => { seen.push(newPath); seen.push(...readdirSync(dir).sort()) },
      })
      expect(exitCode).toBe(0)
      expect(stages).toEqual(['download', 'verify', 'extract', 'replace'])
      expect(seen[0]).toBe(`${execPath}.op-123.new`)
      // While the hook ran, every staged file carried the suffix beside the untouched binary.
      expect(seen.slice(1)).toEqual(['bakin', 'bakin.op-123.new', 'bakin.op-123.new.bakin-linux-x64.tar.gz', 'bakin.op-123.new.checksums.txt'])
      expect(readFileSync(execPath, 'utf-8')).toBe(newBinary.toString('utf-8'))
      expect(readdirSync(dir)).toEqual(['bakin'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a throwing pre-swap hook aborts with the binary untouched and the staged files gone', async () => {
    const { dir, execPath, options } = fixture()
    const errors: string[] = []
    try {
      const exitCode = await selfUpdate({ log: () => {}, error: (m) => errors.push(m) }, {
        ...options,
        stagingSuffix: 'op-9.new',
        beforeReplace: async () => { throw new Error('the restart cannot be scheduled') },
      })
      expect(exitCode).toBe(1)
      expect(readFileSync(execPath, 'utf-8')).toBe('old-binary')
      expect(readdirSync(dir)).toEqual(['bakin'])
      expect(errors).toEqual(['Not replacing the binary: the restart cannot be scheduled'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('selfUpdate cancellation (review r4 #4)', () => {
  it('a cancel between the release fetch and the download stops before any transfer; the binary and the directory are untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-self-update-cancel-'))
    const execPath = join(dir, 'bakin')
    writeFileSync(execPath, 'old-binary')
    const controller = new AbortController()
    const downloads: string[] = []
    const errors: string[] = []
    try {
      const exitCode = await selfUpdate({ log: () => {}, error: (m) => errors.push(m) }, {
        platform: 'linux', arch: 'x64', execPath, signal: controller.signal,
        fetchRelease: async (_reporter, signal) => {
          expect(signal).toBe(controller.signal)
          controller.abort(new Error('cancelled'))
          return { tag_name: 'v0.2.0', draft: false, prerelease: false, assets: [
            { name: 'bakin-linux-x64.tar.gz', browser_download_url: 'https://example.test/archive' },
            { name: 'checksums.txt', browser_download_url: 'https://example.test/checksums' },
          ] }
        },
        downloadTo: async (url) => { downloads.push(url) },
      })
      expect(exitCode).toBe(1)
      expect(downloads).toEqual([])
      expect(errors).toEqual(['Update cancelled; the running binary was left untouched.'])
      expect(readFileSync(execPath, 'utf-8')).toBe('old-binary')
      expect(readdirSync(dir)).toEqual(['bakin'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the download receives the signal; a cancel the transfer honours cleans the staging files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-self-update-cancel-'))
    const execPath = join(dir, 'bakin')
    writeFileSync(execPath, 'old-binary')
    const controller = new AbortController()
    const errors: string[] = []
    try {
      const exitCode = await selfUpdate({ log: () => {}, error: (m) => errors.push(m) }, {
        platform: 'linux', arch: 'x64', execPath, signal: controller.signal,
        fetchRelease: async () => ({ tag_name: 'v0.2.0', draft: false, prerelease: false, assets: [
          { name: 'bakin-linux-x64.tar.gz', browser_download_url: 'https://example.test/archive' },
          { name: 'checksums.txt', browser_download_url: 'https://example.test/checksums' },
        ] }),
        downloadTo: async (_url, dest, { signal }) => {
          expect(signal).toBe(controller.signal)
          writeFileSync(dest, 'partial')
          controller.abort(new Error('cancelled'))
          throw signal!.reason
        },
      })
      expect(exitCode).toBe(1)
      expect(errors).toEqual(['Update cancelled; the running binary was left untouched.'])
      expect(readdirSync(dir)).toEqual(['bakin'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

describe('selfUpdate is bound to the approved release (#1007 review r1 #2)', () => {
  it('refuses a release that is not the one the operator approved — before any download', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-self-update-'))
    const execPath = join(dir, 'bakin')
    writeFileSync(execPath, 'old-binary')
    const downloads: string[] = []
    const errors: string[] = []
    const code = await selfUpdate({ log: () => {}, error: (m) => errors.push(m) }, {
      platform: 'linux', arch: 'x64', execPath, expectedVersion: '0.2.0',
      fetchRelease: async () => ({ tag_name: 'v0.3.0', draft: false, prerelease: false, assets: [
        { name: 'bakin-linux-x64.tar.gz', browser_download_url: 'https://example.test/archive' },
        { name: 'checksums.txt', browser_download_url: 'https://example.test/checksums' },
      ] }),
      downloadTo: async (url) => { downloads.push(url) },
    })
    expect(code).toBe(1)
    expect(errors).toEqual(['Release changed: v0.3.0 is now the latest, but this update was approved for v0.2.0. Check for updates and apply again.'])
    expect(downloads).toEqual([])
    expect(readFileSync(execPath, 'utf8')).toBe('old-binary')
    rmSync(dir, { recursive: true, force: true })
  })
})
