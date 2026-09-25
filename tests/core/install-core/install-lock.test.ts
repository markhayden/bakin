/**
 * ONE install lock for every writer of ~/.bakin (packs, plugins, repairs):
 * a single path, O_EXCL acquisition (atomic across processes), stale-holder
 * reclaim, holder-only release, reentrant `withInstallLock` for the outer
 * operation, and `assertInstallLockHeld` for inner writers.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-install-lock-${Date.now()}-${Math.random().toString(16).slice(2)}`)
const paths = () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') })
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))

import {
  acquireInstallLock,
  assertInstallLockHeld,
  getInstallLockPath,
  isInstallLockHeld,
  releaseInstallLock,
  withInstallLock,
} from '../../../src/core/install-core/install-lock'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')

beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true }) })
afterEach(() => { try { releaseInstallLock() } catch { /* not held */ } })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('install lock — single path, holder semantics', () => {
  it('lives at <home>/install.lock and records this pid', () => {
    expect(getInstallLockPath()).toBe(join(testDir, 'install.lock'))
    acquireInstallLock()
    expect(isInstallLockHeld()).toBe(true)
    expect(JSON.parse(readFileSync(getInstallLockPath(), 'utf-8')).pid).toBe(process.pid)
    releaseInstallLock()
    expect(isInstallLockHeld()).toBe(false)
    expect(existsSync(getInstallLockPath())).toBe(false)
  })

  it('refuses a second acquisition by the same process — concurrent operations in one server contend like processes do', () => {
    acquireInstallLock()
    expect(() => acquireInstallLock()).toThrow(/Another install is in progress \(pid \d+/)
  })

  it('reclaims a lock left by a dead process', () => {
    writeFileSync(getInstallLockPath(), JSON.stringify({ pid: 999_999, acquiredAt: '2026-01-01T00:00:00.000Z' }))
    expect(() => acquireInstallLock()).not.toThrow()
    expect(JSON.parse(readFileSync(getInstallLockPath(), 'utf-8')).pid).toBe(process.pid)
  })

  it('never releases a lock another live process holds', () => {
    writeFileSync(getInstallLockPath(), JSON.stringify({ pid: process.ppid, acquiredAt: new Date().toISOString() }))
    releaseInstallLock()
    expect(existsSync(getInstallLockPath())).toBe(true)
    rmSync(getInstallLockPath(), { force: true })
  })

  it('assertInstallLockHeld names the writer when the outer operation forgot the lock', async () => {
    expect(() => assertInstallLockHeld('installManifestBins')).toThrow(/installManifestBins.*install lock/)
    await withInstallLock(async () => {
      expect(() => assertInstallLockHeld('installManifestBins')).not.toThrow()
    })
  })

  it('a bare acquire does not satisfy inner writers — only the holding operation does', () => {
    acquireInstallLock()
    expect(() => assertInstallLockHeld('installManifestBins')).toThrow(/install lock/)
  })
})

describe('withInstallLock', () => {
  it('acquires for the outer call, is reentrant for inner calls, and releases on the way out', async () => {
    let innerSawHeld = false
    await withInstallLock(async () => {
      expect(isInstallLockHeld()).toBe(true)
      await withInstallLock(async () => { innerSawHeld = isInstallLockHeld() })
      expect(isInstallLockHeld()).toBe(true) // the inner call must not release the outer lock
    })
    expect(innerSawHeld).toBe(true)
    expect(isInstallLockHeld()).toBe(false)
  })

  it('releases when the body throws', async () => {
    await expect(withInstallLock(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(isInstallLockHeld()).toBe(false)
  })

  it('a second independent operation in the same process is refused while the first holds the lock — reentrancy is scoped to the operation', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let siblingSawHeld: boolean | null = null
    const first = withInstallLock(async () => { await gate })
    // A sibling request arriving mid-operation contends exactly like a second process would.
    await expect(withInstallLock(async () => { siblingSawHeld = true })).rejects.toThrow(/Another install is in progress/)
    expect(siblingSawHeld).toBeNull()
    // …and cannot pass the inner-writer assertion by merely observing the process flag.
    expect(() => assertInstallLockHeld('replacePluginDir')).toThrow(/install lock/)
    release()
    await first
    expect(isInstallLockHeld()).toBe(false)
  })
})

describe('two processes', () => {
  it('a second process is refused while the first holds the lock, and reclaims once it is gone', async () => {
    const script = `
      import { acquireInstallLock } from ${JSON.stringify(join(REPO_ROOT, 'src/core/install-core/install-lock.ts'))}
      acquireInstallLock()
      console.log('HELD')
      setInterval(() => {}, 1000)
    `
    const child = Bun.spawn(['bun', '-e', script], {
      cwd: REPO_ROOT,
      env: { ...process.env, BAKIN_HOME: testDir, BAKIN_CONSOLE_FORMAT: 'silent' },
      stdout: 'pipe', stderr: 'pipe',
    })
    const reader = child.stdout.getReader()
    let out = ''
    const deadline = Date.now() + 20_000
    while (!out.includes('HELD') && Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      out += new TextDecoder().decode(value)
    }
    expect(out).toContain('HELD')
    try {
      expect(() => acquireInstallLock()).toThrow(new RegExp(`pid ${child.pid}`))
      expect(isInstallLockHeld()).toBe(true)
    } finally {
      child.kill('SIGKILL')
      await child.exited
    }
    // The dead holder's file is reclaimed.
    expect(() => acquireInstallLock()).not.toThrow()
    expect(JSON.parse(readFileSync(getInstallLockPath(), 'utf-8')).pid).toBe(process.pid)
  }, 30_000)
})
