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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AgentRuntimeAdapter, RuntimeSkill, WorkspaceFile } from '@bakin/core/adapters/runtime'

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
  removeFromAllowLists: [] as unknown[],
}

type TestGlobal = typeof globalThis & {
  __bakinFallbackRuntimeAdapter?: AgentRuntimeAdapter
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function readSkillTree(root: string, prefix = ''): Record<string, string> {
  const dir = join(root, prefix)
  const files: Record<string, string> = {}
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const abs = join(root, rel)
    if (entry.isDirectory()) {
      Object.assign(files, readSkillTree(root, rel))
    } else if (entry.isFile()) {
      if (entry.name === '.installedBy' || entry.name === '.userEdited') continue
      files[rel] = readFileSync(abs, 'utf-8')
    }
  }
  return files
}

function runtimeWorkspaceFile(agentId: string, path: string): string {
  return join(openClawDir, 'workspaces', agentId, path)
}

function runtimeSkillDir(name: string, agentId?: string): string {
  return agentId
    ? join(openClawDir, 'workspaces', agentId, 'skills', name)
    : join(openClawDir, 'skills', name)
}

function installRuntimeMock(): void {
  ;(globalThis as TestGlobal).__bakinFallbackRuntimeAdapter = {
    agents: {
      listWorkspaceFiles: async () => [],
      list: async () => openClawAgents.map((agent) => ({
        id: agent.id,
        name: agent.identity?.name ?? agent.id,
        status: 'active',
      })),
      get: async (id: string) => {
        const agent = openClawAgents.find((entry) => entry.id === id)
        return agent ? { id: agent.id, name: agent.identity?.name ?? agent.id, status: 'active' } : null
      },
      create: async (input: { id?: string; name: string }) => {
        const id = input.id ?? input.name.toLowerCase()
        adapterCalls.addAgent.push({ ...input, id })
        openClawAgents.push({ id, identity: { name: input.name } })
        return { id, name: input.name, status: 'active' }
      },
      update: async (id: string, input: { name?: string }) => ({ id, name: input.name ?? id, status: 'active' }),
      remove: async (id: string) => {
        adapterCalls.removeAgent.push(id)
        openClawAgents = openClawAgents.filter((agent) => agent.id !== id)
      },
      readWorkspaceFile: async (agentId: string, path: string): Promise<WorkspaceFile | null> => {
        const file = runtimeWorkspaceFile(agentId, path)
        if (!existsSync(file)) return null
        return {
          path,
          content: readFileSync(file, 'utf-8'),
          updatedAt: statSync(file).mtime.toISOString(),
          metadata: {
            installedBy: readJson(`${file}.installedBy`),
            userEdited: existsSync(`${file}.userEdited`),
          },
        }
      },
      writeWorkspaceFile: async (agentId: string, file: WorkspaceFile) => {
        const target = runtimeWorkspaceFile(agentId, file.path)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, file.content, 'utf-8')
        if (file.metadata?.installedBy) {
          writeFileSync(`${target}.installedBy`, JSON.stringify(file.metadata.installedBy, null, 2), 'utf-8')
        } else {
          rmSync(`${target}.installedBy`, { force: true })
        }
      },
      removeWorkspaceFile: async (agentId: string, path: string) => {
        const target = runtimeWorkspaceFile(agentId, path)
        rmSync(target, { force: true })
        rmSync(`${target}.installedBy`, { force: true })
      },
      updatePermissions: async () => {},
      updateAllowlist: async (agentId: string, patch: Record<string, unknown>) => {
        if (patch.remove) adapterCalls.removeFromAllowLists.push({ agentId, patch })
        else adapterCalls.addToAllowLists.push({ agentId, patch })
      },
      heartbeat: async () => true,
    },
    skills: {
      list: async () => [],
      get: async (name: string, agentId?: string): Promise<RuntimeSkill | null> => {
        const dir = runtimeSkillDir(name, agentId)
        const skillPath = join(dir, 'SKILL.md')
        if (!existsSync(skillPath)) return null
        return {
          name,
          path: skillPath,
          instructions: readFileSync(skillPath, 'utf-8'),
          files: readSkillTree(dir),
          metadata: {
            installedBy: readJson(join(dir, '.installedBy')),
            userEdited: existsSync(join(dir, '.userEdited')),
          },
        }
      },
      write: async (skill: RuntimeSkill, agentId?: string) => {
        const dir = runtimeSkillDir(skill.name, agentId)
        const files = skill.files ?? { 'SKILL.md': skill.instructions ?? '' }
        for (const [rel, content] of Object.entries(files)) {
          const target = join(dir, rel)
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, content, 'utf-8')
        }
        if (skill.metadata?.installedBy) {
          writeFileSync(join(dir, '.installedBy'), JSON.stringify(skill.metadata.installedBy, null, 2), 'utf-8')
        } else {
          rmSync(join(dir, '.installedBy'), { force: true })
        }
      },
      remove: async (name: string, agentId?: string) => {
        rmSync(runtimeSkillDir(name, agentId), { recursive: true, force: true })
      },
    },
  } as unknown as AgentRuntimeAdapter
}

