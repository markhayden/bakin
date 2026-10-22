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
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-antfly-installer-${Date.now()}`)
const antflyHomeDir = join(testDir, 'antfly-home')
const managedBinary = join(antflyHomeDir, 'bin', 'antfly')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly'), 'assets.store': join(testDir, 'assets', 'store') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly'), 'assets.store': join(testDir, 'assets', 'store') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { ENGINE_RESET_STAGES } from '@bakin/core/adapters/search'
import { createMemoryResourceAcquirer, createOperationRegistry, type OperationView } from '@bakin/core/operations'
import {
  ANTFLY_ENGINE_PLAN,
  checkAntflyDependency as checkDependency,
  installAntflyDependency as installDependency,
} from '../../../packages/adapter-antfly/src/installer'
import { noopOp, withOperationView } from '../../helpers/operation-harness'
import { waitUntil } from '../../helpers/wait'
import { DEFAULT_SETTINGS } from '../../../packages/adapter-antfly/src/defaults'
import { launchdPlistPath, renderLaunchdPlist, buildServiceArgv, servicePaths, type ServiceIo } from '../../../packages/adapter-antfly/src/service'
import { antflyPlatformKey, type AntflyPin } from '../../../packages/adapter-antfly/src/pin'

let loaded = false
let occupied = false
/** When set, the supervisor refuses to start the unit (a launchctl bootstrap failure). */
let bootstrapFails: string | null = null
const commands: string[][] = []
const serviceIo: ServiceIo = {
  platform: 'darwin', env: { HOME: join(testDir, 'os-home') },
  hasCommand: () => true, modelReady: () => false, tempRoots: [],
  portsReleased: async () => !occupied,
  exec: async (cmd, args) => {
    commands.push([cmd, ...args])
    if (args[0] === 'print') return { code: loaded ? 0 : 113, stdout: '', stderr: '' }
    if (args[0] === 'bootout') loaded = false
    if (args[0] === 'bootstrap' && bootstrapFails) return { code: 5, stdout: '', stderr: bootstrapFails }
    if (args[0] === 'bootstrap') loaded = true
    return { code: 0, stdout: '', stderr: '' }
  },
}
type InstallArgs = Parameters<typeof installDependency>
/** The engine install the way production runs it: inside an operation holding search-engine. */
let lastView: OperationView | undefined
const installAntflyDependency = async (opts: Omit<InstallArgs[0], 'op'>, logger?: InstallArgs[1], pin?: InstallArgs[2], timings?: InstallArgs[3], settings?: InstallArgs[4]) => {
  const { value, view } = await withOperationView({ plan: ANTFLY_ENGINE_PLAN, resources: ['search-engine'] }, (op) =>
    installDependency({ ...opts, op }, logger, pin, { readyBudgetMs: 100, pollMs: 1, ...timings, io: serviceIo }, settings))
  lastView = view
  return value
}
const checkAntflyDependency = (pin: AntflyPin) => checkDependency(pin, DEFAULT_SETTINGS, serviceIo)
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testDir, 'openclaw'), getOpenClawPath: (...p: string[]) => join(testDir, 'openclaw', ...p), resetOpenClawHome: () => {} }))
mock.module('../../../packages/core/src/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

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
    if (url.endsWith('/readyz')) return new Response('ok')
    throw new Error(`unexpected URL: ${url}`)
  }) as unknown as typeof fetch
}

const optsAutoYes = { autoApprove: true }

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
  loaded = false
  occupied = false
  commands.length = 0
  serviceIo.tempRoots = []
  rmSync(join(testDir, 'os-home'), { recursive: true, force: true })
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

  it('reports ok for a pinned-version binary with an owned unit', async () => {
    writeBinary(managedBinary, PIN_VERSION)
    mkdirSync(join(launchdPlistPath(serviceIo), '..'), { recursive: true })
    writeFileSync(launchdPlistPath(serviceIo), renderLaunchdPlist(buildServiceArgv(DEFAULT_SETTINGS, servicePaths(), { modelReady: () => false }), servicePaths().logFile))
    const result = await checkAntflyDependency(makePin())
    expect(result.status).toBe('ok')
    expect(result.message).toContain(PIN_VERSION)
    expect(result.details?.binary).toBe(managedBinary)
    expect(result.details?.version).toBe(PIN_VERSION)
  })

  it('reports broken with remediation for a wrong-version binary', async () => {
    writeBinary(managedBinary, '0.1.1')
    const result = await checkAntflyDependency(makePin())
    expect(result.status).toBe('broken')
    expect(result.message).toContain('v0.1.1')
    expect(result.message).toContain(`needs v${PIN_VERSION}`)
    expect(result.remediation).toContain('bakin install search')
  })
})

describe('checkAntflyDependency identity + cancellation (#1007 D7.9)', () => {
  it('an applicable result carries the required pin and an installed identity that changes when the binary changes', async () => {
    writeBinary(managedBinary, PIN_VERSION)
    mkdirSync(join(launchdPlistPath(serviceIo), '..'), { recursive: true })
    writeFileSync(launchdPlistPath(serviceIo), renderLaunchdPlist(buildServiceArgv(DEFAULT_SETTINGS, servicePaths(), { modelReady: () => false }), servicePaths().logFile))
    const first = await checkAntflyDependency(makePin())
    expect(first.applicable).toBe(true)
    expect(first.required).toEqual({ version: PIN_VERSION })
    expect(first.installed?.version).toBe(PIN_VERSION)
    expect(first.installed?.identity).toMatch(/^[0-9a-f]{24}$/)
    expect(first.models).toBeUndefined()
    // Same bytes, same stat → same identity.
    expect((await checkAntflyDependency(makePin())).installed?.identity).toBe(first.installed!.identity)
    // A different binary (size changes) → a different identity, even at the same version.
    writeFileSync(managedBinary, `${versionScript(PIN_VERSION)}# rebuilt\n`, { mode: 0o755 })
    expect((await checkAntflyDependency(makePin())).installed?.identity).not.toBe(first.installed!.identity)
  })

  it('a missing binary is applicable with the requirement and no installed identity; a wrong version keeps both', async () => {
    const missing = await checkAntflyDependency(makePin())
    expect(missing.applicable).toBe(true)
    expect(missing.required).toEqual({ version: PIN_VERSION })
    expect(missing.installed).toBeUndefined()
    writeBinary(managedBinary, '0.1.1')
    const broken = await checkAntflyDependency(makePin())
    expect(broken.status).toBe('broken')
    expect(broken.installed?.version).toBe('0.1.1')
    expect(broken.required).toEqual({ version: PIN_VERSION })
  })

  it('a guest endpoint is not applicable — nothing here to install or update', async () => {
    const result = await checkDependency(makePin(), { ...DEFAULT_SETTINGS, url: 'http://10.0.0.9:3738' }, serviceIo)
    expect(result.status).toBe('ok')
    expect(result.applicable).toBe(false)
    expect(result.required).toBeUndefined()
    expect(result.installed).toBeUndefined()
  })

  it('a hung binary is killed and reaped under the signal — the check REJECTS as interrupted within the deadline (never a version verdict) and no child survives', async () => {
    const pidFile = join(testDir, 'hung.pid')
    mkdirSync(join(managedBinary, '..'), { recursive: true })
    writeFileSync(managedBinary, `#!/bin/sh\necho $$ > ${JSON.stringify(pidFile)}\nexec sleep 30\n`, { mode: 0o755 })
    // A probe that did not finish did not answer: the engine records a failed
    // attempt and keeps its last good observation (#1007 review r1 #5). The
    // signal fires once the child is provably running (its pid file exists), so
    // a loaded machine cannot abort before the shell even started.
    const controller = new AbortController()
    const probe = checkDependency(makePin(), DEFAULT_SETTINGS, serviceIo, { signal: controller.signal })
    await waitUntil(() => existsSync(pidFile), { label: 'the hung child wrote its pid' })
    const startedAt = Date.now()
    controller.abort(new Error('check timed out after 20s'))
    await expect(probe).rejects.toMatchObject({ name: 'CommandInterruptedError', reason: 'abort' })
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    expect(pid).toBeGreaterThan(0)
    await waitUntil(() => { try { process.kill(pid, 0); return false } catch { return true } }, { label: 'the hung child is gone' })
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
    // Dark on the first probe (triggers the start), answering afterwards —
    // the #859 readiness gate only reports noop once the engine is LIVE.
    let readyzCalls = 0
    mockDownloadFetch(async (url) => {
      if (url.endsWith('/readyz')) {
        readyzCalls += 1
        if (readyzCalls === 1) throw new Error('connection refused')
        return new Response('ok', { status: 200 })
      }
      throw new Error(`unexpected download: ${url}`)
    })
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin(), { readyBudgetMs: 2_000, pollMs: 50 })
    expect(result.status).toBe('noop')
    // The noop path provisions + probes readyz (and starts the managed
    // service when dark): a current binary with a dead service was the
    // field failure #717 fixes. No tarball download happens.
    expect(readyzCalls).toBeGreaterThanOrEqual(2)
    expect(fetchCalls.every((u) => u.endsWith('/readyz'))).toBe(true)
  })

  it('replaces a wrong-version binary after the running-server guard passes', async () => {
    writeBinary(managedBinary, '0.1.1')
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin())

    expect(result.status).toBe('installed')
    const check = await checkAntflyDependency(makePin())
    expect(check.status).toBe('ok')
    // Readiness is checked after the verified binary is installed.
    expect(fetchCalls.some(u => u.endsWith('/readyz'))).toBe(true)
  })

  it('never swaps under a live NON-managed server (D3: managed services are stopped instead)', async () => {
    // Even an unready listener is detected by the port-release boundary.
    occupied = true
    process.env.BAKIN_SEARCH_SERVICE_MODE = 'child'
    try {
      writeBinary(managedBinary, '0.1.1')
      mockDownloadFetch(async (url) => {
        if (url.endsWith('/readyz')) return new Response('ok', { status: 200 })
        return new Response(tarballBytes.slice().buffer as ArrayBuffer, { status: 200 })
      })

      const result = await installAntflyDependency(optsAutoYes, undefined, makePin())
      expect(result.status).toBe('failed')
      expect(result.message).toContain('Stop the unrelated listener manually')
      // Old binary untouched.
      expect(readFileSync(managedBinary, 'utf-8')).toContain('0.1.1')
    } finally {
      delete process.env.BAKIN_SEARCH_SERVICE_MODE
    }
  })

  it('upgrade readiness gate: engine never answers after the swap → failed with recovery guidance (#859)', async () => {
    process.env.BAKIN_SEARCH_SERVICE_MODE = 'child'
    try {
      writeBinary(managedBinary, '0.1.1')
      let readyzCalls = 0
      mockDownloadFetch(async (url) => {
        if (url.endsWith('/readyz')) {
          readyzCalls += 1
          // These are all post-start probes; staging/stopping never relies on readiness.
          throw new Error('connection refused')
        }
        return new Response(tarballBytes.slice().buffer as ArrayBuffer, { status: 200 })
      })

      const result = await installAntflyDependency(optsAutoYes, undefined, makePin(), { readyBudgetMs: 300, pollMs: 50 })
      expect(result.status).toBe('failed')
      expect(result.message).toContain('not answering')
      expect(result.message).toContain('bakin install search')
      expect(readyzCalls).toBeGreaterThanOrEqual(3)
    } finally {
      delete process.env.BAKIN_SEARCH_SERVICE_MODE
    }
  })

  it('upgrade readiness gate: engine answers after the swap → installed', async () => {
    process.env.BAKIN_SEARCH_SERVICE_MODE = 'child'
    try {
      writeBinary(managedBinary, '0.1.1')
      let readyzCalls = 0
      mockDownloadFetch(async (url) => {
        if (url.endsWith('/readyz')) {
          readyzCalls += 1
          if (readyzCalls === 2) throw new Error('connection refused') // post-stop check
          return new Response('ok', { status: 200 })
        }
        return new Response(tarballBytes.slice().buffer as ArrayBuffer, { status: 200 })
      })

      const result = await installAntflyDependency(optsAutoYes, undefined, makePin(), { readyBudgetMs: 2_000, pollMs: 50 })
      expect(result.status).toBe('installed')
      expect(readFileSync(managedBinary, 'utf-8')).toContain(PIN_VERSION)
    } finally {
      delete process.env.BAKIN_SEARCH_SERVICE_MODE
    }
  })

  it('already-installed path gates its restart too: dead engine → failed, not a green noop (#859)', async () => {
    process.env.BAKIN_SEARCH_SERVICE_MODE = 'child'
    try {
      writeBinary(managedBinary, PIN_VERSION) // binary already current
      mockDownloadFetch(async (url) => {
        if (url.endsWith('/readyz')) throw new Error('connection refused')
        return new Response(tarballBytes.slice().buffer as ArrayBuffer, { status: 200 })
      })

      const result = await installAntflyDependency(optsAutoYes, undefined, makePin(), { readyBudgetMs: 300, pollMs: 50 })
      expect(result.status).toBe('failed')
      expect(result.message).toContain('not answering')
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

  it('skips without approval, downloading nothing', async () => {
    const opts = { ...optsAutoYes, autoApprove: false }
    const result = await installAntflyDependency(opts, undefined, makePin())
    expect(result.status).toBe('skipped')
    expect(result.message).toContain('not approved')
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

// Ownership regressions exercise the real installer and fake only supervisor/network boundaries.
describe('commit rollback boundary (#890)', () => {
  const shareDir = join(antflyHomeDir, 'share')
  const shareAside = `${shareDir}.previous`
  const oldMarker = join(shareDir, 'old-marker.txt')
  const newAsset = join(shareDir, 'antfly', 'antfarm', 'index.html')
  const stagingDir = join(antflyHomeDir, 'tmp')
  /** A previous installation: pinned-but-older binary plus assets with a marker only it carries. */
  function previousInstallation(): string {
    writeBinary(managedBinary, '0.1.1')
    mkdirSync(join(shareDir, 'antfly'), { recursive: true })
    writeFileSync(oldMarker, 'previous assets')
    return readFileSync(managedBinary, 'utf-8')
  }
  const stopped = () => commands.some((c) => c[1] === 'bootout')
  const started = () => commands.some((c) => c[1] === 'bootstrap')

  it('(i) the aside rename fails → previous binary and share/ intact, service restarted, failed, staging gone', async () => {
    const previous = previousInstallation()
    mockDownloadFetch()
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin(), {
      installerFs: { renameDirectory: (from) => { if (from === shareDir) throw new Error('injected: aside rename refused') } },
    })
    expect(result.status).toBe('failed')
    expect(result.message).toContain('injected: aside rename refused')
    expect(readFileSync(managedBinary, 'utf-8')).toBe(previous)
    expect(readFileSync(oldMarker, 'utf-8')).toBe('previous assets')
    expect(existsSync(shareAside)).toBe(false)
    expect(existsSync(newAsset)).toBe(false)
    expect(stopped() && started()).toBe(true)
    expect(existsSync(stagingDir) ? readdirSync(stagingDir) : []).toEqual([])
  })

  it('(ii) the binary commit fails → share/ restored from the aside, previous binary intact, service restarted, failed', async () => {
    const previous = previousInstallation()
    mockDownloadFetch()
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin(), {
      installerFs: { commitFile: async () => { throw new Error('injected: commit refused') } },
    })
    expect(result.status).toBe('failed')
    expect(result.message).toContain('injected: commit refused')
    expect(readFileSync(managedBinary, 'utf-8')).toBe(previous)
    expect(readFileSync(oldMarker, 'utf-8')).toBe('previous assets')
    expect(existsSync(newAsset)).toBe(false)
    expect(existsSync(shareAside)).toBe(false)
    expect(stopped() && started()).toBe(true)
  })

  it('(iii-a) readiness never answers AFTER the commit → new binary and assets kept, share.previous retained, failed naming the restart', async () => {
    process.env.BAKIN_SEARCH_SERVICE_MODE = 'child'
    try {
      const previous = previousInstallation()
      mockDownloadFetch(async (url) => {
        if (url.endsWith('/readyz')) throw new Error('connection refused')
        return new Response(tarballBytes.slice().buffer as ArrayBuffer, { status: 200 })
      })
      const result = await installAntflyDependency(optsAutoYes, undefined, makePin(), { readyBudgetMs: 300, pollMs: 50 })
      expect(result.status).toBe('failed')
      expect(result.message).toContain('not answering')
      expect(readFileSync(managedBinary, 'utf-8')).not.toBe(previous)
      expect(existsSync(newAsset)).toBe(true)
      expect(existsSync(oldMarker)).toBe(false)
      expect(existsSync(join(shareAside, 'old-marker.txt'))).toBe(true)
    } finally {
      delete process.env.BAKIN_SEARCH_SERVICE_MODE
    }
  })

  it('(iii-b) the supervisor refuses to start the new engine AFTER the commit → new pair kept, share.previous retained, failed with the supervisor error', async () => {
    const previous = previousInstallation()
    mockDownloadFetch()
    bootstrapFails = 'launchctl: Bootstrap failed: 5: Input/output error'
    // Derived data exists, so the version change clears it: the guidance must
    // end with the reindex, and must route past the aside it keeps.
    mkdirSync(servicePaths().dataDir, { recursive: true })
    try {
      const result = await installAntflyDependency(optsAutoYes, undefined, makePin())
      expect(result.status).toBe('failed')
      expect(result.message).toContain('did not restart')
      expect(result.message).toContain('Input/output error')
      expect(result.message).toContain('--version')
      expect(result.message).toContain(`delete ${shareAside}`)
      expect(result.message).toContain('bakin install search')
      expect(result.message).toContain('bakin reindex')
      expect(readFileSync(managedBinary, 'utf-8')).not.toBe(previous)
      expect(existsSync(newAsset)).toBe(true)
      expect(existsSync(oldMarker)).toBe(false)
      expect(existsSync(join(shareAside, 'old-marker.txt'))).toBe(true)
      expect(stopped()).toBe(true)
    } finally {
      bootstrapFails = null
    }
  })

  it('(iv) a pre-existing share.previous is refused before the service is touched, with the version rule', async () => {
    const previous = previousInstallation()
    mkdirSync(shareAside, { recursive: true })
    writeFileSync(join(shareAside, 'leftover.txt'), 'from an interrupted install')
    mockDownloadFetch()
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin())
    expect(result.status).toBe('failed')
    expect(result.message).toContain(shareAside)
    expect(result.message).toContain('--version')
    expect(result.message).toContain('reinstall')
    expect(stopped()).toBe(false)
    expect(readFileSync(managedBinary, 'utf-8')).toBe(previous)
    expect(readFileSync(oldMarker, 'utf-8')).toBe('previous assets')
    expect(readFileSync(join(shareAside, 'leftover.txt'), 'utf-8')).toBe('from an interrupted install')
  })

  it('(ii-b) the restore of share.previous fails → nothing restarts, both errors reported, every artifact kept aside', async () => {
    const previous = previousInstallation()
    mockDownloadFetch()
    let renames = 0
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin(), {
      installerFs: {
        commitFile: async () => { throw new Error('injected: commit refused') },
        renameDirectory: (from, to) => {
          renames += 1
          if (from === shareAside) throw new Error('injected: restore refused')
          renameSync(from, to)
        },
      },
    })
    expect(result.status).toBe('failed')
    expect(result.message).toContain('injected: commit refused')
    expect(result.message).toContain('recovery failed')
    expect(result.message).toContain('injected: restore refused')
    expect(result.message).toContain(shareAside)
    expect(started()).toBe(false)
    expect(readFileSync(managedBinary, 'utf-8')).toBe(previous)
    expect(readFileSync(join(shareAside, 'old-marker.txt'), 'utf-8')).toBe('previous assets')
    expect(existsSync(join(`${shareDir}.failed`, 'antfly', 'antfarm', 'index.html'))).toBe(true)
    expect(existsSync(shareDir)).toBe(false)
    expect(renames).toBe(4) // aside, in, failed-aside, restore (refused)
  })

  it('(ii-c) the move of the half-committed assets aside fails → the message names where they really are, nothing restarts', async () => {
    const previous = previousInstallation()
    mockDownloadFetch()
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin(), {
      installerFs: {
        commitFile: async () => { throw new Error('injected: commit refused') },
        renameDirectory: (from, to) => {
          if (to === `${shareDir}.failed`) throw new Error('injected: move aside refused')
          renameSync(from, to)
        },
      },
    })
    expect(result.status).toBe('failed')
    expect(result.message).toContain('injected: commit refused')
    expect(result.message).toContain('injected: move aside refused')
    expect(result.message).toContain(`the half-committed assets are at ${shareDir}`)
    expect(result.message).toContain(`the previous assets are at ${shareAside}`)
    expect(result.message).not.toContain(`assets are at ${shareDir}.failed`)
    expect(started()).toBe(false)
    expect(readFileSync(managedBinary, 'utf-8')).toBe(previous)
    expect(existsSync(newAsset)).toBe(true)
    expect(readFileSync(join(shareAside, 'old-marker.txt'), 'utf-8')).toBe('previous assets')
    expect(lastView?.log.some((entry) => entry.level === 'warn' && entry.text.includes('recovery failed'))).toBe(true)
  })

  it('a share.previous that cannot be removed after a successful install is reported through the operation, not just the logger', async () => {
    previousInstallation()
    mockDownloadFetch()
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin(), {
      installerFs: { removeDirectory: (path) => { if (path === shareAside) throw new Error('injected: busy directory') } },
    })
    expect(result.status).toBe('installed')
    expect(existsSync(join(shareAside, 'old-marker.txt'))).toBe(true)
    const warn = lastView?.log.find((entry) => entry.level === 'warn' && entry.text.includes(shareAside))
    expect(warn?.text).toContain('injected: busy directory')
    expect(warn?.text).toContain('next install refuses')
  })

  it('(iv-b) the already-at-pin path refuses a leftover share.previous too, before touching the service', async () => {
    writeBinary(managedBinary, PIN_VERSION)
    mkdirSync(shareAside, { recursive: true })
    writeFileSync(join(shareAside, 'leftover.txt'), 'from an interrupted install')
    mockDownloadFetch()
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin())
    expect(result.status).toBe('failed')
    expect(result.message).toContain(shareAside)
    expect(result.message).toContain('--version')
    expect(stopped()).toBe(false)
    expect(fetchCalls.some((u) => u.endsWith('.tar.gz'))).toBe(false)
    expect(readFileSync(join(shareAside, 'leftover.txt'), 'utf-8')).toBe('from an interrupted install')
  })

  it('(v) a FRESH install whose commit fails restores absence, restarts nothing, keeps its own error', async () => {
    mockDownloadFetch()
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin(), {
      installerFs: { commitFile: async () => { throw new Error('injected: fresh commit refused') } },
    })
    expect(result.status).toBe('failed')
    expect(result.message).toContain('injected: fresh commit refused')
    expect(existsSync(managedBinary)).toBe(false)
    expect(existsSync(shareDir)).toBe(false)
    expect(existsSync(shareAside)).toBe(false)
    expect(started()).toBe(false)
  })
})

