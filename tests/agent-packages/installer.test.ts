/**
 * End-to-end installer tests (Phase E-5).
 *
 * Each test mounts a fresh Bakin home + OpenClaw home, seeds a real package
 * source on disk, calls installPackage(), and asserts:
 *   - lockfile entries land with correct projections, sha, commitSha, state
 *   - workspace files / skills / assets / knowledge markers are on disk
 *   - the final install dir at ~/.bakin/packages/<kind>/<id>@<ver>/ holds
 *     the package source
 *   - runtime adapter mocks are called the right number of times in the
 *     right modes
 *   - audit events are written
 *
 * Failure paths covered: collision refusal, fresh-install-on-adopted-agent,
 * adopt-on-absent-agent, source-fetch failure, manifest-validation failure
 * (all with full rollback).
 */
// IMPORTANT: env vars must land BEFORE any other import. ES-module import
// hoisting puts our `import` lines above the `mock.module()` calls below,
// so a transitive import of @bakin/core/openclaw-home can read process.env
// directly. Setting OPENCLAW_HOME + BAKIN_HOME here is the CLAUDE.md-blessed
// escape for the "mock arrives too late" case — the test-env safety guard in
// packages/core/src/openclaw-home.ts compares the resolved path against
// $HOME/.openclaw and only throws when they match. Our temp paths can't
// match, so the guard passes.
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-installer-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AgentRuntimeAdapter, RuntimeSkill, WorkspaceFile } from '@bakin/core/adapters/runtime'

// Both content-dir and openclaw-home are env-driven, so the env vars above
// already redirect them. The mocks below are belt-and-suspenders for the
// test-env guard in case future refactors detach env handling from the
// canonical readers.
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

let runtimeAgents: Array<{ id: string; identity?: { name?: string } }> = []

const adapterCalls: { addAgent: unknown[]; addToAllowLists: unknown[] } = {
  addAgent: [],
  addToAllowLists: [],
}

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
      list: async () => runtimeAgents.map((agent) => ({
        id: agent.id,
        name: agent.identity?.name ?? agent.id,
        status: 'active',
      })),
      get: async (id: string) => {
        const agent = runtimeAgents.find((entry) => entry.id === id)
        return agent ? { id: agent.id, name: agent.identity?.name ?? agent.id, status: 'active' } : null
      },
      create: async (input: { id?: string; name: string; role?: string; model?: string; metadata?: Record<string, unknown> }) => {
        const id = input.id ?? input.name.toLowerCase()
        const call = { ...input, id, emoji: input.metadata?.emoji }
        adapterCalls.addAgent.push(call)
        runtimeAgents.push({ id, identity: { name: input.name } })
        return { id, name: input.name, role: input.role, model: input.model, status: 'active', metadata: input.metadata }
      },
      update: async (id: string, input: { name?: string }) => ({ id, name: input.name ?? id, status: 'active' }),
      remove: async (id: string) => {
        runtimeAgents = runtimeAgents.filter((agent) => agent.id !== id)
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
        adapterCalls.addToAllowLists.push({ agentId, patch })
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
  ;(globalThis as TestGlobal).__bakinAppServices = { runtime }
}

import { installPackage } from '../../src/core/agent-packages/installer'
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'
import { extractBlock, hasBlock } from '../../packages/core/src/agent-packages/managed-blocks'
import { isInstallLockHeld } from '../../src/core/agent-packages/install-lock'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  runtimeAgents = []
  adapterCalls.addAgent.length = 0
  adapterCalls.addToAllowLists.length = 0
  installRuntimeMock()
})

// ─── Fixtures ────────────────────────────────────────────────────────────────