import { installPackage } from '../../src/core/agent-packages/installer'
import { removePackageById } from '../../src/core/agent-packages/uninstaller'
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'
import { hasBlock } from '../../packages/core/src/agent-packages/managed-blocks'

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
  installRuntimeMock()
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
    expect(adapterCalls.removeFromAllowLists).toEqual([])
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

// ─── Transitive ref-counting (Phase H-3) ─────────────────────────────────────

describe('removePackageById — transitive dep cleanup', () => {
  function seedSkillPackWithDep(name: string, depPath: string): string {
    const dir = join(testDir, `${name}-pack`)
    mkdirSync(join(dir, 'skills', name), { recursive: true })
    writeFileSync(
      join(dir, 'bakin-package.json'),
      JSON.stringify({
        id: name,
        kind: 'skill-pack',
        name,
        version: '0.1.0',
        contributions: { skills: [`skills/${name}`] },
        dependencies: { skills: [{ source: depPath, ref: 'main' }] },
      }),
    )
    writeFileSync(join(dir, 'skills', name, 'SKILL.md'), `# ${name}`)
    return dir
  }

  it('removing the only dependent of a 3-deep chain cleans up everything', async () => {
    // bottom-pack <- middle-pack <- pixel
    const bottomSrc = seedSkillPack('bottom-pack')
    const middleSrc = seedSkillPackWithDep('middle-pack', bottomSrc)
    const agentSrc = seedAgentPackage({ id: 'pixel-tx', deps: [middleSrc] })

    await installPackage({ source: agentSrc })
    const lockBefore = readLockfile()
    expect(lockBefore.packages['middle-pack@0.1.0']).toBeDefined()
    expect(lockBefore.packages['bottom-pack@0.3.1']).toBeDefined()
    expect(lockBefore.packages['middle-pack@0.1.0'].refCount).toBe(1)
    expect(lockBefore.packages['bottom-pack@0.3.1'].refCount).toBe(1)

    const result = await removePackageById({ packageId: 'pixel-tx' })

    expect(result.removed).toContain('pixel-tx')
    expect(result.removed).toContain('middle-pack@0.1.0')
    expect(result.removed).toContain('bottom-pack@0.3.1')
    const lockAfter = readLockfile()
    expect(lockAfter.packages['middle-pack@0.1.0']).toBeUndefined()
    expect(lockAfter.packages['bottom-pack@0.3.1']).toBeUndefined()
  })

  it('removing one branch of a diamond keeps the shared leaf alive', async () => {
    // shared-leaf <- branch-a <- pixel-a
    // shared-leaf <- branch-b <- pixel-b
    const sharedSrc = seedSkillPack('shared-leaf')
    const branchASrc = seedSkillPackWithDep('branch-a', sharedSrc)
    const branchBSrc = seedSkillPackWithDep('branch-b', sharedSrc)
    const agentASrc = seedAgentPackage({ id: 'pixel-a', deps: [branchASrc] })
    const agentBSrc = seedAgentPackage({ id: 'pixel-b', deps: [branchBSrc] })

    await installPackage({ source: agentASrc })
    await installPackage({ source: agentBSrc })

    // shared-leaf has 2 dependents (branch-a + branch-b)
    expect(readLockfile().packages['shared-leaf@0.3.1'].refCount).toBe(2)

    // Removing pixel-a decrements branch-a, which then has no dependents,
    // which decrements shared-leaf to refCount 1.
    const result = await removePackageById({ packageId: 'pixel-a' })
    expect(result.removed).toContain('pixel-a')
    expect(result.removed).toContain('branch-a@0.1.0')
    expect(result.removed).not.toContain('shared-leaf@0.3.1')

    const lockAfter = readLockfile()
    expect(lockAfter.packages['branch-a@0.1.0']).toBeUndefined()
    expect(lockAfter.packages['shared-leaf@0.3.1']).toBeDefined()
    expect(lockAfter.packages['shared-leaf@0.3.1'].refCount).toBe(1)
    expect(lockAfter.packages['shared-leaf@0.3.1'].dependents).toEqual(['branch-b@0.1.0'])

    // Now remove pixel-b — everything cascades.
    await removePackageById({ packageId: 'pixel-b' })
    const lockFinal = readLockfile()
    expect(lockFinal.packages['shared-leaf@0.3.1']).toBeUndefined()
    expect(lockFinal.packages['branch-b@0.1.0']).toBeUndefined()
  })
})