it('pinned binary alone is not a complete managed installation', async () => {
  writeBinary(managedBinary, PIN_VERSION)
  expect((await checkAntflyDependency(makePin())).status).toBe('missing')
})
it('fresh install provisions a unit and starts it before success', async () => {
  const result = await installAntflyDependency(optsAutoYes, undefined, makePin())
  expect(result.status).toBe('installed')
  expect(existsSync(launchdPlistPath(serviceIo))).toBe(true)
  expect(loaded).toBe(true)
})
it('temporary install refuses before downloading or changing the shared binary', async () => {
  serviceIo.tempRoots = [testDir]
  const result = await installAntflyDependency(optsAutoYes, undefined, makePin())
  expect(result.status).toBe('failed')
  expect(fetchCalls).toEqual([])
  expect(commands).toEqual([])
  expect(existsSync(managedBinary)).toBe(false)
})

it('a failed download leaves an installed service running and its binary intact', async () => {
  writeBinary(managedBinary, '0.1.1')
  loaded = true
  mockDownloadFetch(() => new Response('unavailable', { status: 503 }))
  expect((await installAntflyDependency(optsAutoYes, undefined, makePin())).status).toBe('failed')
  expect(loaded).toBe(true)
  expect(commands).toEqual([])
  expect(readFileSync(managedBinary, 'utf8')).toContain('0.1.1')
})