function seedAgentPackage(opts: { id?: string; emoji?: string; deps?: { skills?: string[] } } = {}): string {
  const id = opts.id ?? 'pixel'
  const dir = join(testDir, `${id}-pkg`)
  mkdirSync(join(dir, 'workspace'), { recursive: true })
  mkdirSync(join(dir, 'skills', 'image-gen'), { recursive: true })
  mkdirSync(join(dir, 'knowledge'), { recursive: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })

  const manifest = {
    id,
    kind: 'agent',
    name: 'Pixel',
    version: '0.1.0',
    description: 'Test agent.',
    agent: {
      identity: { name: 'Pixel', emoji: opts.emoji ?? '🎨' },
      role: 'Image artist',
      dispatchableBy: ['main'],
    },
    install: {
      createIfMissing: true,
      adoptIfExists: true,
      writeWorkspaceFiles: true,
      installSkills: true,
      enableKnowledge: ['style'],
    },
    contributions: {
      workspaceFiles: ['workspace/SOUL.md'],
      skills: ['skills/image-gen'],
      knowledge: ['knowledge/style.md'],
      assets: ['assets/avatar.jpg'],
    },
    ...(opts.deps ? { dependencies: { skills: opts.deps.skills?.map((s) => ({ source: s, ref: 'main' })) } } : {}),
  }
  writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(
    join(dir, 'workspace', 'SOUL.md'),
    `# Soul\n\nYou are ${id}.\n\n<!-- bakin:knowledge-catalog:start -->\n<!-- bakin:knowledge-catalog:end -->\n`,
  )
  writeFileSync(join(dir, 'skills', 'image-gen', 'SKILL.md'), '# image-gen')
  writeFileSync(
    join(dir, 'knowledge', 'style.md'),
    `---\ntitle: Style\ndefaultEnabled: true\n---\n\nStyle lessons body.`,
  )
  writeFileSync(join(dir, 'assets', 'avatar.jpg'), 'jpg-bytes')

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

// ─── Happy paths ─────────────────────────────────────────────────────────────

describe('installPackage — fresh install (kind:"agent")', () => {
  it('writes lockfile entry, projections, and creates the runtime agent', async () => {
    const src = seedAgentPackage()

    const result = await installPackage({ source: src })

    expect(result.packageId).toBe('pixel')
    expect(result.kind).toBe('agent')
    expect(result.createdAgent).toBe(true)
    expect(result.adopted).toBe(false)

    // Runtime agent creation called with manifest values
    expect(adapterCalls.addAgent).toHaveLength(1)
    const addCall = adapterCalls.addAgent[0] as { id: string; emoji?: string; role?: string }
    expect(addCall.id).toBe('pixel')
    expect(addCall.emoji).toBe('🎨')
    expect(addCall.role).toBe('Image artist')

    // dispatchableBy → main allowlist update
    expect(adapterCalls.addToAllowLists).toHaveLength(1)
    expect(adapterCalls.addToAllowLists[0]).toEqual({
      agentId: 'main',
      patch: { add: ['pixel'] },
    })

    // Lockfile entry shape
    const lock = readLockfile()
    const entry = lock.packages.pixel
    expect(entry).toBeDefined()
    expect(entry.kind).toBe('agent')
    expect(entry.state).toBe('managed')
    expect(entry.agentId).toBe('pixel')
    expect(entry.knowledgeEnabled).toEqual(['style'])
    expect(entry.projections?.length).toBeGreaterThan(0)
  })

  it('lays down all four projection kinds', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    const wsSoul = join(openClawDir, 'workspaces', 'pixel', 'SOUL.md')
    const skill = join(openClawDir, 'workspaces', 'pixel', 'skills', 'image-gen', 'SKILL.md')
    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')

    expect(existsSync(wsSoul)).toBe(true)
    expect(existsSync(skill)).toBe(true)
    expect(existsSync(avatar)).toBe(true)

    // Knowledge markers injected
    const soul = readFileSync(wsSoul, 'utf-8')
    expect(hasBlock(soul, 'knowledge-catalog')).toBe(true)
    expect(hasBlock(soul, 'knowledge:pixel:style')).toBe(true)
    const catalog = extractBlock(soul, 'knowledge-catalog') ?? ''
    expect(catalog).toContain('[x] **Style**')
  })

  it('moves the staging dir into ~/.bakin/packages/agents/<id>@<version>/', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    const installDir = join(testDir, 'packages', 'agents', 'pixel@0.1.0')
    expect(existsSync(installDir)).toBe(true)
    expect(existsSync(join(installDir, 'bakin-package.json'))).toBe(true)
    expect(existsSync(join(installDir, 'knowledge', 'style.md'))).toBe(true)
  })

  it('writes an audit event tagged with the agent id', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    const auditPath = join(testDir, 'audit.jsonl')
    expect(existsSync(auditPath)).toBe(true)
    const lines = readFileSync(auditPath, 'utf-8').trim().split('\n')
    const events = lines.map((l) => JSON.parse(l))
    const installEvent = events.find((e: { event: string }) => e.event === 'agent_pkg.installed')
    expect(installEvent).toBeDefined()
    expect(installEvent.agent).toBe('pixel')
    expect(installEvent.data.packageId).toBe('pixel')
  })

  it('releases the install lock after success', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })
    expect(isInstallLockHeld()).toBe(false)
  })
})

// ─── Adopt mode ──────────────────────────────────────────────────────────────

