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
import { cpSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { basename, join } from 'path'
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
  copyLocalSource,
  localTransferPolicy,
  compareStoredSourceTreeSha,
  computeSourceTreeSha,
  legacySourceTreeSha,
} from '../../../src/core/plugins/source-tree-sha'
import { runChecks, upgradePlugin as upgradePluginUnowned } from '../../../src/core/plugins/upgrade'
import { owned } from '../../helpers/owning'

// The core install writers assert install-state ownership (#895): call them as an owner.
const upgradePlugin = owned(upgradePluginUnowned)

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

/** Where the fixture's "installed" copy of a source lives (the baseline a legacy-row migration measures against). */
function installedOf(sourceDir: string): string {
  return join(testDir, 'installed', basename(sourceDir))
}

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

describe('computeSourceTreeSha — the lockfile hasher (algo 3)', () => {
  it('covers exactly the transfer set: dot entries and nested dist/node_modules are in, root dist/.git, the install sentinel and a REGENERATED root node_modules are out (#1007 review r8 #2)', () => {
    const dir = join(testDir, 'transfer-set')
    writeFixturePlugin(dir, { id: 'transfer-set', version: '1.0.0' })
    // Declared dependencies: the build regenerates root node_modules, so it is outside the transfer (and the digest).
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'transfer-set', version: '1.0.0', dependencies: { lodash: '^4' } }), 'utf-8')
    const base = computeSourceTreeSha(dir)
    // Runtime inputs install keeps are part of the identity…
    writeFileSync(join(dir, '.runtime.json'), '{"a":1}', 'utf-8')
    const withDot = computeSourceTreeSha(dir)
    expect(withDot).not.toBe(base)
    mkdirSync(join(dir, 'assets', 'dist'), { recursive: true })
    writeFileSync(join(dir, 'assets', 'dist', 'schema.json'), '{}', 'utf-8')
    const withNested = computeSourceTreeSha(dir)
    expect(withNested).not.toBe(withDot)
    // …while regenerated / non-runtime root trees and the transaction's own marker never are.
    mkdirSync(join(dir, 'dist'), { recursive: true })
    writeFileSync(join(dir, 'dist', 'index.js'), 'built', 'utf-8')
    mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), 'dep', 'utf-8')
    mkdirSync(join(dir, '.git'), { recursive: true })
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main', 'utf-8')
    writeFileSync(join(dir, '.bakin-install.json'), '{}', 'utf-8')
    expect(computeSourceTreeSha(dir)).toBe(withNested)
    // The Whiskit provenance formula answers a different question and differs on purpose (dot entries, nested dist).
    expect(computeSourceTreeSha(dir)).not.toBe(hashSourceTree(dir))
  })

  it('an algo-2 (Whiskit formula) row migrates once when the source is unchanged, and still reports a real change', () => {
    const dir = join(testDir, 'algo2')
    writeFixturePlugin(dir, { id: 'algo2', version: '1.0.0' })
    const stored = hashSourceTree(dir)
    // What was installed under algo 2: a copy of the source as it was then.
    cpSync(dir, installedOf(dir), { recursive: true })
    const same = compareStoredSourceTreeSha({ sourceTreeSha: stored, sourceTreeShaAlgo: 2 }, dir, installedOf(dir))
    expect(same.changed).toBe(false)
    expect(same.needsAlgoMigration).toBe(true)
    expect(same.liveSha).toBe(computeSourceTreeSha(dir))
    writeFileSync(join(dir, 'extra.txt'), 'new content', 'utf-8')
    const diff = compareStoredSourceTreeSha({ sourceTreeSha: stored, sourceTreeShaAlgo: 2 }, dir, installedOf(dir))
    expect(diff.changed).toBe(true)
    expect(diff.needsAlgoMigration).toBe(false)
  })

  it('review r9 #2: a legacy row whose source changed ONLY in a path the old formula never covered is reported changed — the installed tree is the baseline, never the live source', () => {
    const dir = join(testDir, 'algo2-dotfile')
    writeFixturePlugin(dir, { id: 'algo2-dotfile', version: '1.0.0' })
    const stored = hashSourceTree(dir)
    cpSync(dir, installedOf(dir), { recursive: true })
    // The Whiskit formula ignores dot entries and nested dist: it still says "unchanged".
    writeFileSync(join(dir, '.runtime.json'), '{"changed":true}', 'utf-8')
    expect(hashSourceTree(dir)).toBe(stored)
    const cmp = compareStoredSourceTreeSha({ sourceTreeSha: stored, sourceTreeShaAlgo: 2 }, dir, installedOf(dir))
    expect(cmp.changed).toBe(true)
    expect(cmp.needsAlgoMigration).toBe(false)
    // …and the same through the check surface: an upgrade is offered, the install-time record is untouched.
    const nested = join(testDir, 'algo2-nested')
    writeFixturePlugin(nested, { id: 'algo2-nested', version: '1.0.0' })
    const storedNested = hashSourceTree(nested)
    cpSync(nested, installedOf(nested), { recursive: true })
    mkdirSync(join(nested, 'assets', 'dist'), { recursive: true })
    writeFileSync(join(nested, 'assets', 'dist', 'schema.json'), '{}', 'utf-8')
    expect(compareStoredSourceTreeSha({ sourceTreeSha: storedNested, sourceTreeShaAlgo: 2 }, nested, installedOf(nested)).changed).toBe(true)
    // A missing installed tree can never vouch for anything: changed.
    expect(compareStoredSourceTreeSha({ sourceTreeSha: stored, sourceTreeShaAlgo: 2 }, dir, join(testDir, 'nowhere')).changed).toBe(true)
  })

  it('review r10 #2: an unchanged legacy source with declared dependencies migrates even though the installed copy carries the installer-generated bun.lock, dist and node_modules', () => {
    const dir = join(testDir, 'algo2-built')
    writeFixturePlugin(dir, { id: 'algo2-built', version: '1.0.0' })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'algo2-built', version: '1.0.0', dependencies: { lodash: '^4' } }), 'utf-8')
    const stored = hashSourceTree(dir)
    const installed = installedOf(dir)
    cpSync(dir, installed, { recursive: true })
    // What the build left behind: the lockfile it wrote, its output, its dependencies.
    writeFileSync(join(installed, 'bun.lock'), '{"lockfileVersion":1}', 'utf-8')
    mkdirSync(join(installed, 'dist'), { recursive: true })
    writeFileSync(join(installed, 'dist', 'index.js'), 'built', 'utf-8')
    mkdirSync(join(installed, 'node_modules', 'lodash'), { recursive: true })
    writeFileSync(join(installed, 'node_modules', 'lodash', 'index.js'), 'module.exports = {}', 'utf-8')
    const cmp = compareStoredSourceTreeSha({ sourceTreeSha: stored, sourceTreeShaAlgo: 2 }, dir, installed)
    expect(cmp.changed).toBe(false)
    expect(cmp.needsAlgoMigration).toBe(true)
    // A lockfile the SOURCE ships is compared like any other file.
    writeFileSync(join(dir, 'bun.lock'), '{"lockfileVersion":1,"changed":true}', 'utf-8')
    expect(compareStoredSourceTreeSha({ sourceTreeSha: hashSourceTree(dir), sourceTreeShaAlgo: 2 }, dir, installed).changed).toBe(true)
  })

  it('review r9 #3: root node_modules is vendored (transferred + hashed) when the package declares no dependencies, regenerated (skipped) when it does', () => {
    const vendored = join(testDir, 'vendored')
    writeFixturePlugin(vendored, { id: 'vendored', version: '1.0.0' })
    writeFileSync(join(vendored, 'package.json'), JSON.stringify({ name: 'vendored', version: '1.0.0' }), 'utf-8')
    const before = computeSourceTreeSha(vendored)
    mkdirSync(join(vendored, 'node_modules', 'lib'), { recursive: true })
    writeFileSync(join(vendored, 'node_modules', 'lib', 'index.js'), 'export const lib = 1', 'utf-8')
    expect(localTransferPolicy(vendored).regeneratesModules).toBe(false)
    expect(computeSourceTreeSha(vendored)).not.toBe(before)
    const copy = join(testDir, 'vendored-copy')
    copyLocalSource(vendored, copy)
    expect(existsSync(join(copy, 'node_modules', 'lib', 'index.js'))).toBe(true)
    expect(computeSourceTreeSha(copy)).toBe(computeSourceTreeSha(vendored))

    const declared = join(testDir, 'declared')
    writeFixturePlugin(declared, { id: 'declared', version: '1.0.0' })
    writeFileSync(join(declared, 'package.json'), JSON.stringify({ name: 'declared', version: '1.0.0', dependencies: { lodash: '^4' } }), 'utf-8')
    const baseline = computeSourceTreeSha(declared)
    mkdirSync(join(declared, 'node_modules', 'lodash'), { recursive: true })
    writeFileSync(join(declared, 'node_modules', 'lodash', 'index.js'), 'module.exports = {}', 'utf-8')
    expect(localTransferPolicy(declared).regeneratesModules).toBe(true)
    expect(computeSourceTreeSha(declared)).toBe(baseline)
    const declaredCopy = join(testDir, 'declared-copy')
    copyLocalSource(declared, declaredCopy)
    expect(existsSync(join(declaredCopy, 'node_modules'))).toBe(false)
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
    const cmp = compareStoredSourceTreeSha({ sourceTreeSha: stored }, dir, dir)
    expect(cmp.changed).toBe(false)
    expect(cmp.needsAlgoMigration).toBe(true)
    expect(cmp.liveSha).toBe(computeSourceTreeSha(dir))
  })

  it('genuinely changed source with a legacy-algo stored sha: still detected, no migration', () => {
    const dir = join(testDir, 'legacy-changed')
    writeFixturePlugin(dir, { id: 'legacy-changed', version: '1.0.0' })
    const stored = legacySourceTreeSha(dir)
    writeFileSync(join(dir, 'extra.txt'), 'new content', 'utf-8')
    const cmp = compareStoredSourceTreeSha({ sourceTreeSha: stored }, dir, dir)
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
      dir,
    )
    expect(same.changed).toBe(false)
    expect(same.needsAlgoMigration).toBe(false)

    writeFileSync(join(dir, 'extra.txt'), 'new content', 'utf-8')
    const diff = compareStoredSourceTreeSha(
      { sourceTreeSha: stored, sourceTreeShaAlgo: SOURCE_TREE_SHA_ALGO },
      dir,
      dir,
    )
    expect(diff.changed).toBe(true)
    expect(diff.needsAlgoMigration).toBe(false)
  })

  it('a missing stored sha reports changed (install-time semantics preserved)', () => {
    const dir = join(testDir, 'no-sha')
    writeFixturePlugin(dir, { id: 'no-sha', version: '1.0.0' })
    const cmp = compareStoredSourceTreeSha({ sourceTreeSha: undefined }, dir, dir)
    expect(cmp.changed).toBe(true)
    expect(cmp.needsAlgoMigration).toBe(false)
  })
})

describe('runChecks — one-time lockfile migration on --check', () => {
  it('legacy row + unchanged source: reports no upgrade and rewrites the row once', async () => {
    const sourcePath = join(testDir, 'src-check-noop')
    writeFixturePlugin(sourcePath, { id: 'check-noop', version: '1.0.0' })
    writeFixturePlugin(join(testDir, 'plugins', 'check-noop'), { id: 'check-noop', version: '1.0.0' })
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
    writeFixturePlugin(join(testDir, 'plugins', 'check-changed'), { id: 'check-changed', version: '1.0.0' })
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
    // The lane writes installed provenance only: the --check marker is left exactly as the row had it (the updates engine owns "is there something newer", #1007 B).
    expect(entry.lastSourceTreeSha).toBe(legacySha)
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
