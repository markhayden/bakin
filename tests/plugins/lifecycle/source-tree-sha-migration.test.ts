/**
 * Hasher consolidation (FW5): the lockfile source-tree hasher is now the
 * canonical Whiskit `hashSourceTree`, and lockfile rows written by the old
 * (algo 1) hasher are migrated with a one-time rewrite instead of a
 * spurious "source changed" report.
 *
 * Covers:
 * - `computeSourceTreeSha` delegates to the canonical Whiskit hasher
 * - `compareStoredSourceTreeSha` verifies legacy rows with the legacy
 *   hasher (unchanged → migrate; genuinely changed → still detected)
 * - `runChecks` on a legacy row: unchanged reports no upgrade AND rewrites
 *   the row (sourceTreeSha + sourceTreeShaAlgo + lastSourceTreeSha);
 *   changed keeps the legacy row and reports the upgrade
 * - `upgradePlugin` local noop path performs the same one-time rewrite
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-sha-migration-${Date.now()}-${randomUUID()}`)
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
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))
// Skip the actual build step — these tests assert lockfile migration
// state, not bundling.
mock.module(
  '../../../packages/host/src/plugin-host/user-plugin-builder',
  () => ({ buildUserPlugin: async () => {} }),
)
mock.module('@/core/plugin-registry', () => ({
  isCorePlugin: () => false,
}))

import {
  type PluginLockEntry,
  addPlugin,
  readPluginLockfile,
  writePluginLockfile,
} from '../../../packages/core/src/plugins/lockfile'
import { hashSourceTree } from '../../../src/core/whiskit/source-hash'
import {
  SOURCE_TREE_SHA_ALGO,
  compareStoredSourceTreeSha,
  computeSourceTreeSha,
  legacySourceTreeSha,
} from '../../../src/core/plugins/source-tree-sha'
import { runChecks, upgradePlugin } from '../../../src/core/plugins/upgrade'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

function writeFixturePlugin(rootDir: string, opts: { id: string; version: string }): void {
  mkdirSync(rootDir, { recursive: true })
  writeFileSync(
    join(rootDir, 'bakin-plugin.json'),
    JSON.stringify({ id: opts.id, name: opts.id, version: opts.version, permissions: [] }),
    'utf-8',
  )
  writeFileSync(join(rootDir, 'index.ts'), `export default { id: '${opts.id}', activate() {} }`, 'utf-8')
}

function localEntry(opts: {
  sourcePath: string
  version: string
  sourceTreeSha?: string
  sourceTreeShaAlgo?: number
  lastSourceTreeSha?: string
}): PluginLockEntry {
  return {
    source: opts.sourcePath,
    type: 'local',
    ref: '',
    commitSha: '',
    installedAt: '2026-06-01T12:00:00Z',
    version: opts.version,
    permissions: [],
    manifestSha: 'abc',
    sourceTreeSha: opts.sourceTreeSha,
    sourceTreeShaAlgo: opts.sourceTreeShaAlgo,
    lastSourceTreeSha: opts.lastSourceTreeSha,
  }
}

describe('computeSourceTreeSha — canonical hasher', () => {
  it('delegates to the whiskit hashSourceTree (published-artifact formula)', () => {
    const dir = join(testDir, 'canon')
    writeFixturePlugin(dir, { id: 'canon', version: '1.0.0' })
    expect(computeSourceTreeSha(dir)).toBe(hashSourceTree(dir))
  })

  it('legacy hasher produces a DIFFERENT hash for the same tree (why migration exists)', () => {
    const dir = join(testDir, 'diverge')
    writeFixturePlugin(dir, { id: 'diverge', version: '1.0.0' })
    expect(legacySourceTreeSha(dir)).not.toBe(computeSourceTreeSha(dir))
  })
})

describe('compareStoredSourceTreeSha — legacy-aware comparison', () => {
  it('unchanged source with a legacy-algo stored sha: not changed, flagged for migration', () => {
    const dir = join(testDir, 'legacy-noop')
    writeFixturePlugin(dir, { id: 'legacy-noop', version: '1.0.0' })
    const stored = legacySourceTreeSha(dir)
    const cmp = compareStoredSourceTreeSha({ sourceTreeSha: stored }, dir)
    expect(cmp.changed).toBe(false)
    expect(cmp.needsAlgoMigration).toBe(true)
    expect(cmp.liveSha).toBe(computeSourceTreeSha(dir))
  })

  it('genuinely changed source with a legacy-algo stored sha: still detected, no migration', () => {
    const dir = join(testDir, 'legacy-changed')
    writeFixturePlugin(dir, { id: 'legacy-changed', version: '1.0.0' })
    const stored = legacySourceTreeSha(dir)
    writeFileSync(join(dir, 'extra.txt'), 'new content', 'utf-8')
    const cmp = compareStoredSourceTreeSha({ sourceTreeSha: stored }, dir)
    expect(cmp.changed).toBe(true)
    expect(cmp.needsAlgoMigration).toBe(false)
  })

  it('canonical-algo rows take the fast path (no legacy hashing)', () => {
    const dir = join(testDir, 'canon-row')
    writeFixturePlugin(dir, { id: 'canon-row', version: '1.0.0' })
    const stored = computeSourceTreeSha(dir)
    const same = compareStoredSourceTreeSha(
      { sourceTreeSha: stored, sourceTreeShaAlgo: SOURCE_TREE_SHA_ALGO },
      dir,
    )
    expect(same.changed).toBe(false)
    expect(same.needsAlgoMigration).toBe(false)

    writeFileSync(join(dir, 'extra.txt'), 'new content', 'utf-8')
    const diff = compareStoredSourceTreeSha(
      { sourceTreeSha: stored, sourceTreeShaAlgo: SOURCE_TREE_SHA_ALGO },
      dir,
    )
    expect(diff.changed).toBe(true)
    expect(diff.needsAlgoMigration).toBe(false)
  })

  it('a missing stored sha reports changed (install-time semantics preserved)', () => {
    const dir = join(testDir, 'no-sha')
    writeFixturePlugin(dir, { id: 'no-sha', version: '1.0.0' })
    const cmp = compareStoredSourceTreeSha({ sourceTreeSha: undefined }, dir)
    expect(cmp.changed).toBe(true)
    expect(cmp.needsAlgoMigration).toBe(false)
  })
})

describe('runChecks — one-time lockfile migration on --check', () => {
  it('legacy row + unchanged source: reports no upgrade and rewrites the row once', async () => {
    const sourcePath = join(testDir, 'src-check-noop')
    writeFixturePlugin(sourcePath, { id: 'check-noop', version: '1.0.0' })
    const legacySha = legacySourceTreeSha(sourcePath)
    writePluginLockfile(addPlugin(readPluginLockfile(), 'check-noop', localEntry({
      sourcePath,
      version: '1.0.0',
      sourceTreeSha: legacySha,
      lastSourceTreeSha: legacySha,
    })))

    const [result] = await runChecks(['check-noop'])
    expect(result!.upgradeAvailable).toBe(false)
    expect(result!.error).toBeUndefined()

    const entry = readPluginLockfile().plugins['check-noop']!
    const canonical = computeSourceTreeSha(sourcePath)
    expect(entry.sourceTreeSha).toBe(canonical)
    expect(entry.sourceTreeShaAlgo).toBe(SOURCE_TREE_SHA_ALGO)
    // The --check observation lands the canonical value too, so the
    // manifest route's lastSourceTreeSha !== sourceTreeSha comparison
    // stays consistent.
    expect(entry.lastSourceTreeSha).toBe(canonical)

    // Second check takes the canonical fast path and stays quiet.
    const [again] = await runChecks(['check-noop'])
    expect(again!.upgradeAvailable).toBe(false)
  })

  it('legacy row + genuinely changed source: still reports the upgrade, install-time sha untouched', async () => {
    const sourcePath = join(testDir, 'src-check-changed')
    writeFixturePlugin(sourcePath, { id: 'check-changed', version: '1.0.0' })
    const legacySha = legacySourceTreeSha(sourcePath)
    writePluginLockfile(addPlugin(readPluginLockfile(), 'check-changed', localEntry({
      sourcePath,
      version: '1.0.0',
      sourceTreeSha: legacySha,
    })))

    writeFileSync(join(sourcePath, 'extra.txt'), 'new content', 'utf-8')

    const [result] = await runChecks(['check-changed'])
    expect(result!.upgradeAvailable).toBe(true)

    const entry = readPluginLockfile().plugins['check-changed']!
    // No migration on a changed source — the install-time record still
    // describes what was installed; the upgrade commit rewrites it.
    expect(entry.sourceTreeSha).toBe(legacySha)
    expect(entry.sourceTreeShaAlgo).toBeUndefined()
    expect(entry.lastSourceTreeSha).toBe(computeSourceTreeSha(sourcePath))
  })
})

describe('upgradePlugin (local) — one-time lockfile migration on noop', () => {
  it('legacy row + unchanged source: noop AND row rewritten under the canonical hasher', async () => {
    const sourcePath = join(testDir, 'src-upg-noop')
    const pluginDir = join(testDir, 'plugins', 'upg-noop')
    writeFixturePlugin(sourcePath, { id: 'upg-noop', version: '1.0.0' })
    writeFixturePlugin(pluginDir, { id: 'upg-noop', version: '1.0.0' })
    const legacySha = legacySourceTreeSha(sourcePath)
    writePluginLockfile(addPlugin(readPluginLockfile(), 'upg-noop', localEntry({
      sourcePath,
      version: '1.0.0',
      sourceTreeSha: legacySha,
      lastSourceTreeSha: legacySha,
    })))

    const result = await upgradePlugin('upg-noop')
    expect(result.noop).toBe(true)
    expect(result.before).toEqual(result.after)

    const entry = readPluginLockfile().plugins['upg-noop']!
    const canonical = computeSourceTreeSha(sourcePath)
    expect(entry.sourceTreeSha).toBe(canonical)
    expect(entry.sourceTreeShaAlgo).toBe(SOURCE_TREE_SHA_ALGO)
    expect(entry.lastSourceTreeSha).toBe(canonical)
  })

  it('legacy row + genuinely changed source: full upgrade runs and stamps the canonical algo', async () => {
    const sourcePath = join(testDir, 'src-upg-changed')
    const pluginDir = join(testDir, 'plugins', 'upg-changed')
    writeFixturePlugin(sourcePath, { id: 'upg-changed', version: '1.0.0' })
    writeFixturePlugin(pluginDir, { id: 'upg-changed', version: '1.0.0' })
    const legacySha = legacySourceTreeSha(sourcePath)
    writePluginLockfile(addPlugin(readPluginLockfile(), 'upg-changed', localEntry({
      sourcePath,
      version: '1.0.0',
      sourceTreeSha: legacySha,
    })))

    writeFixturePlugin(sourcePath, { id: 'upg-changed', version: '1.1.0' })

    const result = await upgradePlugin('upg-changed')
    expect(result.noop).toBe(false)
    expect(result.after.version).toBe('1.1.0')

    const entry = readPluginLockfile().plugins['upg-changed']!
    expect(entry.sourceTreeSha).toBe(computeSourceTreeSha(sourcePath))
    expect(entry.sourceTreeShaAlgo).toBe(SOURCE_TREE_SHA_ALGO)
  })
})
