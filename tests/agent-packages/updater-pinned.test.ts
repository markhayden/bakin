/**
 * Self-healing PR1 slice 1.2: the updater can fetch the IMMUTABLE commit the
 * caller names (`expected.sha`) and re-stage a same-commit reinstall — the
 * repair for an installed manifest that no longer parses while upstream still
 * ships valid bytes at the recorded commit (spec §3.6, plan R2 B3).
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-updater-pinned-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentRuntimeAdapter, RuntimeSkill } from '@bakin/core/adapters/runtime'

mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') }), isUsingBakinHome: () => true }))
mock.module('@bakin/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') }), isUsingBakinHome: () => true }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => openClawDir, getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts), resetOpenClawHome: () => {} }))

// A fake upstream: sha → directory whose bytes the fetch stages. `main` is
// the branch head. The real module is spread so every other export stays real.
import * as realFetcher from '../../src/core/agent-packages/source-fetcher'
// Captured BEFORE the overlay: the namespace is live-bound and would otherwise resolve to the fake.
const realFetchSourceAsync = realFetcher.fetchSourceAsync
const upstream = new Map<string, { dir: string; sha: string }>()
const fetchCalls: Array<{ source: string; options: unknown }> = []
mock.module('../../src/core/agent-packages/source-fetcher', () => ({
  ...realFetcher,
  fetchSourceAsync: async (source: string, options: unknown = {}) => {
    if (!realFetcher.isGithubSource(source)) return realFetchSourceAsync(source, options as never)
    fetchCalls.push({ source, options })
    const spec = realFetcher.parseGithubSpec(source)
    const target = upstream.get(spec.ref ?? 'main')
    if (!target) throw new Error(`fatal: reference is not a tree: ${spec.ref}`)
    const staging = join(testDir, 'staging', randomUUID())
    mkdirSync(staging, { recursive: true })
    cpSync(target.dir, staging, { recursive: true })
    return { stagingDir: staging, commitSha: target.sha, kind: 'github', ref: spec.ref ?? '' }
  },
}))

import { installPackage as installPackageUnowned } from '../../src/core/agent-packages/installer'
import { updatePackageById as updatePackageByIdUnowned } from '../../src/core/agent-packages/updater'
import { syncPack as syncPackUnowned } from '../../src/core/agent-packages/sync'
import { readLockfile, writeLockfile } from '../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../packages/core/src/agent-packages/package-paths'
import { computeDirSha } from '../../packages/core/src/agent-packages/markers'
import { owned } from '../helpers/owning'

const installPackage = owned(installPackageUnowned)
const updatePackageById = owned(updatePackageByIdUnowned)
const syncPack = owned(syncPackUnowned)

function installRuntimeMock(): void {
  const skills = new Map<string, RuntimeSkill>()
  const runtime = {
    agents: { listWorkspaceFiles: async () => [], list: async () => [], get: async () => null, heartbeat: async () => true },
    skills: {
      list: async () => [...skills.values()],
      get: async (name: string) => skills.get(name) ?? null,
      write: async (skill: RuntimeSkill) => { skills.set(skill.name, skill) },
      remove: async (name: string) => { skills.delete(name) },
    },
  } as unknown as AgentRuntimeAdapter
  ;(globalThis as typeof globalThis & { __bakinAppServices?: unknown }).__bakinAppServices = { runtime }
}

function writePack(dir: string, version: string, opts: { brokenManifest?: boolean } = {}): void {
  mkdirSync(join(dir, 'skills', 'ocr'), { recursive: true })
  const manifest = { id: 'ocr', kind: 'skill-pack', name: 'OCR', version, contributions: { skills: ['skills/ocr'] } }
  writeFileSync(join(dir, 'bakin-package.json'), opts.brokenManifest ? '{ "id": "ocr", "kind": "skill-pack", "version": ' : JSON.stringify(manifest))
  writeFileSync(join(dir, 'skills', 'ocr', 'SKILL.md'), `---\nname: ocr\n---\n\nOCR v${version}\n`)
}

const PKG = 'ocr@0.1.0'
const RECORDED = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

beforeEach(async () => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(openClawDir, { recursive: true })
  upstream.clear(); fetchCalls.length = 0
  installRuntimeMock()
  // Install from a local copy, then make the lock say it came from GitHub at RECORDED on `main`.
  const local = join(testDir, 'local-ocr'); writePack(local, '0.1.0')
  await installPackage({ source: local })
  const lock = readLockfile()
  const entry = lock.packages[PKG]!
  writeLockfile({ ...lock, packages: { ...lock.packages, [PKG]: { ...entry, source: 'github:acme/bits#packs/ocr', ref: 'main', commitSha: RECORDED } } })
  // Upstream: the recorded commit still ships the valid 0.1.0 bytes; `main` has moved on to 0.1.1.
  const recordedDir = join(testDir, 'upstream-recorded'); writePack(recordedDir, '0.1.0'); upstream.set(RECORDED, { dir: recordedDir, sha: RECORDED })
  const headDir = join(testDir, 'upstream-head'); writePack(headDir, '0.1.1'); upstream.set('main', { dir: headDir, sha: HEAD })
})

const installedManifestPath = () => join(getPackageSourceDir(testDir, 'skill-pack', 'ocr', '0.1.0'), 'bakin-package.json')

describe('updatePackageById — expected sha + reinstall', () => {
  it('a corrupt installed manifest is repaired at the RECORDED commit although the branch advanced', async () => {
    writeFileSync(installedManifestPath(), '{ "id": "ocr", "kind": "skill-pack", "version": ')
    expect(() => JSON.parse(readFileSync(installedManifestPath(), 'utf-8'))).toThrow()

    const result = await updatePackageById({ packageId: PKG, expected: { sha: RECORDED }, reinstall: true })

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]!.source).toBe(`github:acme/bits@${RECORDED}#packs/ocr`)
    expect(fetchCalls[0]!.options).toMatchObject({ fresh: true })
    expect(result).toMatchObject({ changed: true, fromCommitSha: RECORDED, toCommitSha: RECORDED, fromVersion: '0.1.0', toVersion: '0.1.0' })
    expect(JSON.parse(readFileSync(installedManifestPath(), 'utf-8')).version).toBe('0.1.0')
    const entry = readLockfile().packages[PKG]!
    expect(entry.commitSha).toBe(RECORDED)
    expect(entry.ref).toBe('main') // the branch the operator installed from stays the ref; a pin never becomes permanent
  })

  it('an unavailable commit refuses before anything changes', async () => {
    const before = readFileSync(installedManifestPath(), 'utf-8')
    await expect(updatePackageById({ packageId: PKG, expected: { sha: 'c'.repeat(40) }, reinstall: true }))
      .rejects.toThrow(/not available upstream.*nothing was changed/i)
    expect(readFileSync(installedManifestPath(), 'utf-8')).toBe(before)
    expect(readLockfile().packages[PKG]!.commitSha).toBe(RECORDED)
    expect(existsSync(join(testDir, 'staging'))).toBe(false)
  })

  it('a fetch that resolves to a different commit than requested is refused', async () => {
    upstream.set('d'.repeat(40), { dir: upstream.get('main')!.dir, sha: 'e'.repeat(40) })
    await expect(updatePackageById({ packageId: PKG, expected: { sha: 'd'.repeat(40) } }))
      .rejects.toThrow(/fetched e{40}.*d{40} was requested/i)
    expect(readLockfile().packages[PKG]!.commitSha).toBe(RECORDED)
  })

  it('without reinstall, the same commit is still a no-op; a reinstall WITHOUT expected pins to the RECORDED commit, never the moved branch head', async () => {
    upstream.set('main', { dir: upstream.get(RECORDED)!.dir, sha: RECORDED })
    expect((await updatePackageById({ packageId: PKG })).changed).toBe(false)
    upstream.set('main', { dir: join(testDir, 'upstream-head'), sha: HEAD })
    fetchCalls.length = 0
    // The production repair (`package-reinstall` → syncPack({ reinstall: true })) names no sha: the lockfile's commit IS the pin.
    const result = await updatePackageById({ packageId: PKG, reinstall: true })
    expect(fetchCalls.map((call) => call.source)).toEqual([`github:acme/bits@${RECORDED}#packs/ocr`])
    expect(result).toMatchObject({ changed: true, toCommitSha: RECORDED, toVersion: '0.1.0' })
    expect(readLockfile().packages[PKG]!.commitSha).toBe(RECORDED)
    // An ordinary update (no reinstall) still follows the branch.
    expect(await updatePackageById({ packageId: PKG })).toMatchObject({ changed: true, toCommitSha: HEAD, toVersion: '0.1.1' })
  })

  it('a local source pins by tree digest: a matching digest reinstalls, a different one is refused, and no digest re-projects in place', async () => {
    const local = join(testDir, 'local-ocr')
    const lock = readLockfile()
    writeLockfile({ ...lock, packages: { ...lock.packages, [PKG]: { ...lock.packages[PKG]!, source: local, ref: '', commitSha: '' } } })
    writeFileSync(installedManifestPath(), '{ "id": "ocr", "kind": "skill-pack", "version": ')

    await expect(updatePackageById({ packageId: PKG, expected: { sha: 'f'.repeat(64) }, reinstall: true }))
      .rejects.toThrow(/fetched [0-9a-f]{64} but f{64} was requested/i)
    expect(() => JSON.parse(readFileSync(installedManifestPath(), 'utf-8'))).toThrow() // refused before any write

    const repaired = await updatePackageById({ packageId: PKG, expected: { sha: computeDirSha(local) }, reinstall: true })
    expect(repaired).toMatchObject({ changed: true, toVersion: '0.1.0' })
    expect(JSON.parse(readFileSync(installedManifestPath(), 'utf-8')).version).toBe('0.1.0')

    // No recorded commit and no expected digest: a local reinstall re-projects what the directory holds now.
    expect(await updatePackageById({ packageId: PKG, reinstall: true })).toMatchObject({ changed: true, toCommitSha: '' })
  })
})

describe('syncPack passes the pin through', () => {
  it('syncPack({ expected, reinstall }) repairs in place and reports the recorded commit', async () => {
    writeFileSync(installedManifestPath(), 'not json')
    const receipt = await syncPack(PKG, { expected: { sha: RECORDED }, reinstall: true })
    expect(receipt).toMatchObject({ changed: true, commitAfter: RECORDED, versionAfter: '0.1.0' })
    expect(fetchCalls[0]!.source).toBe(`github:acme/bits@${RECORDED}#packs/ocr`)
  })
})