it('a current override cannot conceal the missing executable the service launches', async () => {
  const override = join(testDir, 'current-override')
  writeBinary(override, PIN_VERSION)
  process.env.ANTFLY_PATH = override
  const result = await installAntflyDependency(optsAutoYes, undefined, makePin())
  expect(result.status).toBe('failed')
  expect(result.message).toContain('ANTFLY_PATH')
  expect(fetchCalls).toEqual([])
  expect(commands).toEqual([])
})

it('guest setup requires no local binary or model installation and refuses reset', async () => {
  const { createAntflySearchSetup } = await import('../../../packages/adapter-antfly/src/setup')
  const setup = createAntflySearchSetup(undefined, { ...DEFAULT_SETTINGS, url: 'http://isolated:9000' })
  expect((await setup.dependency.check()).status).toBe('ok')
  const engine = await withOperationView({ plan: setup.dependency.plan, resources: ['search-engine'] }, (op) => setup.dependency.install({ ...optsAutoYes, op }))
  expect(engine.value.status).toBe('noop')
  expect(engine.view.stages.every((stage) => stage.status === 'skipped')).toBe(true)
  expect((await setup.models!.check()).status).toBe('ok')
  const models = await withOperationView({ plan: setup.models!.plan, resources: ['search-engine'] }, (op) => setup.models!.install({ ...optsAutoYes, op }))
  expect(models.value.status).toBe('noop')
  expect(models.view.stages.every((stage) => stage.status === 'skipped')).toBe(true)
  const reset = await withOperationView({ plan: { stages: [...ENGINE_RESET_STAGES], pointOfNoReturn: 'start' }, resources: ['search-engine'] }, (op) => setup.resetEngineData!(op))
  expect(reset.value.status).toBe('failed')
  expect(fetchCalls).toEqual([])
  expect(commands).toEqual([])
  expect(existsSync(managedBinary)).toBe(false)
})

