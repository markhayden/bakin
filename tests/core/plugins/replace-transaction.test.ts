/**
 * The plugin replace transaction (spec plugin-managed-binaries S4/S14):
 *  - success commits with no sentinel and no backup left behind;
 *  - ANY failure (build, second bin, ledger) restores the previous directory
 *    byte for byte, deletes the bins this operation created (never a shared,
 *    pre-existing one), and puts the ledger row back;
 *  - boot recovery resolves every on-disk state an interrupted operation can
 *    leave — captured as real snapshots of the tree mid-transaction — to the
 *    same pre-operation state, and is idempotent;
 *  - the loader predicate hides backups, staging dirs and sentinel dirs.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID, createHash } from 'crypto'

const runId = `${Date.now()}-${randomUUID()}`
const testDir = join(tmpdir(), `bakin-test-replace-tx-${runId}`)
const snapRoot = join(tmpdir(), `bakin-test-replace-snaps-${runId}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

// Mutable root: recovery tests point the content dir at a snapshot of the
// tree captured mid-transaction and run recovery THERE.
let currentRoot = testDir
const paths = () => ({ root: currentRoot, home: currentRoot, bin: join(currentRoot, 'bin'), db: join(currentRoot, 'bakin.db'), media: join(currentRoot, 'media') })
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => currentRoot, getBakinPaths: paths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => currentRoot, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(currentRoot, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(currentRoot, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))

import {
  BACKUP_PREFIX,
  INSTALL_SENTINEL,
  pluginBackupDir,
  replacePluginDir,
  type ReplacePluginDirArgs,
} from '../../../src/core/plugins/replace-transaction'
import { isLoadableUserPluginDir, recoverInterruptedPluginOps } from '../../../src/core/plugins/install-recovery'
import { withInstallLock } from '../../../src/core/install-core/install-lock'
import { addPlugin, readPluginLockfile, writePluginLockfile, type PluginLockEntry } from '../../../packages/core/src/plugins/lockfile'
import { readInstalledBy } from '../../../packages/core/src/agent-packages/markers'
import { treeDigest } from '../../helpers/tree-digest'

const ONE = '#!/bin/sh\necho one\n'
const TWO = '#!/bin/sh\necho two\n'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const platform = `${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
let server: { port: number; stop: (f?: boolean) => void }
let NativeResponse: typeof Response
let failTwo = false
let onRequest: ((name: string) => void) | null = null
const bin = (name: string, script: string) => ({
  name, version: '1.0.0', install: { [platform]: { url: `http://127.0.0.1:${server.port}/${name}`, sha256: sha256(script) } },
})
const ID = 'txplug'
const pluginsRoot = () => join(currentRoot, 'plugins')
const pluginDir = () => join(pluginsRoot(), ID)
const binPath = (name: string) => join(currentRoot, 'bin', name)

const entry = (version: string): PluginLockEntry => ({
  source: '/src', type: 'local', ref: '', commitSha: '', installedAt: '2026-09-01T00:00:00.000Z',
  version, permissions: [], manifestSha: 'a'.repeat(64),
})

/** Lay down a committed v1 install: directory + ledger row. */
function seedPrevious(): void {
  mkdirSync(join(pluginDir(), 'dist'), { recursive: true })
  writeFileSync(join(pluginDir(), 'bakin-plugin.json'), JSON.stringify({ id: ID, version: '1.0.0' }))
  writeFileSync(join(pluginDir(), 'index.ts'), 'export default 1\n')
  writeFileSync(join(pluginDir(), 'dist', 'index.js'), 'v1 bundle\n')
  writePluginLockfile(addPlugin(readPluginLockfile(), ID, entry('1.0.0')))
}

const placeV2 = (dir: string): void => {
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify({ id: ID, version: '2.0.0' }))
  writeFileSync(join(dir, 'index.ts'), 'export default 2\n')
}

function run(overrides: Partial<ReplacePluginDirArgs>) {
  return withInstallLock(() => replacePluginDir({
    id: ID,
    op: 'upgrade',
    place: placeV2,
    bins: [],
    binIdentity: { pluginId: ID, version: '2.0.0', ref: '', commitSha: '' },
    ledger: () => { writePluginLockfile(addPlugin(readPluginLockfile(), ID, entry('2.0.0'))) },
    ...overrides,
  }))
}

function expectPristine(before: { tree: Record<string, string>; row: PluginLockEntry | undefined }): void {
  expect(treeDigest(pluginDir())).toEqual(before.tree)
  expect(readPluginLockfile().plugins[ID] ?? null).toEqual<unknown>(before.row ?? null)
  expect(existsSync(pluginBackupDir(pluginsRoot(), ID))).toBe(false)
  expect(existsSync(join(pluginDir(), INSTALL_SENTINEL))).toBe(false)
  for (const name of ['one', 'two']) {
    expect(existsSync(binPath(name))).toBe(false)
    expect(existsSync(`${binPath(name)}.installedBy`)).toBe(false)
  }
}

