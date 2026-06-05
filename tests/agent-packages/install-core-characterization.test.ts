/**
 * Shared install-core characterization gate (Whiskin P0).
 *
 * The agent-package installer is the PROVEN REFERENCE for the shared install
 * core that Whiskin extracts in Phase 5 and that agent packages converge onto
 * in Phase 11. This suite locks — in one place, explicitly labeled — the
 * invariants the shared core MUST preserve, so any drift during the refactor
 * fails here:
 *
 *   1. Atomic staging → install-dir commit (renameSync semantics).
 *   2. Lockfile entry field shape (what the shared lockfile-IO must round-trip).
 *   3. `.installedBy` provenance sidecar content on every projection.
 *   4. Install-lock release after success + mutual exclusion while held.
 *   5. Failed install leaves NO partial state (clean lockfile, no install dir,
 *      no projection, lock released).
 *
 * Broader behavior (deps/refcount, adopt mode, agent-kind runtime creation,
 * `.userEdited` skip on update, post-lockfile-write rollback) is already
 * covered by installer.test.ts / standalone-packs.test.ts / projector.test.ts
 * / markers.test.ts — this file is the consolidated contract, not a duplicate
 * of those. It uses a non-agent kind (skill-pack) so the transaction is
 * exercised without mocking the runtime adapter beyond the shared helper.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-install-core-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { installFilesystemRuntimeAppServices } from '../helpers/runtime-app-services'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/task-store', () => ({}))

import { installPackage } from '../../src/core/agent-packages/installer'
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'
import { readInstalledBy } from '../../packages/core/src/agent-packages/markers'
import {
  acquireInstallLock,
  releaseInstallLock,
  isInstallLockHeld,
} from '../../src/core/agent-packages/install-lock'

let openClawAgents: Array<{ id: string; identity?: { name?: string } }> = []

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  openClawAgents = []
  installFilesystemRuntimeAppServices({
    openClawDir,
    agents: () => openClawAgents,
    onCreateAgent: (agent) => {
      openClawAgents = [
        ...openClawAgents.filter((existing) => existing.id !== agent.id),
        { id: agent.id, identity: { name: agent.name } },
      ]
    },
  })
})

const ID = 'core-gate-skills'
const VERSION = '0.4.2'
const SKILL = 'do-thing'

/** A minimal, valid skill-pack source tree at a local path. */
function seedSkillPack(): string {
  const dir = join(testDir, `${ID}-src`)
  mkdirSync(join(dir, 'skills', SKILL), { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id: ID,
      kind: 'skill-pack',
      name: ID,
      version: VERSION,
      contributions: { skills: [`skills/${SKILL}`] },
    }),
  )
  writeFileSync(join(dir, 'skills', SKILL, 'SKILL.md'), `# ${SKILL}\n\nDo the thing.`)
  return dir
}

const installDir = () => join(testDir, 'packages', 'skill-packs', `${ID}@${VERSION}`)
const skillTarget = () => join(openClawDir, 'skills', SKILL)
const lockKey = `${ID}@${VERSION}`

describe('shared install-core characterization gate (P5/P11)', () => {
  it('commits staging atomically into the canonical install dir', async () => {
    await installPackage({ source: seedSkillPack() })

    // The committed install dir exists with the manifest + source preserved.
    expect(existsSync(join(installDir(), 'bakin-package.json'))).toBe(true)
    expect(existsSync(join(installDir(), 'skills', SKILL, 'SKILL.md'))).toBe(true)
  })

  it('writes a lockfile entry with the field shape the shared lockfile-IO must preserve', async () => {
    await installPackage({ source: seedSkillPack() })

    const entry = readLockfile().packages[lockKey]
    expect(entry).toBeDefined()
    expect(entry.kind).toBe('skill-pack')
    expect(entry.version).toBe(VERSION)
    expect(typeof entry.source).toBe('string')
    expect(typeof entry.ref).toBe('string') // '' for local sources
    expect(typeof entry.commitSha).toBe('string') // '' for local sources
    expect(typeof entry.installedAt).toBe('string')
    expect(entry.projections).toBeDefined()
    expect(entry.projections!.length).toBeGreaterThanOrEqual(1)
    expect(entry.refCount).toBe(0)
    expect(Array.isArray(entry.dependencies)).toBe(true)
    expect(entry.dependencies).toEqual([])
    // No agent-only fields on a non-agent kind.
    expect(entry.agentId).toBeUndefined()
    expect(entry.state).toBeUndefined()
  })

  it('records a .installedBy provenance sidecar on each projection', async () => {
    await installPackage({ source: seedSkillPack() })

    const marker = readInstalledBy(skillTarget())
    expect(marker).not.toBeNull()
    expect(marker?.package).toBe(ID)
    expect(marker?.version).toBe(VERSION)
    expect(typeof marker?.sha256).toBe('string')
    expect(marker?.sha256.length).toBeGreaterThan(0)
  })

  it('releases the install lock after a successful install', async () => {
    await installPackage({ source: seedSkillPack() })
    expect(isInstallLockHeld()).toBe(false)
  })

  it('provides mutual exclusion: install refuses while the lock is held', async () => {
    acquireInstallLock()
    try {
      expect(isInstallLockHeld()).toBe(true)
      await expect(installPackage({ source: seedSkillPack() })).rejects.toThrow(
        /another install is in progress/i,
      )
    } finally {
      releaseInstallLock()
    }
    expect(isInstallLockHeld()).toBe(false)
  })

  it('leaves no partial state when install fails (clean lockfile, no install dir, no projection, lock released)', async () => {
    const src = seedSkillPack()
    // Remove a declared skill dir so integrity validation throws AFTER fetch
    // but the transaction must unwind to a clean slate.
    rmSync(join(src, 'skills', SKILL), { recursive: true, force: true })

    await expect(installPackage({ source: src })).rejects.toThrow()

    expect(Object.keys(readLockfile().packages)).toEqual([])
    expect(existsSync(installDir())).toBe(false)
    expect(existsSync(skillTarget())).toBe(false)
    expect(isInstallLockHeld()).toBe(false)
  })
})