it('native child override refuses installation before changing shared state', async () => {
  serviceIo.env.BAKIN_SEARCH_SERVICE_MODE = 'child'
  try {
    writeBinary(managedBinary, '0.1.1')
    const result = await installAntflyDependency(optsAutoYes, undefined, makePin())
    expect(result.status).toBe('failed')
    expect(fetchCalls).toEqual([])
    expect(commands).toEqual([])
    expect(readFileSync(managedBinary, 'utf8')).toContain('0.1.1')
  } finally {
    delete serviceIo.env.BAKIN_SEARCH_SERVICE_MODE
  }
})

it('rechecks the shared binary after staging before deciding whether indexes need rebuilding', async () => {
  const marker = join(testDir, 'antfly', 'concurrent-version-data')
  mockDownloadFetch((url) => {
    if (url.endsWith('.tar.gz')) {
      // Another allowed install completes while this caller stages its download.
      writeBinary(managedBinary, '0.1.1')
      mkdirSync(join(marker, '..'), { recursive: true })
      writeFileSync(marker, 'derived from the concurrent version')
      return new Response(tarballBytes.slice().buffer as ArrayBuffer)
    }
    return new Response('ok')
  })
  expect((await installAntflyDependency(optsAutoYes, undefined, makePin())).status).toBe('installed')
  expect(existsSync(marker)).toBe(false)
})

