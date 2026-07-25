/**
 * Tests for the Antfly direct-download installer.
 *
 * Strategy — high fidelity, no child_process mocking:
 *   - ANTFLY_HOME points at a temp dir, so binary discovery, the managed
 *     install path, and tmp dirs all live under the test sandbox
 *   - The "binary" is a shell script that answers `--version`, so the real
 *     spawn + version-parse pipeline runs
 *   - The release tarball is a real tar.gz built in beforeAll; its SHA256 is
 *     computed and injected via the pin parameter
 *   - Only `fetch` is mocked (download + readyz probes) — no network
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { execSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-antfly-installer-${Date.now()}`)
const antflyHomeDir = join(testDir, 'antfly-home')
const managedBinary = join(antflyHomeDir, 'bin', 'antfly')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import {
  checkAntflyDependency,
  installAntflyDependency,
} from '../../../packages/adapter-antfly/src/installer'
import { antflyPlatformKey, type AntflyPin } from '../../../packages/adapter-antfly/src/pin'

const PIN_VERSION = '0.2.0-rc.9'
const platformKey = antflyPlatformKey()
if (!platformKey) throw new Error('tests must run on a supported platform')

const versionScript = (version: string) => `#!/bin/sh\necho "antfly ${version} (zig)"\n`

let tarballBytes: Uint8Array
let tarballChecksum: string

function makePin(overrides: Partial<AntflyPin> = {}): AntflyPin {
  return {
    version: PIN_VERSION,
    baseUrl: 'https://releases.antfly.io/antfly',
    checksums: {
      'darwin-arm64': tarballChecksum,
      'linux-x64': tarballChecksum,
      'linux-arm64': tarballChecksum,
    },
    ...overrides,
  }
}

function writeBinary(path: string, version: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, versionScript(version), { mode: 0o755 })
}

const realFetch = globalThis.fetch
let fetchCalls: string[] = []

function mockDownloadFetch(handler?: (url: string) => Response | Promise<Response>): void {
  ;(globalThis as { fetch: typeof fetch }).fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    fetchCalls.push(url)
    if (handler) return handler(url)
    if (url.endsWith('.tar.gz')) {
      return new Response(tarballBytes.slice().buffer as ArrayBuffer, { status: 200 })
    }
    throw new Error(`connection refused: ${url}`)
  }) as unknown as typeof fetch
}

const optsAutoYes = {
  interactive: false,
  autoApprove: true,
  json: false,
  checkOnly: false,
  force: false,
  askYesNo: () => Promise.resolve(true),
}

beforeAll(() => {
  // Build the real release layout: binary + share/ at the archive root
  // (verified against the live v0.2.0-rc.2 artifact).
  const srcDir = join(testDir, 'tarball-src')
  mkdirSync(join(srcDir, 'share', 'antfly', 'antfarm'), { recursive: true })
  writeFileSync(join(srcDir, 'antfly'), versionScript(PIN_VERSION), { mode: 0o755 })
  writeFileSync(join(srcDir, 'share', 'antfly', 'antfarm', 'index.html'), '<html></html>')
  writeFileSync(join(srcDir, 'LICENSE'), 'ELv2')
  const tarballPath = join(testDir, 'antfly-release.tar.gz')
  execSync(`tar -czf ${JSON.stringify(tarballPath)} -C ${JSON.stringify(srcDir)} .`)
  tarballBytes = new Uint8Array(readFileSync(tarballPath))
  tarballChecksum = createHash('sha256').update(tarballBytes).digest('hex')
})

beforeEach(() => {
  rmSync(antflyHomeDir, { recursive: true, force: true })
  mkdirSync(antflyHomeDir, { recursive: true })
  process.env.ANTFLY_HOME = antflyHomeDir
  delete process.env.ANTFLY_PATH
  fetchCalls = []
  mockDownloadFetch()
})

afterEach(() => {
  ;(globalThis as { fetch: typeof fetch }).fetch = realFetch
  delete process.env.ANTFLY_HOME
  delete process.env.ANTFLY_PATH
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('checkAntflyDependency', () => {
  it('reports missing when no binary exists', async () => {
    const result = await checkAntflyDependency(makePin())
    expect(result.status).toBe('missing')
    expect(result.remediation).toContain('bakin install search')
  })

  it('reports ok for a pinned-version binary', async () => {
    writeBinary(managedBinary, PIN_VERSION)
    const result = await checkAntflyDependency(makePin())
    expect(result.status).toBe('ok')
    expect(result.message).toContain(PIN_VERSION)
    expect(result.details?.binary).toBe(managedBinary)
    expect(result.details?.version).toBe(PIN_VERSION)
  })

  it('reports error with remediation for a wrong-version binary', async () => {
    writeBinary(managedBinary, '0.1.1')
    const result = await checkAntflyDependency(makePin())
    expect(result.status).toBe('error')
    expect(result.message).toContain('v0.1.1')
    expect(result.message).toContain(`needs v${PIN_VERSION}`)
    expect(result.remediation).toContain('bakin install search')
  })
})

describe('installAntflyDependency', () => {
  it('downloads, verifies checksum, extracts, and installs the pinned binary', async () => {
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin())

    expect(result.status).toBe('installed')
    expect(result.message).toContain(`v${PIN_VERSION}`)
    expect(result.message).toContain('checksum verified')
    expect(existsSync(managedBinary)).toBe(true)

    // Exact artifact URL — guards against silent drift in the upstream
    // uname-style naming (antfly_<ver>_<OS>_<Arch>.tar.gz under v<ver>/).
    const archToken = { 'darwin-arm64': 'Darwin_arm64', 'linux-x64': 'Linux_x86_64', 'linux-arm64': 'Linux_arm64' }[platformKey]
    expect(fetchCalls).toContain(
      `https://releases.antfly.io/antfly/v${PIN_VERSION}/antfly_${PIN_VERSION}_${archToken}.tar.gz`,
    )

    // share/ (antfarm dashboard assets) installs alongside bin/ — the server
    // resolves it relative to the binary.
    expect(existsSync(join(antflyHomeDir, 'share', 'antfly', 'antfarm', 'index.html'))).toBe(true)

    // Verification runs the real installed artifact.
    const check = await checkAntflyDependency(makePin())
    expect(check.status).toBe('ok')
  })

  it('is a noop when the pinned version is already installed — but still ensures the service is up (#717)', async () => {
    writeBinary(managedBinary, PIN_VERSION)
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin())
    expect(result.status).toBe('noop')
    // The noop path now provisions + probes readyz (and starts the managed
    // service when dark): a current binary with a dead service was the
    // field failure #717 fixes. No tarball download happens.
    expect(fetchCalls.length).toBeGreaterThan(0)
    expect(fetchCalls.every((u) => u.endsWith('/readyz'))).toBe(true)
  })

  it('replaces a wrong-version binary after the running-server guard passes', async () => {
    writeBinary(managedBinary, '0.1.1')
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin())

    expect(result.status).toBe('installed')
    const check = await checkAntflyDependency(makePin())
    expect(check.status).toBe('ok')
    // The guard probed readyz before downloading.
    expect(fetchCalls.some(u => u.endsWith('/readyz'))).toBe(true)
  })

  it('never swaps under a live NON-managed server (D3: managed services are stopped instead)', async () => {
    // child mode: stopService is a no-op (no launchctl/systemctl exec from
    // tests), so the still-responding instance reads as non-managed and the
    // installer must refuse rather than swap underneath it.
    process.env.BAKIN_SEARCH_SERVICE_MODE = 'child'
    try {
      writeBinary(managedBinary, '0.1.1')
      mockDownloadFetch(async (url) => {
        if (url.endsWith('/readyz')) return new Response('ok', { status: 200 })
        return new Response(tarballBytes.slice().buffer as ArrayBuffer, { status: 200 })
      })

      const result = await installAntflyDependency(optsAutoYes, undefined, makePin())
      expect(result.status).toBe('failed')
      expect(result.message).toContain('Stop it manually')
      // Old binary untouched.
      expect(readFileSync(managedBinary, 'utf-8')).toContain('0.1.1')
    } finally {
      delete process.env.BAKIN_SEARCH_SERVICE_MODE
    }
  })

  it('fails on checksum mismatch and writes no binary', async () => {
    const badPin = makePin({
      checksums: {
        'darwin-arm64': 'deadbeef'.repeat(8),
        'linux-x64': 'deadbeef'.repeat(8),
        'linux-arm64': 'deadbeef'.repeat(8),
      },
    })

    const result = await installAntflyDependency(optsAutoYes, undefined, badPin)
    expect(result.status).toBe('failed')
    expect(result.message).toContain('Checksum mismatch')
    expect(result.message).toContain('Refusing to install')
    expect(existsSync(managedBinary)).toBe(false)
  })

  it('fails cleanly when the download responds non-200', async () => {
    mockDownloadFetch(async (url) => {
      if (url.endsWith('.tar.gz')) return new Response('gone', { status: 404 })
      throw new Error(`connection refused: ${url}`)
    })

    const result = await installAntflyDependency(optsAutoYes, undefined, makePin())
    expect(result.status).toBe('failed')
    expect(result.message).toContain('404')
    expect(existsSync(managedBinary)).toBe(false)
  })

  it('skips when the user declines the prompt', async () => {
    const opts = {
      ...optsAutoYes,
      interactive: true,
      autoApprove: false,
      askYesNo: () => Promise.resolve(false),
    }
    const result = await installAntflyDependency(opts, undefined, makePin())
    expect(result.status).toBe('skipped')
    expect(fetchCalls).toHaveLength(0)
  })

  it('skips in non-interactive mode without --yes', async () => {
    const opts = { ...optsAutoYes, autoApprove: false }
    const result = await installAntflyDependency(opts, undefined, makePin())
    expect(result.status).toBe('skipped')
    expect(result.message).toContain('Non-interactive')
    expect(fetchCalls).toHaveLength(0)
  })

  it('fails when ANTFLY_PATH overrides discovery with a wrong-version binary', async () => {
    const overrideBinary = join(testDir, 'custom-antfly')
    writeBinary(overrideBinary, '0.1.1')
    process.env.ANTFLY_PATH = overrideBinary

    const result = await installAntflyDependency(optsAutoYes, undefined, makePin())
    expect(result.status).toBe('failed')
    expect(result.message).toContain('ANTFLY_PATH')
    expect(fetchCalls).toHaveLength(0)
  })
})

describe('antflyPlatformKey', () => {
  it('maps supported platforms and rejects darwin-x64', () => {
    expect(antflyPlatformKey('darwin', 'arm64')).toBe('darwin-arm64')
    expect(antflyPlatformKey('linux', 'x64')).toBe('linux-x64')
    expect(antflyPlatformKey('linux', 'arm64')).toBe('linux-arm64')
    expect(antflyPlatformKey('darwin', 'x64')).toBeNull()
    expect(antflyPlatformKey('win32', 'x64')).toBeNull()
  })
})