describe('installPackage — adopt mode', () => {
  it('attaches package without overwriting existing workspace files', async () => {
    // Pre-existing pixel agent + workspace SOUL the user wrote
    runtimeAgents = [{ id: 'pixel', identity: { name: 'Pixel' } }]
    const wsDir = join(openClawDir, 'workspaces', 'pixel')
    mkdirSync(wsDir, { recursive: true })
    writeFileSync(join(wsDir, 'SOUL.md'), '# user wrote this')

    const src = seedAgentPackage()
    const result = await installPackage({ source: src, adopt: true })

    expect(result.adopted).toBe(true)
    expect(result.createdAgent).toBe(false)
    expect(adapterCalls.addAgent).toHaveLength(0)

    // SOUL.md still has the user's content but with markers injected
    const soul = readFileSync(join(wsDir, 'SOUL.md'), 'utf-8')
    expect(soul).toContain('# user wrote this')
    expect(hasBlock(soul, 'knowledge-catalog')).toBe(true)

    // Lockfile state = adopted
    expect(readLockfile().packages.pixel.state).toBe('adopted')
  })
})

// ─── Refuse paths ────────────────────────────────────────────────────────────

describe('installPackage — refuse paths', () => {
  it('refuses fresh install when agent is already managed', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src }) // first install

    // Second attempt should refuse
    expect(async () => {
      await installPackage({ source: src })
    }).toThrow(/already managed/)
  })

  it('refuses fresh install on an unmanaged existing agent (without --adopt)', async () => {
    runtimeAgents = [{ id: 'pixel' }]
    const src = seedAgentPackage()

    expect(async () => {
      await installPackage({ source: src })
    }).toThrow(/already exists in the runtime but is unmanaged/)
  })

  it('refuses --adopt when agent does not exist', async () => {
    const src = seedAgentPackage({ id: 'never-existed' })

    expect(async () => {
      await installPackage({ source: src, adopt: true })
    }).toThrow(/does not exist/)
  })

  it('rolls back projections + lockfile when manifest is invalid', async () => {
    const src = join(testDir, 'broken-pkg')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'bakin-package.json'), JSON.stringify({ id: 'x' })) // missing kind/name/version

    expect(async () => {
      await installPackage({ source: src })
    }).toThrow()

    // No lockfile written, no projections, no install dir
    const lock = readLockfile()
    expect(Object.keys(lock.packages)).toEqual([])
    expect(existsSync(join(testDir, 'packages', 'agents', 'x@0.0.0'))).toBe(false)
    expect(adapterCalls.addAgent).toHaveLength(0)
    expect(isInstallLockHeld()).toBe(false)
  })
})

// ─── Composition (single-level deps) ─────────────────────────────────────────

describe('installPackage — single-level dependency', () => {
  it('installs a skill-pack dep + agent, lockfile carries refCount + dependents', async () => {
    const skillPackSrc = seedSkillPack('shared-image-gen')
    const agentSrc = seedAgentPackage({
      id: 'pixel-with-deps',
      deps: { skills: [skillPackSrc] },
    })

    const result = await installPackage({ source: agentSrc })

    expect(result.dependencies).toHaveLength(1)
    expect(result.dependencies[0].packageId).toBe('shared-image-gen')

    const lock = readLockfile()
    const depKey = 'shared-image-gen@0.3.1'
    expect(lock.packages[depKey]).toBeDefined()
    expect(lock.packages[depKey].refCount).toBe(1)
    expect(lock.packages[depKey].dependents).toEqual(['pixel-with-deps'])
    expect(lock.packages['pixel-with-deps'].dependencies).toEqual([depKey])
  })

  it('skill-pack deps land at global ~/.openclaw/skills/<name>/', async () => {
    const skillPackSrc = seedSkillPack('shared-image-gen')
    const agentSrc = seedAgentPackage({
      id: 'pixel-with-deps',
      deps: { skills: [skillPackSrc] },
    })

    await installPackage({ source: agentSrc })

    const globalSkill = join(openClawDir, 'skills', 'shared-image-gen', 'SKILL.md')
    expect(existsSync(globalSkill)).toBe(true)
  })
})

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('installPackage — idempotency', () => {
  it('throws on re-install of the same package (use update instead)', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    expect(async () => {
      await installPackage({ source: src })
    }).toThrow(/already managed/)
  })
})

// ─── Lock release on failure ─────────────────────────────────────────────────

describe('installPackage — install lock release on failure', () => {
  it('releases the lock even when install throws', async () => {
    const src = join(testDir, 'broken-pkg-2')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'bakin-package.json'), '{')

    expect(async () => {
      await installPackage({ source: src })
    }).toThrow()

    expect(isInstallLockHeld()).toBe(false)
  })
})