it('generic setup cannot claim an owner that appeared while its binary was downloading', async () => {
  let foreignUnit = ''
  mockDownloadFetch((url) => {
    if (url.endsWith('.tar.gz')) {
      const otherPaths = { ...servicePaths(), dataDir: join(testDir, 'other-home', 'antfly') }
      foreignUnit = renderLaunchdPlist(buildServiceArgv(DEFAULT_SETTINGS, otherPaths, { modelReady: () => false }), otherPaths.logFile)
      mkdirSync(join(launchdPlistPath(serviceIo), '..'), { recursive: true })
      writeFileSync(launchdPlistPath(serviceIo), foreignUnit)
      return new Response(tarballBytes.slice().buffer as ArrayBuffer)
    }
    return new Response('ok')
  })
  const result = await installAntflyDependency(optsAutoYes, undefined, makePin())
  expect(result.status).toBe('failed')
  expect(readFileSync(launchdPlistPath(serviceIo), 'utf8')).toBe(foreignUnit)
  expect(commands).toEqual([])
  expect(existsSync(managedBinary)).toBe(false)
})

describe('the engine install as an operation (#895)', () => {
  it('a fresh install reports every stage, with download bytes, and skips the cleanup it does not need', async () => {
    mockDownloadFetch()
    expect((await installAntflyDependency(optsAutoYes, undefined, makePin())).status).toBe('installed')
    const stages = Object.fromEntries(lastView!.stages.map((stage) => [stage.id, stage.status]))
    expect(stages).toEqual({ prepare: 'done', download: 'done', checksum: 'done', extract: 'done', version: 'done', commit: 'done', cleanup: 'skipped', ready: 'done' })
    expect(lastView!.stages.find((stage) => stage.id === 'download')!.bytes?.received).toBe(tarballBytes.byteLength)
  })

  it('a version change clears the derived engine data in the cleanup stage', async () => {
    writeBinary(managedBinary, '0.1.1')
    mkdirSync(servicePaths().dataDir, { recursive: true })
    const table = join(servicePaths().dataDir, 'table.db')
    writeFileSync(table, 'old engine format')
    mockDownloadFetch()
    expect((await installAntflyDependency(optsAutoYes, undefined, makePin())).status).toBe('installed')
    expect(lastView!.stages.find((stage) => stage.id === 'cleanup')!.status).toBe('done')
    expect(existsSync(table)).toBe(false)
  })

  it('an engine already at the pin skips the staging stages and restarts the service', async () => {
    writeBinary(managedBinary, PIN_VERSION)
    mockDownloadFetch()
    expect((await installAntflyDependency(optsAutoYes, undefined, makePin())).status).toBe('noop')
    const stages = Object.fromEntries(lastView!.stages.map((stage) => [stage.id, stage.status]))
    expect(stages).toMatchObject({ download: 'skipped', checksum: 'skipped', extract: 'skipped', version: 'skipped', commit: 'done', cleanup: 'skipped', ready: 'done' })
  })

  it('cancel during the engine download leaves the old engine running and its binary intact', async () => {
    writeBinary(managedBinary, '0.1.1')
    loaded = true
    let cancelled = false
    mockDownloadFetch((url) => {
      if (!url.endsWith('.tar.gz')) throw new Error(`unexpected URL: ${url}`)
      // Half the archive, then nothing until the reader gives up.
      return new Response(new ReadableStream<Uint8Array>({
        start: (controller) => controller.enqueue(tarballBytes.slice(0, tarballBytes.byteLength >> 1)),
        cancel: () => { cancelled = true },
      }), { status: 200 })
    })
    const reg = createOperationRegistry({ bootId: () => 'b', publish: () => {}, quietCheckIntervalMs: 0, acquireResources: createMemoryResourceAcquirer(1) })
    try {
      const { operationId } = await reg.start({
        kind: 'install:search', owner: 'core', origin: 'cli', title: 'Install the search engine', fingerprint: 'install:search',
        resources: ['search-engine'], plan: ANTFLY_ENGINE_PLAN,
        run: async (op) => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: await installDependency({ ...optsAutoYes, op }, undefined, makePin(), { readyBudgetMs: 100, pollMs: 1, io: serviceIo }) }),
      })
      await waitUntil(() => (reg.get(operationId)?.stages.find((stage) => stage.id === 'download')?.bytes?.received ?? 0) > 0, { label: 'the download is streaming' })
      expect(reg.cancel(operationId)).toBe('cancelling')
      const view = await reg.await(operationId)
      expect(view.status).toBe('cancelled')
      expect(cancelled).toBe(true)
      expect(loaded).toBe(true)
      expect(commands).toEqual([])
      expect(readFileSync(managedBinary, 'utf8')).toContain('0.1.1')
      expect(existsSync(join(antflyHomeDir, 'tmp'))).toBe(false)
    } finally {
      reg.dispose()
    }
  })
  it('cancel before the commit of an engine already at the pin settles cancelled, not failed', async () => {
    // The version probe announces itself, then waits for the test to cancel.
    const asked = join(testDir, 'version-asked')
    const release = join(testDir, 'version-release')
    mkdirSync(join(managedBinary, '..'), { recursive: true })
    writeFileSync(managedBinary, `#!/bin/sh\ntouch "${asked}"\nn=0\nwhile [ ! -f "${release}" ] && [ $n -lt 100 ]; do sleep 0.05; n=$((n+1)); done\necho "antfly ${PIN_VERSION} (zig)"\n`, { mode: 0o755 })
    mockDownloadFetch()
    const reg = createOperationRegistry({ bootId: () => 'b', publish: () => {}, quietCheckIntervalMs: 0, acquireResources: createMemoryResourceAcquirer(1) })
    try {
      const { operationId } = await reg.start({
        kind: 'install:search', owner: 'core', origin: 'cli', title: 'Install the search engine', fingerprint: 'install:search',
        resources: ['search-engine'], plan: ANTFLY_ENGINE_PLAN,
        run: async (op) => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: await installDependency({ ...optsAutoYes, op }, undefined, makePin(), { readyBudgetMs: 100, pollMs: 1, io: serviceIo }) }),
      })
      await waitUntil(() => existsSync(asked), { label: 'the install is probing the existing engine' })
      expect(reg.cancel(operationId)).toBe('cancelling')
      writeFileSync(release, '')
      const view = await reg.await(operationId)
      expect(view.status).toBe('cancelled')
      expect(commands).toEqual([])
    } finally {
      reg.dispose()
    }
  })
  it('cancel during the under-lock recheck of an engine already at the pin settles cancelled with the service untouched (#890)', async () => {
    // The first probe (discovery) answers at once; the second (the recheck
    // inside withServiceOperation, before stopService) announces itself and
    // waits for the test to cancel. Without op.signal on that probe the
    // recheck would run its loop out and the install would stop the service.
    const counter = join(testDir, 'recheck-count')
    const asked = join(testDir, 'recheck-asked')
    const release = join(testDir, 'recheck-release')
    const ranOut = join(testDir, 'recheck-ran-out')
    mkdirSync(join(managedBinary, '..'), { recursive: true })
    // The recheck parks for up to 10 s and leaves a marker if it runs its loop
    // out: an interrupted probe never writes it, and the cancel settles well
    // inside the loop. Without the signal the loop completes, the marker
    // appears and the settle takes the full 10 s — both assertions fail.
    writeFileSync(managedBinary, `#!/bin/sh\nif [ -f "${counter}" ]; then touch "${asked}"; n=0; while [ ! -f "${release}" ] && [ $n -lt 200 ]; do sleep 0.05; n=$((n+1)); done; touch "${ranOut}"; else touch "${counter}"; fi\necho "antfly ${PIN_VERSION} (zig)"\n`, { mode: 0o755 })
    mockDownloadFetch()
    const reg = createOperationRegistry({ bootId: () => 'b', publish: () => {}, quietCheckIntervalMs: 0, acquireResources: createMemoryResourceAcquirer(1) })
    try {
      const { operationId } = await reg.start({
        kind: 'install:search', owner: 'core', origin: 'cli', title: 'Install the search engine', fingerprint: 'install:search',
        resources: ['search-engine'], plan: ANTFLY_ENGINE_PLAN,
        run: async (op) => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: await installDependency({ ...optsAutoYes, op }, undefined, makePin(), { readyBudgetMs: 100, pollMs: 1, io: serviceIo }) }),
      })
      await waitUntil(() => existsSync(asked), { label: 'the install is rechecking the engine under the lock' })
      const cancelledAt = Date.now()
      expect(reg.cancel(operationId)).toBe('cancelling')
      const view = await reg.await(operationId)
      const settledAfterMs = Date.now() - cancelledAt
      writeFileSync(release, '')
      expect(view.status).toBe('cancelled')
      expect(commands).toEqual([])
      expect(settledAfterMs).toBeLessThan(4_000)
      expect(existsSync(ranOut)).toBe(false)
    } finally {
      reg.dispose()
    }
  })
  it('cancel while the downloaded binary reports its version settles cancelled, even when the version is wrong', async () => {
    // A release whose binary announces its version probe, waits for the
    // test to cancel, then reports a version that does not match the pin.
    const asked = join(testDir, 'staged-version-asked')
    const release = join(testDir, 'staged-version-release')
    const srcDir = join(testDir, 'gated-tarball-src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'antfly'), `#!/bin/sh\ntouch "${asked}"\nn=0\nwhile [ ! -f "${release}" ] && [ $n -lt 100 ]; do sleep 0.05; n=$((n+1)); done\necho "antfly 9.9.9 (zig)"\n`, { mode: 0o755 })
    const gatedPath = join(testDir, 'gated-release.tar.gz')
    execSync(`tar -czf ${JSON.stringify(gatedPath)} -C ${JSON.stringify(srcDir)} .`)
    const gatedBytes = new Uint8Array(readFileSync(gatedPath))
    const gatedSum = createHash('sha256').update(gatedBytes).digest('hex')
    mockDownloadFetch((url) => {
      if (url.endsWith('.tar.gz')) return new Response(gatedBytes.slice().buffer as ArrayBuffer, { status: 200 })
      throw new Error(`unexpected URL: ${url}`)
    })
    const pin = makePin({ checksums: { 'darwin-arm64': gatedSum, 'linux-x64': gatedSum, 'linux-arm64': gatedSum } })
    const reg = createOperationRegistry({ bootId: () => 'b', publish: () => {}, quietCheckIntervalMs: 0, acquireResources: createMemoryResourceAcquirer(1) })
    try {
      const { operationId } = await reg.start({
        kind: 'install:search', owner: 'core', origin: 'cli', title: 'Install the search engine', fingerprint: 'install:search',
        resources: ['search-engine'], plan: ANTFLY_ENGINE_PLAN,
        run: async (op) => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: await installDependency({ ...optsAutoYes, op }, undefined, pin, { readyBudgetMs: 100, pollMs: 1, io: serviceIo }) }),
      })
      await waitUntil(() => existsSync(asked), { label: 'the install is probing the downloaded binary' })
      expect(reg.cancel(operationId)).toBe('cancelling')
      writeFileSync(release, '')
      const view = await reg.await(operationId)
      expect(view.status).toBe('cancelled')
      expect(commands).toEqual([])
      expect(existsSync(managedBinary)).toBe(false)
    } finally {
      reg.dispose()
    }
  })
})

