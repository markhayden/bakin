/**
 * bin-owners — ownership of `~/.bakin/bin/<name>` across BOTH ledgers
 * (package lockfile `bin` projections + plugin lockfile `installedBins`).
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
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
  deleteBinsWithoutOwners,
  findBinPinConflicts,
} from '../../../src/core/plugins/bin-owners'
import type { BinRequirement } from '../../../packages/core/src/plugins/bin-requirement'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const PLATFORM = 'darwin-arm64' as const

function pinsPack(id: string, name: string, sha: string, member?: string): void {
  const lock = readLockfile()
  lock.packages[id] = {
    kind: 'skill-pack', version: '1.0.0', source: `github:x/${id}`, ref: '', commitSha: '', installedAt: new Date().toISOString(),
    projections: [{ kind: 'bin', target: binTargetPath(name), sha256: sha, ...(member ? { member } : {}) }],
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
const declaresArchive = (name: string, sha: string, member: string): BinRequirement => ({
  name, version: '1', install: { [PLATFORM]: { url: 'https://example.com/x.tar.gz', sha256: sha, archive: { format: 'tar.gz', member } } },
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

  it('the same archive with a different member is a DIFFERENT binary — a conflict, not sharing', () => {
    pinsPack('ocr', 'tool', A, 'bin/tool-a')
    expect(findBinPinConflicts([declaresArchive('tool', A, 'bin/tool-a')], { kind: 'plugin', id: 'terminal' }, PLATFORM)).toEqual([])
    const conflicts = findBinPinConflicts([declaresArchive('tool', A, 'bin/tool-b')], { kind: 'plugin', id: 'terminal' }, PLATFORM)
    expect(conflicts).toHaveLength(1)
    expect(BinPinConflictError.describe(conflicts, { kind: 'plugin', id: 'terminal' })).toMatch(/member bin\/tool-a.*member bin\/tool-b/)
    // A raw pin against an archive pin at the same sha is a conflict too (different bytes on disk).
    expect(findBinPinConflicts([declares('tool', A)], { kind: 'plugin', id: 'terminal' }, PLATFORM)).toHaveLength(1)
  })

  it('bins with no download for this platform are not judged here', () => {
    pinsPack('ocr', 'tmux', A)
    const linuxOnly: BinRequirement = { name: 'tmux', version: '1', install: { 'linux-x64': { url: 'https://example.com/x', sha256: B } } }
    expect(findBinPinConflicts([linuxOnly], { kind: 'plugin', id: 'terminal' }, PLATFORM)).toEqual([])
  })
})

describe('deleteBinsWithoutOwners (the S6 rule)', () => {
  const place = (name: string): void => {
    writeFileSync(binTargetPath(name), '#!/bin/sh\n', { mode: 0o755 })
    writeFileSync(`${binTargetPath(name)}.installedBy`, '{}')
  }

  it('deletes file AND marker for a bin nobody pins; keeps one a pack or another plugin still pins; honours keep', () => {
    place('orphan'); place('packheld'); place('pluginheld'); place('kept')
    pinsPack('ocr', 'packheld', A)
    pinsPlugin('other', 'pluginheld', A)
    const deleted = deleteBinsWithoutOwners([{ name: 'orphan' }, { name: 'packheld' }, { name: 'pluginheld' }, { name: 'kept' }, { name: 'absent' }], new Set(['kept']))
    expect(deleted).toEqual(['orphan', 'absent'])
    expect(existsSync(binTargetPath('orphan'))).toBe(false)
    expect(existsSync(`${binTargetPath('orphan')}.installedBy`)).toBe(false)
    for (const name of ['packheld', 'pluginheld', 'kept']) {
      expect(existsSync(binTargetPath(name)), name).toBe(true)
      expect(existsSync(`${binTargetPath(name)}.installedBy`), name).toBe(true)
    }
  })
})
