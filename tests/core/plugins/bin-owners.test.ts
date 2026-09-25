/**
 * bin-owners — ownership of `~/.bakin/bin/<name>` across BOTH ledgers
 * (package lockfile `bin` projections + plugin lockfile `installedBins`).
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-bin-owners-${Date.now()}-${Math.random().toString(16).slice(2)}`)
const paths = () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media'), plugins: join(testDir, 'plugins'), packages: join(testDir, 'packages') })
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))

import { readLockfile, writeLockfile } from '../../../packages/core/src/agent-packages/lockfile'
import { addPlugin, readPluginLockfile, writePluginLockfile } from '../../../packages/core/src/plugins/lockfile'
import {
  BinPinConflictError,
  assertNoBinPinConflict,
  binTargetOwners,
  binTargetPath,
  findBinPinConflicts,
} from '../../../src/core/plugins/bin-owners'
import type { BinRequirement } from '../../../packages/core/src/plugins/bin-requirement'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const PLATFORM = 'darwin-arm64' as const

function pinsPack(id: string, name: string, sha: string): void {
  const lock = readLockfile()
  lock.packages[id] = {
    kind: 'skill-pack', version: '1.0.0', source: `github:x/${id}`, ref: '', commitSha: '', installedAt: new Date().toISOString(),
    projections: [{ kind: 'bin', target: binTargetPath(name), sha256: sha }],
  }
  writeLockfile(lock)
}

function pinsPlugin(id: string, name: string, sha: string): void {
  writePluginLockfile(addPlugin(readPluginLockfile(), id, {
    source: `github:x/${id}`, type: 'github', ref: '', commitSha: '', installedAt: new Date().toISOString(),
    version: '1.0.0', permissions: [], manifestSha: 'm', installedBins: [{ name, sha256: sha }],
  }))
}

const declares = (name: string, sha: string): BinRequirement => ({
  name, version: '1', install: { [PLATFORM]: { url: 'https://example.com/x', sha256: sha } },
})

beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(join(testDir, 'bin'), { recursive: true }) })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('binTargetOwners', () => {
  it('is empty when no ledger pins the target', () => {
    expect(binTargetOwners(binTargetPath('tmux'))).toEqual([])
  })

  it('reads pack projections (bare id — lock keys carry @version) and plugin installedBins into one owner list', () => {
    pinsPack('ocr@1.0.0', 'tmux', A)
    pinsPlugin('terminal', 'tmux', A)
    expect(binTargetOwners(binTargetPath('tmux'))).toEqual([
      { kind: 'package', id: 'ocr', sha256: A },
      { kind: 'plugin', id: 'terminal', sha256: A },
    ])
  })

  it('a pack upgrading its own pin is not in conflict with its older lock key', () => {
    pinsPack('ocr@1.0.0', 'tmux', A)
    expect(findBinPinConflicts([declares('tmux', B)], { kind: 'package', id: 'ocr' }, PLATFORM)).toEqual([])
    expect(findBinPinConflicts([declares('tmux', B)], { kind: 'package', id: 'ocr@1.1.0' }, PLATFORM)).toEqual([])
  })
})

describe('pin conflicts', () => {
  it('identical pins share — no conflict, both owners survive', () => {
    pinsPack('ocr', 'tmux', A)
    expect(findBinPinConflicts([declares('tmux', A)], { kind: 'plugin', id: 'terminal' }, PLATFORM)).toEqual([])
    expect(() => assertNoBinPinConflict([declares('tmux', A)], { kind: 'plugin', id: 'terminal' }, PLATFORM)).not.toThrow()
  })

  it('a different pin for the same target is refused, naming both owners and the recovery sequence', () => {
    pinsPack('ocr', 'tmux', A)
    let error: unknown
    try { assertNoBinPinConflict([declares('tmux', B)], { kind: 'plugin', id: 'terminal' }, PLATFORM) } catch (err) { error = err }
    expect(error).toBeInstanceOf(BinPinConflictError)
    const message = (error as Error).message
    expect(message).toContain('package "ocr"')
    expect(message).toContain('plugin "terminal"')
    expect(message).toContain(A.slice(0, 12))
    expect(message).toContain(B.slice(0, 12))
    expect(message).toContain('Recovery:')
  })

  it('an owner re-pinning its own binary is not a conflict with itself', () => {
    pinsPlugin('terminal', 'tmux', A)
    expect(findBinPinConflicts([declares('tmux', B)], { kind: 'plugin', id: 'terminal' }, PLATFORM)).toEqual([])
  })

  it('checks in both directions: a pack declaring against a plugin pin', () => {
    pinsPlugin('terminal', 'tmux', A)
    expect(findBinPinConflicts([declares('tmux', B)], { kind: 'package', id: 'ocr' }, PLATFORM)).toHaveLength(1)
  })

  it('bins with no download for this platform are not judged here', () => {
    pinsPack('ocr', 'tmux', A)
    const linuxOnly: BinRequirement = { name: 'tmux', version: '1', install: { 'linux-x64': { url: 'https://example.com/x', sha256: B } } }
    expect(findBinPinConflicts([linuxOnly], { kind: 'plugin', id: 'terminal' }, PLATFORM)).toEqual([])
  })
})