describe('the engine reset as operation stages (#895)', () => {
  it('stops the service, wipes derived data and starts clean, reporting each stage', async () => {
    writeBinary(managedBinary, PIN_VERSION)
    mockDownloadFetch()
    expect((await installAntflyDependency(optsAutoYes, undefined, makePin())).status).toBe('noop')
    const table = join(servicePaths().dataDir, 'table.db')
    mkdirSync(servicePaths().dataDir, { recursive: true })
    writeFileSync(table, 'derived index data')
    commands.length = 0

    const { resetAntflyEngineData } = await import('../../../packages/adapter-antfly/src/installer')
    const { value, view } = await withOperationView({ plan: { stages: [...ENGINE_RESET_STAGES], pointOfNoReturn: 'start' }, resources: ['search-engine'] }, (op) =>
      resetAntflyEngineData(op, undefined, DEFAULT_SETTINGS, serviceIo))

    expect(value.status).toBe('installed')
    expect(view.stages.map((stage) => [stage.id, stage.status])).toEqual([['stop', 'done'], ['wipe', 'done'], ['boot', 'done']])
    expect(existsSync(table)).toBe(false)
    expect(loaded).toBe(true)
    expect(commands.some((command) => command.includes('bootout'))).toBe(true)
  })

  it('refuses to run outside an owner of search-engine', async () => {
    const { resetAntflyEngineData } = await import('../../../packages/adapter-antfly/src/installer')
    await expect(resetAntflyEngineData(noopOpWithout('search-engine'), undefined, DEFAULT_SETTINGS, serviceIo)).rejects.toThrow(/requires search-engine/)
  })
})

function noopOpWithout(_resource: string) {
  return { ...noopOp(), holds: () => false }
}
