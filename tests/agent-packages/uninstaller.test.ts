/**
 * Tests for the uninstaller (Phase E-6).
 *
 * Builds on the installer integration setup — install, then remove, then
 * verify the right things were unprojected and the lockfile is consistent.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-uninstaller-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

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
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

let openClawAgents: Array<{ id: string; identity?: { name?: string } }> = []
mock.module('@bakin/core/openclaw-config', () => ({
  readOpenClawConfig: () => ({ agents: { list: openClawAgents } }),
  resetOpenClawConfigCache: () => {},
  getAgentList: () => openClawAgents,
  getAgentIds: () => openClawAgents.map((a) => a.id),
  findAgentById: (id: string) => openClawAgents.find((a) => a.id === id) ?? null,
}))

const adapterCalls = {
  addAgent: [] as unknown[],
  addToAllowLists: [] as unknown[],
  removeAgent: [] as string[],
  removeFromAllowLists: [] as string[],
}
const adapterMockFactory = () => ({
  addAgent: async (input: { id: string }) => {
    adapterCalls.addAgent.push(input)
    openClawAgents.push({ id: input.id, identity: { name: input.id } })
    return { id: input.id, workspace: join(openClawDir, 'workspaces', input.id) }
  },
  addToAllowLists: (newAgentId: string, dispatchable: unknown) => {
    adapterCalls.addToAllowLists.push({ newAgentId, dispatchable })
  },
  removeAgent: async (id: string) => {
    adapterCalls.removeAgent.push(id)
    openClawAgents = openClawAgents.filter((a) => a.id !== id)
    return true
  },
  removeFromAllowLists: (id: string) => {
    adapterCalls.removeFromAllowLists.push(id)
  },
  getOpenClawConfig: () => ({ agents: { list: openClawAgents } }),
  listAgents: () => [],
  getAgentIds: () => openClawAgents.map((a) => a.id),
})
mock.module('@bakin/team/lib/openclaw-adapter', adapterMockFactory)
mock.module('../../plugins/team/lib/openclaw-adapter', adapterMockFactory)

import { installPackage } from '../../src/core/agent-packages/installer'
import { removePackageById } from '../../src/core/agent-packages/uninstaller'
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'
import { hasBlock } from '../../packages/core/src/agent-packages/managed-blocks'
import { readFileSync } from 'fs'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  openClawAgents = []
  adapterCalls.addAgent.length = 0
  adapterCalls.addToAllowLists.length = 0
  adapterCalls.removeAgent.length = 0
  adapterCalls.removeFromAllowLists.length = 0
})

function seedAgentPackage(opts: { id?: string; deps?: string[] } = {}): string {
  const id = opts.id ?? 'pixel'
  const dir = join(testDir, `${id}-pkg`)
  mkdirSync(join(dir, 'workspace'), { recursive: true })
  mkdirSync(join(dir, 'skills', 'image-gen'), { recursive: true })
  mkdirSync(join(dir, 'knowledge'), { recursive: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })

  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id,
      kind: 'agent',
      name: id,
      version: '0.1.0',
      agent: { identity: { name: id } },
      install: { writeWorkspaceFiles: true, enableKnowledge: ['style'] },
      contributions: {
        workspaceFiles: ['workspace/SOUL.md'],
        skills: ['skills/image-gen'],
        knowledge: ['knowledge/style.md'],
        assets: ['assets/avatar.jpg'],
      },
      ...(opts.deps ? { dependencies: { skills: opts.deps.map((s) => ({ source: s, ref: 'main' })) } } : {}),
    }),
  )
  writeFileSync(
    join(dir, 'workspace', 'SOUL.md'),
    `# Soul ${id}\n\n<!-- bakin:knowledge-catalog:start -->\n<!-- bakin:knowledge-catalog:end -->\n`,
  )
  writeFileSync(join(dir, 'skills', 'image-gen', 'SKILL.md'), '# image-gen')
  writeFileSync(
    join(dir, 'knowledge', 'style.md'),
    `---\ntitle: Style\ndefaultEnabled: true\n---\n\nStyle body.`,
  )
  writeFileSync(join(dir, 'assets', 'avatar.jpg'), 'jpg')
  return dir
}

function seedSkillPack(name: string): string {
  const dir = join(testDir, `${name}-skill-pack`)
  mkdirSync(join(dir, 'skills', name), { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id: name,
      kind: 'skill-pack',
      name,
      version: '0.3.1',
      contributions: { skills: [`skills/${name}`] },
    }),
  )
  writeFileSync(join(dir, 'skills', name, 'SKILL.md'), `# ${name}`)
  return dir
}

describe('removePackageById — basic remove', () => {
  it('removes projected files + lockfile entry, leaves OpenClaw agent in place by default', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    const result = await removePackageById({ packageId: 'pixel' })

    expect(result.removed).toContain('pixel')
    expect(result.deletedAgent).toBe(false)

    // Files gone
    expect(existsSync(join(openClawDir, 'workspaces', 'pixel', 'SOUL.md'))).toBe(false)
    expect(existsSync(join(testDir, 'agents', 'pixel', 'avatar.jpg'))).toBe(false)
    expect(existsSync(join(testDir, 'packages', 'agents', 'pixel@0.1.0'))).toBe(false)

    // Lockfile entry gone
    expect(readLockfile().packages.pixel).toBeUndefined()

    // OpenClaw still has the agent
    expect(openClawAgents.find((a) => a.id === 'pixel')).toBeDefined()
    expect(adapterCalls.removeAgent).toEqual([])
  })

  it('with --delete-agent, also removes the OpenClaw agent', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    const result = await removePackageById({ packageId: 'pixel', deleteAgent: true })

    expect(result.deletedAgent).toBe(true)
    expect(adapterCalls.removeAgent).toEqual(['pixel'])
    expect(adapterCalls.removeFromAllowLists).toEqual(['pixel'])
    expect(openClawAgents.find((a) => a.id === 'pixel')).toBeUndefined()
  })

  it('with --keep-blocks, leaves knowledge markers in place when files survive', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    // Pre-userEdit the SOUL.md so unproject won't delete it; markers should
    // survive --keep-blocks.
    const soulPath = join(openClawDir, 'workspaces', 'pixel', 'SOUL.md')
    const { markUserEdited } = await import('../../packages/core/src/agent-packages/markers')
    markUserEdited(soulPath)

    await removePackageById({ packageId: 'pixel', keepBlocks: true })

    // SOUL.md kept (userEdited) AND its markers kept (keepBlocks)
    expect(existsSync(soulPath)).toBe(true)
    const soul = readFileSync(soulPath, 'utf-8')
    expect(hasBlock(soul, 'knowledge-catalog')).toBe(true)
    expect(hasBlock(soul, 'knowledge:pixel:style')).toBe(true)
  })
})

describe('removePackageById — refuse on dependents', () => {
  it('refuses removing a skill-pack while a dependent still uses it', async () => {
    const skillPackSrc = seedSkillPack('shared-image-gen')
    const agentSrc = seedAgentPackage({ id: 'pixel-deps', deps: [skillPackSrc] })
    await installPackage({ source: agentSrc })

    expect(async () => {
      await removePackageById({ packageId: 'shared-image-gen@0.3.1' })
    }).toThrow(/still required by \[pixel-deps\]/)
  })

  it('with --force, removes anyway even with dependents', async () => {
    const skillPackSrc = seedSkillPack('shared-image-gen')
    const agentSrc = seedAgentPackage({ id: 'pixel-deps', deps: [skillPackSrc] })
    await installPackage({ source: agentSrc })

    const result = await removePackageById({ packageId: 'shared-image-gen@0.3.1', force: true })
    expect(result.removed).toContain('shared-image-gen@0.3.1')
  })
})

describe('removePackageById — orphan dep cleanup', () => {
  it('removes a dep that drops to refCount 0', async () => {
    const skillPackSrc = seedSkillPack('shared-image-gen')
    const agentSrc = seedAgentPackage({ id: 'pixel-deps', deps: [skillPackSrc] })
    await installPackage({ source: agentSrc })

    const lockBefore = readLockfile()
    expect(lockBefore.packages['shared-image-gen@0.3.1'].refCount).toBe(1)

    const result = await removePackageById({ packageId: 'pixel-deps' })

    expect(result.removed).toContain('pixel-deps')
    expect(result.removed).toContain('shared-image-gen@0.3.1')

    // Skill-pack lockfile entry + global skill files gone
    const lockAfter = readLockfile()
    expect(lockAfter.packages['shared-image-gen@0.3.1']).toBeUndefined()
    expect(existsSync(join(openClawDir, 'skills', 'shared-image-gen'))).toBe(false)
  })

  it('keeps a dep that still has other dependents', async () => {
    const skillPackSrc = seedSkillPack('shared-image-gen')
    // Two agents both depend on the same skill-pack
    const agentASrc = seedAgentPackage({ id: 'agent-a', deps: [skillPackSrc] })
    const agentBSrc = seedAgentPackage({ id: 'agent-b', deps: [skillPackSrc] })
    await installPackage({ source: agentASrc })
    await installPackage({ source: agentBSrc })

    expect(readLockfile().packages['shared-image-gen@0.3.1'].refCount).toBe(2)

    const result = await removePackageById({ packageId: 'agent-a' })

    expect(result.removed).toContain('agent-a')
    expect(result.removed).not.toContain('shared-image-gen@0.3.1')
    expect(result.kept).toContain('shared-image-gen@0.3.1')

    const lockAfter = readLockfile()
    expect(lockAfter.packages['shared-image-gen@0.3.1'].refCount).toBe(1)
    expect(existsSync(join(openClawDir, 'skills', 'shared-image-gen'))).toBe(true)
  })
})

describe('removePackageById — error paths', () => {
  it('throws on unknown package id', async () => {
    expect(async () => {
      await removePackageById({ packageId: 'never-installed' })
    }).toThrow(/not installed/)
  })
})