beforeAll(async () => {
  NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
  server = (Bun as unknown as { serve: (o: unknown) => typeof server }).serve({
    port: 0,
    fetch: (req: Request) => {
      const name = new URL(req.url).pathname.slice(1)
      onRequest?.(name)
      if (name === 'two' && failTwo) return new NativeResponse('nope', { status: 500 })
      return new NativeResponse(name === 'one' ? ONE : TWO)
    },
  })
})
afterAll(() => {
  server.stop(true)
  rmSync(testDir, { recursive: true, force: true })
  rmSync(snapRoot, { recursive: true, force: true })
})
beforeEach(() => {
  currentRoot = testDir
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  failTwo = false
  onRequest = null
})

describe('replacePluginDir', () => {
  it('requires the install lock', async () => {
    await expect(replacePluginDir({
      id: ID, op: 'install', place: placeV2, bins: [], binIdentity: { pluginId: ID, version: '1', ref: '', commitSha: '' }, ledger: () => {},
    })).rejects.toThrow(/install lock/)
  })

  it('install: place → build → bins → ledger, then commits with no sentinel and no backup', async () => {
    const steps: string[] = []
    const result = await run({
      op: 'install',
      place: (dir) => { steps.push('place'); placeV2(dir) },
      build: async () => { steps.push('build') },
      bins: [bin('one', ONE), bin('two', TWO)],
      ledger: (bins) => { steps.push(`ledger:${bins.map((b) => b.name).join(',')}`); writePluginLockfile(addPlugin(readPluginLockfile(), ID, entry('2.0.0'))) },
    })
    expect(steps).toEqual(['place', 'build', 'ledger:one,two'])
    expect(result.installedBins.map((b) => b.created)).toEqual([true, true])
    expect(readFileSync(binPath('one'), 'utf-8')).toBe(ONE)
    expect(readInstalledBy(binPath('two'))?.package).toBe(`plugin:${ID}`)
    expect(existsSync(join(pluginDir(), INSTALL_SENTINEL))).toBe(false)
    expect(existsSync(pluginBackupDir(pluginsRoot(), ID))).toBe(false)
    expect(readPluginLockfile().plugins[ID]?.version).toBe('2.0.0')
  })

  it('upgrade: a build failure restores the previous tree byte for byte, drops created bins + markers, keeps the ledger row', async () => {
    seedPrevious()
    const before = { tree: treeDigest(pluginDir()), row: readPluginLockfile().plugins[ID] }
    await expect(run({ build: async () => { throw new Error('tsc exploded') } })).rejects.toThrow('tsc exploded')
    expectPristine(before)
  })

  it('a failure on the second bin removes the first created bin but never a pre-existing identically pinned one', async () => {
    seedPrevious()
    // `two` already sits on disk at the pinned sha with no owner — shared.
    mkdirSync(join(testDir, 'bin'), { recursive: true })
    writeFileSync(binPath('two'), TWO, { mode: 0o755 })
    const before = { tree: treeDigest(pluginDir()), row: readPluginLockfile().plugins[ID] }
    await expect(run({
      bins: [bin('one', ONE), bin('two', TWO)],
      ledger: () => { throw new Error('ledger down') },
    })).rejects.toThrow('ledger down')
    expect(treeDigest(pluginDir())).toEqual(before.tree)
    expect(readPluginLockfile().plugins[ID] ?? null).toEqual<unknown>(before.row ?? null)
    expect(existsSync(binPath('one'))).toBe(false)
    expect(existsSync(`${binPath('one')}.installedBy`)).toBe(false)
    expect(readFileSync(binPath('two'), 'utf-8')).toBe(TWO) // shared bin survives
  })

  it('a ledger step that wrote the new row and then failed leaves the OLD row', async () => {
    seedPrevious()
    const before = { tree: treeDigest(pluginDir()), row: readPluginLockfile().plugins[ID] }
    await expect(run({
      ledger: () => {
        writePluginLockfile(addPlugin(readPluginLockfile(), ID, entry('2.0.0')))
        throw new Error('skills projection failed')
      },
    })).rejects.toThrow('skills projection failed')
    expectPristine(before)
  })

  it('a first install that fails leaves no directory and no ledger row', async () => {
    await expect(run({ op: 'install', bins: [bin('one', ONE)], ledger: () => { throw new Error('nope') } })).rejects.toThrow('nope')
    expect(existsSync(pluginDir())).toBe(false)
    expect(readPluginLockfile().plugins[ID]).toBeUndefined()
    expect(existsSync(binPath('one'))).toBe(false)
  })
})

