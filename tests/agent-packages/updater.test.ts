/**
 * Tests for the update flow (Phase E-7).
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-updater-${Date.now()}-${randomUUID()}`)
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
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

let openClawAgents: Array<{ id: string; identity?: { name?: string } }> = []

type TestGlobal = typeof globalThis & {
  __bakinAppServices?: { runtime: AgentRuntimeAdapter }
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
  const runtime = {
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
        openClawAgents.push({ id, identity: { name: input.name } })
        return { id, name: input.name, status: 'active' }
      },
      update: async (id: string, input: { name?: string }) => ({ id, name: input.name ?? id, status: 'active' }),
      remove: async (id: string) => {
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
      updateAllowlist: async () => {},
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
  ;(globalThis as TestGlobal).__bakinAppServices = { runtime }
}

import { installPackage } from '../../src/core/agent-packages/installer'
import { updatePackageById } from '../../src/core/agent-packages/updater'
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'
import { extractBlock } from '../../packages/core/src/agent-packages/managed-blocks'
import { settleFor } from '../helpers/wait'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  openClawAgents = []
  installRuntimeMock()
})

function seedAgentPackage(opts: { id?: string; version?: string; soulBody?: string } = {}): string {
  const id = opts.id ?? 'pixel'
  const version = opts.version ?? '0.1.0'
  const dir = join(testDir, `${id}-pkg-${version}`)
  mkdirSync(join(dir, 'workspace'), { recursive: true })
  mkdirSync(join(dir, 'lessons'), { recursive: true })

  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id,
      kind: 'agent',
      name: id,
      version,
      agent: { identity: { name: id } },
      install: { writeWorkspaceFiles: true, enableLessons: ['style'] },
      contributions: {
        workspaceFiles: ['workspace/SOUL.md'],
        lessons: ['lessons/style.md'],
      },
    }),
  )
  const soul = opts.soulBody ?? `# Soul ${id}\n\n<!-- bakin:lesson-catalog:start -->\n<!-- bakin:lesson-catalog:end -->\n`
  writeFileSync(join(dir, 'workspace', 'SOUL.md'), soul)
  writeFileSync(
    join(dir, 'lessons', 'style.md'),
    `---\ntitle: Style\ndefaultEnabled: true\n---\n\nv${version} body.`,
  )
  return dir
}

describe('updatePackageById — happy paths', () => {
  it('returns changed=true and bumps the version when source content changes', async () => {
    const v1Src = seedAgentPackage({ version: '0.1.0' })
    await installPackage({ source: v1Src })

    const lockBefore = readLockfile()
    expect(lockBefore.packages.pixel.version).toBe('0.1.0')

    // Simulate an upstream version bump by writing a new manifest at the
    // SAME source path (local sources have empty commitSha — updater
    // re-projects unconditionally for those).
    const v2Manifest = JSON.parse(readFileSync(join(v1Src, 'bakin-package.json'), 'utf-8'))
    v2Manifest.version = '0.2.0'
    writeFileSync(join(v1Src, 'bakin-package.json'), JSON.stringify(v2Manifest))
    writeFileSync(
      join(v1Src, 'lessons', 'style.md'),
      `---\ntitle: Style\ndefaultEnabled: true\n---\n\nv0.2.0 body.`,
    )

    const result = await updatePackageById({ packageId: 'pixel' })
    expect(result.changed).toBe(true)
    expect(result.toVersion).toBe('0.2.0')

    const lockAfter = readLockfile()
    expect(lockAfter.packages.pixel.version).toBe('0.2.0')

    // Lesson content updated
    const soul = readFileSync(join(openClawDir, 'workspaces', 'pixel', 'SOUL.md'), 'utf-8')
    expect(soul).toContain('v0.2.0 body.')
    expect(soul).not.toContain('v0.1.0 body.')
  })

  it('preserves the original installedAt timestamp on update', async () => {
    const v1Src = seedAgentPackage({ version: '0.1.0' })
    await installPackage({ source: v1Src })
    const installedAt = readLockfile().packages.pixel.installedAt

    await settleFor(5, 'advance the clock so installedAt visibly changes after the update')
    await updatePackageById({ packageId: 'pixel' })

    expect(readLockfile().packages.pixel.installedAt).toBe(installedAt)
  })

  it('rewrites the managed block from a new template while preserving agent prose', async () => {
    const v1Src = seedAgentPackage({ version: '0.1.0' })
    await installPackage({ source: v1Src })

    // Agent adds prose OUTSIDE the managed block
    const soulPath = join(openClawDir, 'workspaces', 'pixel', 'SOUL.md')
    writeFileSync(soulPath, readFileSync(soulPath, 'utf-8') + '\nAgent-added notes.\n')

    // Source bumps version with a new SOUL template
    const newManifest = JSON.parse(readFileSync(join(v1Src, 'bakin-package.json'), 'utf-8'))
    newManifest.version = '0.2.0'
    writeFileSync(join(v1Src, 'bakin-package.json'), JSON.stringify(newManifest))
    writeFileSync(join(v1Src, 'workspace', 'SOUL.md'), `# Refreshed template`)

    await updatePackageById({ packageId: 'pixel' })

    // Block carries the new template; agent prose outside survives
    const after = readFileSync(soulPath, 'utf-8')
    expect(extractBlock(after, 'managed')).toContain('# Refreshed template')
    expect(after).toContain('Agent-added notes.')
  })
})

describe('updatePackageById — refuse paths', () => {
  it('throws on unknown package id', async () => {
    expect(async () => {
      await updatePackageById({ packageId: 'never-installed' })
    }).toThrow(/not installed/)
  })

  it('throws when the updated manifest id has changed', async () => {
    const src = seedAgentPackage({ id: 'pixel' })
    await installPackage({ source: src })

    // Mutate the manifest to a different id
    const m = JSON.parse(readFileSync(join(src, 'bakin-package.json'), 'utf-8'))
    m.id = 'pixel-renamed'
    writeFileSync(join(src, 'bakin-package.json'), JSON.stringify(m))

    expect(async () => {
      await updatePackageById({ packageId: 'pixel' })
    }).toThrow(/does not match installed id/)
  })

  it('refuses an update that removes a currently enabled lesson', async () => {
    const src = seedAgentPackage({ id: 'pixel', version: '0.1.0' })
    await installPackage({ source: src })

    const soulPath = join(openClawDir, 'workspaces', 'pixel', 'SOUL.md')
    const beforeSoul = readFileSync(soulPath, 'utf-8')
    expect(beforeSoul).toContain('v0.1.0 body.')

    const manifest = JSON.parse(readFileSync(join(src, 'bakin-package.json'), 'utf-8'))
    manifest.version = '0.2.0'
    manifest.contributions.lessons = ['lessons/new-style.md']
    writeFileSync(join(src, 'bakin-package.json'), JSON.stringify(manifest, null, 2))
    rmSync(join(src, 'lessons', 'style.md'), { force: true })
    writeFileSync(
      join(src, 'lessons', 'new-style.md'),
      `---\ntitle: New Style\ndefaultEnabled: false\n---\n\nv0.2.0 body.`,
    )

    expect(async () => {
      await updatePackageById({ packageId: 'pixel' })
    }).toThrow(/enabled lesson "style" is not contributed/i)

    const lockAfter = readLockfile()
    expect(lockAfter.packages.pixel.version).toBe('0.1.0')
    expect(lockAfter.packages.pixel.lessonsEnabled).toEqual(['style'])
    const afterSoul = readFileSync(soulPath, 'utf-8')
    expect(afterSoul).toBe(beforeSoul)
    expect(afterSoul).not.toContain('v0.2.0 body.')
  })

  it('refuses an update with a missing declared asset before mutating installed state', async () => {
    const src = seedAgentPackage({ id: 'pixel', version: '0.1.0' })
    await installPackage({ source: src })

    const soulPath = join(openClawDir, 'workspaces', 'pixel', 'SOUL.md')
    const beforeSoul = readFileSync(soulPath, 'utf-8')

    const manifest = JSON.parse(readFileSync(join(src, 'bakin-package.json'), 'utf-8'))
    manifest.version = '0.2.0'
    manifest.contributions.assets = ['assets/missing-avatar.jpg']
    writeFileSync(join(src, 'bakin-package.json'), JSON.stringify(manifest, null, 2))

    expect(async () => {
      await updatePackageById({ packageId: 'pixel' })
    }).toThrow(/asset source file is missing/i)

    const lockAfter = readLockfile()
    expect(lockAfter.packages.pixel.version).toBe('0.1.0')
    expect(readFileSync(soulPath, 'utf-8')).toBe(beforeSoul)
  })
})
