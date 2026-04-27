/**
 * Schema-level coverage for the `linked` + `linkedSource` fields added in
 * Phase 2 P2.C1. Verifies:
 *
 *   - Round-trip of a linked entry through write/read.
 *   - The cross-field refine rejects partial/malformed shapes
 *     (linkedSource without linked, linked without linkedSource, linked
 *     with non-empty commitSha, linked with type=github, etc.).
 *   - `addLinkedPlugin` mutator asserts the shape before delegating to
 *     addPlugin.
 *   - `isLinked` type guard returns the expected boolean for each shape.
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-lockfile-linked-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import {
  PluginLockfileSchema,
  type PluginLockEntry,
  type PluginLockfile,
  addPlugin,
  addLinkedPlugin,
  isLinked,
  readPluginLockfile,
  writePluginLockfile,
} from '../../../packages/core/src/plugins/lockfile'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  const lockfileDir = join(testDir, 'plugins')
  if (existsSync(lockfileDir)) rmSync(lockfileDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

const NOW = '2026-04-25T12:00:00Z'

function linkedEntry(overrides: Partial<PluginLockEntry> = {}): PluginLockEntry {
  return {
    source: '/Users/dev/my-plugin',
    type: 'local',
    ref: '',
    commitSha: '',
    installedAt: NOW,
    version: '0.1.0',
    permissions: [],
    manifestSha: 'deadbeefcafe',
    linked: true,
    linkedSource: '/Users/dev/my-plugin',
    ...overrides,
  }
}

function installedEntry(overrides: Partial<PluginLockEntry> = {}): PluginLockEntry {
  return {
    source: 'github:owner/repo',
    type: 'github',
    ref: 'main',
    commitSha: '0123456789abcdef0123456789abcdef01234567',
    installedAt: NOW,
    version: '1.0.0',
    permissions: [],
    manifestSha: 'cafebabe',
    ...overrides,
  }
}

function tryParse(entry: PluginLockEntry): { ok: boolean } {
  const result = PluginLockfileSchema.safeParse({
    version: 1,
    plugins: { foo: entry },
  })
  return { ok: result.success }
}

describe('lockfile schema — linked entries round-trip', () => {
  it('accepts a well-formed linked entry through write/read', () => {
    const entry = linkedEntry()
    const initial: PluginLockfile = { version: 1, plugins: {} }
    writePluginLockfile(addLinkedPlugin(initial, 'foo', entry))

    const round = readPluginLockfile()
    expect(round.plugins.foo).toEqual(entry)
    expect(isLinked(round.plugins.foo!)).toBe(true)
  })

  it('linked + installed entries can coexist in the same lockfile', () => {
    let lock: PluginLockfile = { version: 1, plugins: {} }
    lock = addPlugin(lock, 'installed', installedEntry())
    lock = addLinkedPlugin(lock, 'linked', linkedEntry())
    writePluginLockfile(lock)

    const round = readPluginLockfile()
    expect(Object.keys(round.plugins).sort()).toEqual(['installed', 'linked'])
    expect(isLinked(round.plugins.installed!)).toBe(false)
    expect(isLinked(round.plugins.linked!)).toBe(true)
  })
})

describe('lockfile schema — linked entry cross-field invariants', () => {
  it.each([
    [
      'linked=true without linkedSource',
      { linked: true, linkedSource: undefined as unknown as string },
    ],
    [
      'linkedSource without linked=true',
      { linked: false, linkedSource: '/Users/dev/foo' },
    ],
    [
      'linkedSource as relative path',
      { linkedSource: 'relative/path' },
    ],
    [
      'linked=true with type=github',
      { type: 'github' as const, source: 'github:owner/repo' },
    ],
    [
      'linked=true with non-empty commitSha',
      { commitSha: '0123456789abcdef0123456789abcdef01234567' },
    ],
    [
      'linked=true with non-empty ref',
      { ref: 'main' },
    ],
  ])('rejects: %s', (_label, overrides) => {
    expect(tryParse(linkedEntry(overrides as Partial<PluginLockEntry>)).ok).toBe(false)
  })

  it('accepts: linked=false (or undefined) installed entries pass unchanged', () => {
    expect(tryParse(installedEntry()).ok).toBe(true)
  })
})

describe('addLinkedPlugin / isLinked', () => {
  it('addLinkedPlugin throws when called with an installed-shape entry', () => {
    const lock: PluginLockfile = { version: 1, plugins: {} }
    expect(() => addLinkedPlugin(lock, 'foo', installedEntry())).toThrow(
      /non-link entry/,
    )
  })

  it('isLinked returns false for installed entries, true for linked entries', () => {
    expect(isLinked(installedEntry())).toBe(false)
    expect(isLinked(linkedEntry())).toBe(true)
  })

  it('isLinked returns false when linkedSource is empty string (defensive)', () => {
    expect(isLinked(linkedEntry({ linkedSource: '' }))).toBe(false)
  })
})