describe('boot recovery from interrupted operations', () => {
  /** Copy the whole home as it is RIGHT NOW — the tree a killed process would leave. */
  const snapshot = (name: string): string => {
    const dir = join(snapRoot, name)
    rmSync(dir, { recursive: true, force: true })
    cpSync(testDir, dir, { recursive: true })
    return dir
  }

  it('every mid-transaction state recovers to the pre-operation state, idempotently', async () => {
    seedPrevious()
    const before = { tree: treeDigest(pluginDir()), row: readPluginLockfile().plugins[ID] }
    const snaps: Record<string, string> = {}
    onRequest = (name) => { if (name === 'two') snaps['after-first-bin'] = snapshot('after-first-bin') }
    await run({
      build: async () => { snaps['after-place-build'] = snapshot('after-place-build') },
      bins: [bin('one', ONE), bin('two', TWO)],
      ledger: () => {
        writePluginLockfile(addPlugin(readPluginLockfile(), ID, entry('2.0.0')))
        snaps['after-ledger'] = snapshot('after-ledger')
      },
    })
    expect(Object.keys(snaps).sort()).toEqual(['after-first-bin', 'after-ledger', 'after-place-build'])

    for (const [state, dir] of Object.entries(snaps)) {
      currentRoot = dir
      expect(existsSync(join(pluginDir(), INSTALL_SENTINEL)), state).toBe(true)
      expect(recoverInterruptedPluginOps(pluginsRoot()).recovered, state).toEqual([ID])
      expectPristine(before)
      expect(recoverInterruptedPluginOps(pluginsRoot()).recovered, `${state} (second pass)`).toEqual([])
    }
  })

  it('died between the rename-aside and the sentinel write → the backup comes back', () => {
    seedPrevious()
    const before = { tree: treeDigest(pluginDir()), row: readPluginLockfile().plugins[ID] }
    renameSync(pluginDir(), pluginBackupDir(pluginsRoot(), ID))
    expect(recoverInterruptedPluginOps(pluginsRoot()).recovered).toEqual([ID])
    expectPristine(before)
  })

  it('died between the sentinel removal and the backup deletion → the committed dir stays, the backup goes', () => {
    seedPrevious()
    cpSync(pluginDir(), pluginBackupDir(pluginsRoot(), ID), { recursive: true })
    placeV2(pluginDir())
    const committed = treeDigest(pluginDir())
    expect(recoverInterruptedPluginOps(pluginsRoot()).recovered).toEqual([ID])
    expect(treeDigest(pluginDir())).toEqual(committed)
    expect(existsSync(pluginBackupDir(pluginsRoot(), ID))).toBe(false)
  })

  it('a new operation on the same id first clears leftovers from an interrupted one', async () => {
    seedPrevious()
    renameSync(pluginDir(), pluginBackupDir(pluginsRoot(), ID))
    await run({})
    expect(readPluginLockfile().plugins[ID]?.version).toBe('2.0.0')
    expect(existsSync(pluginBackupDir(pluginsRoot(), ID))).toBe(false)
    expect(existsSync(join(pluginDir(), INSTALL_SENTINEL))).toBe(false)
  })

  it('an unreadable sentinel still rolls the directory back to its backup', () => {
    seedPrevious()
    const before = { tree: treeDigest(pluginDir()), row: readPluginLockfile().plugins[ID] }
    renameSync(pluginDir(), pluginBackupDir(pluginsRoot(), ID))
    mkdirSync(pluginDir())
    writeFileSync(join(pluginDir(), INSTALL_SENTINEL), '{not json')
    writeFileSync(join(pluginDir(), 'half.ts'), 'partial')
    expect(recoverInterruptedPluginOps(pluginsRoot()).recovered).toEqual([ID])
    expectPristine(before)
  })
})

describe('isLoadableUserPluginDir', () => {
  it('hides backups, staging clones, sentinel dirs and plain files; shows committed dirs', () => {
    mkdirSync(join(pluginsRoot(), `${BACKUP_PREFIX}foo`), { recursive: true })
    mkdirSync(join(pluginsRoot(), '.upgrade-staging-foo-1'), { recursive: true })
    mkdirSync(join(pluginsRoot(), 'inflight'), { recursive: true })
    writeFileSync(join(pluginsRoot(), 'inflight', INSTALL_SENTINEL), '{}')
    mkdirSync(join(pluginsRoot(), 'good'), { recursive: true })
    writeFileSync(join(pluginsRoot(), 'stray.txt'), '')
    expect(isLoadableUserPluginDir(pluginsRoot(), `${BACKUP_PREFIX}foo`)).toBe(false)
    expect(isLoadableUserPluginDir(pluginsRoot(), '.upgrade-staging-foo-1')).toBe(false)
    expect(isLoadableUserPluginDir(pluginsRoot(), 'inflight')).toBe(false)
    expect(isLoadableUserPluginDir(pluginsRoot(), 'stray.txt')).toBe(false)
    expect(isLoadableUserPluginDir(pluginsRoot(), 'missing')).toBe(false)
    expect(isLoadableUserPluginDir(pluginsRoot(), 'good')).toBe(true)
  })
})
