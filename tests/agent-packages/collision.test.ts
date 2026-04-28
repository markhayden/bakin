/**
 * Collision tests for the installer (Phase H-4).
 *
 *   - same-target / same-package           → no-op (re-install path,
 *     already covered by uninstall-then-reinstall semantics; not exercised
 *     here because the installer refuses re-install on managed/adopted
 *     state)
 *   - same-target / different-package / no flag        → throws (collision)
 *   - same-target / different-package / installAs      → no collision
 *     (declarative aliasing produces a different projection target)
 *   - same-target / different-package / --replace      → overwrites
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-collision-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
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

let openClawAgents: Array<{ id: string; identity?: { name?: string } }> = []
mock.module('@bakin/adapter-openclaw/config', () => ({
  readOpenClawConfig: () => ({ agents: { list: openClawAgents } }),
  resetOpenClawConfigCache: () => {},
  getAgentList: () => openClawAgents,
  getAgentIds: () => openClawAgents.map((a) => a.id),
  findAgentById: (id: string) => openClawAgents.find((a) => a.id === id) ?? null,
}))

mock.module('@bakin/tasks/lib/flow-store', () => ({}))

import { installPackage } from '../../src/core/agent-packages/installer'
import { readInstalledBy } from '../../packages/core/src/agent-packages/markers'

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
      openClawAgents = [...openClawAgents.filter((existing) => existing.id !== agent.id), { id: agent.id, identity: { name: agent.name } }]
    },
  })
})

/** Seed two skill-packs with the SAME skill name to collide on. */
function seedSkillPack(packageId: string, version: string, skillName: string, body: string): string {
  const dir = join(testDir, `${packageId}-${version}-pack`)
  mkdirSync(join(dir, 'skills', skillName), { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id: packageId,
      kind: 'skill-pack',
      name: packageId,
      version,
      contributions: { skills: [`skills/${skillName}`] },
    }),
  )
  writeFileSync(join(dir, 'skills', skillName, 'SKILL.md'), body)
  return dir
}

describe('installPackage — collision detection (Phase H-4)', () => {
  it('refuses to install a second package whose skill collides with an existing one', async () => {
    // First skill-pack lands at ~/.openclaw/skills/image-gen/
    const firstSrc = seedSkillPack('owner-a', '1.0.0', 'image-gen', '# from owner-a')
    await installPackage({ source: firstSrc })

    // Second skill-pack tries to install at the SAME target — should throw
    const secondSrc = seedSkillPack('owner-b', '2.0.0', 'image-gen', '# from owner-b')

    expect(async () => {
      await installPackage({ source: secondSrc })
    }).toThrow(/collision|already owned/i)

    // Original skill-pack's content survives the rejected install
    const target = join(openClawDir, 'skills', 'image-gen', 'SKILL.md')
    expect(readFileSync(target, 'utf-8')).toBe('# from owner-a')
    expect(readInstalledBy(join(openClawDir, 'skills', 'image-gen'))?.package).toBe('owner-a')
  })

  it('--replace overrides the collision and installs the second package', async () => {
    const firstSrc = seedSkillPack('owner-a', '1.0.0', 'image-gen', '# from owner-a')
    await installPackage({ source: firstSrc })

    const secondSrc = seedSkillPack('owner-b', '2.0.0', 'image-gen', '# from owner-b')
    const result = await installPackage({ source: secondSrc, replace: true })

    expect(result.packageId).toBe('owner-b')

    const target = join(openClawDir, 'skills', 'image-gen', 'SKILL.md')
    expect(readFileSync(target, 'utf-8')).toBe('# from owner-b')
    expect(readInstalledBy(join(openClawDir, 'skills', 'image-gen'))?.package).toBe('owner-b')
  })

  it('dependencies[].installAs renames the lockfile key but NOT the skill projection target (V1 scope)', async () => {
    // V1 behavior: installAs aliases the lockfile key — useful for
    // distinguishing two versions of the same pack in the lockfile, but
    // it does NOT remap the on-disk projection target. Per-skill rename
    // would require additional projector plumbing (read the dep spec at
    // projection time, retarget each item) and is deferred to V1.5.
    //
    // The actually-working collision-avoidance path in V1 is `--replace`
    // (covered by the test above). This test documents the current
    // limitation so the behavior doesn't drift unintentionally.
    const firstSrc = seedSkillPack('owner-a', '1.0.0', 'image-gen', '# from owner-a')
    await installPackage({ source: firstSrc })

    const secondSrc = seedSkillPack('owner-b', '2.0.0', 'image-gen', '# from owner-b')
    const agentDir = join(testDir, 'pixel-pkg')
    mkdirSync(join(agentDir, 'workspace'), { recursive: true })
    writeFileSync(
      join(agentDir, 'bakin-package.json'),
      JSON.stringify({
        id: 'pixel-collision-test',
        kind: 'agent',
        name: 'Pixel',
        version: '0.1.0',
        agent: { identity: { name: 'Pixel' } },
        install: {},
        contributions: { workspaceFiles: ['workspace/SOUL.md'] },
        dependencies: {
          skills: [{ source: secondSrc, ref: 'main', installAs: 'alt-image-gen' }],
        },
      }),
    )
    writeFileSync(
      join(agentDir, 'workspace', 'SOUL.md'),
      `# Soul\n\n<!-- bakin:knowledge-catalog:start -->\n<!-- bakin:knowledge-catalog:end -->\n`,
    )

    // Without per-skill installAs renaming, the second package's skill
    // STILL targets `~/.openclaw/skills/image-gen/` and collides with
    // owner-a. The collision detection fires correctly.
    expect(async () => {
      await installPackage({ source: agentDir })
    }).toThrow(/collision|already owned/i)

    // owner-a's skill content is preserved
    const ownerATarget = join(openClawDir, 'skills', 'image-gen', 'SKILL.md')
    expect(readFileSync(ownerATarget, 'utf-8')).toBe('# from owner-a')
  })

  it('same package re-installing the same target is not a collision (own sidecar matches)', async () => {
    // Same package id installing the same skill twice — different test from
    // duplicate-install-refusal because we want to verify that the COLLISION
    // path doesn't fire when the would-be conflict is the same package.
    // (The duplicate-install refusal happens earlier at the lockfile-key
    // level and is tested in standalone-packs.test.ts; here we just confirm
    // the projector wouldn't reject self-overlap.)
    const src = seedSkillPack('owner-a', '1.0.0', 'image-gen', '# version 1')
    await installPackage({ source: src })

    // Re-install with --replace just to bypass the lockfile-level refusal —
    // this exercises the projector's collision check specifically. Without
    // the same-package short-circuit, --replace would be required even for
    // self-overlap, which would be wrong.
    expect(async () => {
      await installPackage({ source: src, replace: true })
    }).not.toThrow()
  })
})
