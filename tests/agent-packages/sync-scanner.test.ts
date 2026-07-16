/**
 * Tests for the agent-sync drift scanner (layered-context spec, C4).
 *
 * Coverage:
 *   - clean state scans clean (blocks ok, projections ok, no findings)
 *   - block-stale attribution per input: global / package / lessons /
 *     in-place block edits
 *   - block-missing / block-broken / file-missing
 *   - migration-needed on legacy lockfile shapes (templateOnly /
 *     lesson-marker) and per-file noise suppression for those agents
 *   - source-missing when the installed dir is gone
 *   - skill-missing / skill-drifted / user-edited skills
 *   - unmanaged agents: context-only AGENTS.md expectations
 *   - scanner is read-only (no mutation of runtime or disk)
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-sync-scanner-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
const silentLogger = {
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}
mock.module('../../src/core/logger', () => silentLogger)
mock.module('@/core/logger', () => silentLogger)
mock.module('../../src/core/plugin-registry', () => ({
  getHookRegistry: () => ({ invoke: async () => undefined }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({ invoke: async () => undefined }),
}))

import {
  computeFilesMapSha,
  deriveExpectedBlocks,
  readInstalledManifest,
  scanAgentSync,
  sha256OfString,
} from '../../src/core/agent-packages/sync-scanner'
import { seedContextFiles, getGlobalContextPath } from '../../src/core/team-context'
import {
  type Lockfile,
  type PackageEntry,
  type ProjectionEntry,
  writeLockfile,
} from '../../packages/core/src/agent-packages/lockfile'
import {
  MANAGED_BLOCK_ID,
  composeFileContent,
} from '../../packages/core/src/agent-packages/composer'
import { injectBlock } from '../../packages/core/src/agent-packages/managed-blocks'
import type { RuntimeSkill, WorkspaceFile } from '@bakin/core/adapters/runtime'

// ─── In-memory runtime mock ──────────────────────────────────────────────────

let runtimeAgents: Array<{ id: string; name?: string; role?: string }> = []
let workspaceFiles = new Map<string, WorkspaceFile>() // `${agentId}:${path}`
let runtimeSkills = new Map<string, RuntimeSkill>() // `${agentId ?? ''}:${name}`
let writeCalls = 0
let workspaceReadCalls: string[] = []
let skillReadCalls: string[] = []

type TestGlobal = typeof globalThis & { __bakinAppServices?: unknown }

function installRuntimeMock(): void {
  ;(globalThis as TestGlobal).__bakinAppServices = {
    runtime: {
      agents: {
        list: async () => runtimeAgents.map((a) => ({ id: a.id, name: a.name ?? a.id, role: a.role, status: 'active' })),
        readWorkspaceFile: async (agentId: string, path: string) => {
          workspaceReadCalls.push(`${agentId}:${path}`)
          return workspaceFiles.get(`${agentId}:${path}`) ?? null
        },
        writeWorkspaceFile: async (agentId: string, file: WorkspaceFile) => {
          writeCalls++
          workspaceFiles.set(`${agentId}:${file.path}`, file)
        },
      },
      skills: {
        get: async (name: string, agentId?: string) => {
          skillReadCalls.push(`${agentId ?? ''}:${name}`)
          return runtimeSkills.get(`${agentId ?? ''}:${name}`) ?? null
        },
        write: async () => { writeCalls++ },
      },
    },
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PKG_DIR = join(testDir, 'packages', 'agents', 'pixel@0.1.0')

function seedInstalledPackage(): void {
  mkdirSync(join(PKG_DIR, 'workspace'), { recursive: true })
  mkdirSync(join(PKG_DIR, 'lessons'), { recursive: true })
  mkdirSync(join(PKG_DIR, 'skills', 'image-gen'), { recursive: true })
  writeFileSync(join(PKG_DIR, 'bakin-package.json'), JSON.stringify({
    id: 'pixel',
    kind: 'agent',
    name: 'Pixel',
    version: '0.1.0',
    description: 'Test agent.',
    agent: { identity: { name: 'Pixel' }, role: 'Image artist', dispatchableBy: ['main'] },
    install: { createIfMissing: true, adoptIfExists: true, writeWorkspaceFiles: true, installSkills: true },
    contributions: {
      workspaceFiles: ['workspace/SOUL.md', 'workspace/AGENTS.md'],
      skills: ['skills/image-gen'],
      lessons: ['lessons/style.md'],
      assets: [],
    },
  }, null, 2))
  writeFileSync(join(PKG_DIR, 'workspace', 'SOUL.md'), '# Soul\n\nYou are pixel.')
  writeFileSync(join(PKG_DIR, 'workspace', 'AGENTS.md'), '# Operating Notes\n\n- Iterate.')
  writeFileSync(join(PKG_DIR, 'lessons', 'style.md'), '---\ntitle: Style\ndefaultEnabled: true\n---\n\nStyle lessons body.')
  writeFileSync(join(PKG_DIR, 'skills', 'image-gen', 'SKILL.md'), '# image-gen')
}

function pixelEntry(projections: ProjectionEntry[]): PackageEntry {
  return {
    kind: 'agent',
    version: '0.1.0',
    source: 'local:/fixture',
    ref: '',
    commitSha: '',
    installedAt: '2026-06-01T00:00:00Z',
    state: 'managed',
    agentId: 'pixel',
    lessonsEnabled: ['style'],
    projections,
  }
}

const SKILL_FILES = { 'SKILL.md': '# image-gen' }

/**
 * Bring the world into a fully-synced state: derive expected blocks, write
 * them into the runtime workspace, register the skill, and write a v2
 * lockfile recording the derived input shas.
 */
async function seedSyncedState(): Promise<void> {
  seedContextFiles()
  seedInstalledPackage()
  runtimeAgents = [
    { id: 'main', name: 'Roscoe' },
    { id: 'pixel', name: 'Pixel' },
  ]

  const entry = pixelEntry([])
  const pkg = readInstalledManifest('pixel', entry)!
  const projections: ProjectionEntry[] = []

  for (const agent of runtimeAgents) {
    const vars = { agentId: agent.id, agentName: agent.name ?? agent.id, mainAgentId: 'main', mainAgentName: 'Roscoe' }
    const expected = await deriveExpectedBlocks(vars, agent.id === 'pixel' ? pkg : undefined)
    for (const exp of expected) {
      if (exp.body === null) continue
      workspaceFiles.set(`${agent.id}:${exp.file}`, {
        path: exp.file,
        content: composeFileContent(`# ${agent.id} ${exp.file}\n\nagent-owned text\n`, exp.body),
      })
      if (agent.id === 'pixel') {
        projections.push({
          kind: 'workspace-file',
          target: `runtime:workspace-file:pixel:${exp.file}`,
          composedSha: sha256OfString(exp.body.trim()),
          inputs: exp.inputs,
        })
      }
    }
  }

  runtimeSkills.set('pixel:image-gen', {
    name: 'image-gen',
    instructions: '# image-gen',
    files: SKILL_FILES,
    metadata: {},
  } as RuntimeSkill)
  projections.push({
    kind: 'skill',
    target: 'runtime:agent-skill:pixel:image-gen',
    sha256: computeFilesMapSha(SKILL_FILES),
  })

  const lock: Lockfile = { version: 1, packages: { pixel: pixelEntry(projections) } }
  writeLockfile(lock)
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  runtimeAgents = []
  workspaceFiles = new Map()
  runtimeSkills = new Map()
  writeCalls = 0
  workspaceReadCalls = []
  skillReadCalls = []
  installRuntimeMock()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('scanAgentSync — clean state', () => {
  it('reports zero findings when everything matches expectation', async () => {
    await seedSyncedState()
    const report = await scanAgentSync()
    expect(report.findings).toEqual([])
    expect(report.migrationNeeded).toBe(false)
    expect(report.agentsScanned).toBe(2)
    expect(report.blocksOk).toBeGreaterThanOrEqual(3) // pixel SOUL+AGENTS, main AGENTS
    expect(report.projectionsOk).toBe(1)
  })

  it('never writes anything (read-only guarantee)', async () => {
    await seedSyncedState()
    await scanAgentSync()
    expect(writeCalls).toBe(0)
  })
})

describe('scanAgentSync — agent scope', () => {
  it('does not inspect unrelated agents or package projections', async () => {
    await seedSyncedState()
    runtimeAgents.push({ id: 'other', name: 'Other' })

    const lockMod = await import('../../packages/core/src/agent-packages/lockfile')
    const current = lockMod.readLockfile()
    writeLockfile({
      version: 1,
      packages: {
        ...current.packages,
        other: {
          ...pixelEntry([
            {
              kind: 'skill',
              target: 'runtime:agent-skill:other:expensive-skill',
              sha256: 'unrelated',
            },
          ]),
          agentId: 'other',
        },
      },
    })

    const report = await scanAgentSync(undefined, { agentId: 'pixel' })

    expect(report.agentsScanned).toBe(1)
    expect(report.blocksOk).toBeGreaterThanOrEqual(2)
    expect(report.projectionsOk).toBe(1)
    expect(workspaceReadCalls.every((call) => call.startsWith('pixel:'))).toBe(true)
    expect(skillReadCalls).toEqual(['pixel:image-gen'])
    expect(report.findings.some((finding) => finding.agentId === 'other')).toBe(false)
    expect(report.findings.some((finding) => finding.packageId === 'other')).toBe(false)
  })

  it('excludes unrelated source and migration findings', async () => {
    await seedSyncedState()
    runtimeAgents.push({ id: 'other', name: 'Other' })

    const lockMod = await import('../../packages/core/src/agent-packages/lockfile')
    const current = lockMod.readLockfile()
    writeLockfile({
      version: 1,
      packages: {
        ...current.packages,
        other: {
          ...pixelEntry([
            {
              kind: 'workspace-file',
              target: 'runtime:workspace-file:other:SOUL.md',
              sha256: 'legacy',
              templateOnly: true,
            },
          ]),
          agentId: 'other',
        },
      },
    })

    const report = await scanAgentSync(undefined, { agentId: 'pixel' })

    expect(report.migrationNeeded).toBe(false)
    expect(report.findings.some((finding) => finding.packageId === 'other')).toBe(false)
  })

  it('does no workspace or projection work for an unknown scoped agent', async () => {
    await seedSyncedState()

    const report = await scanAgentSync(undefined, { agentId: 'nobody' })

    expect(report.agentsScanned).toBe(0)
    expect(report.findings).toEqual([])
    expect(workspaceReadCalls).toEqual([])
    expect(skillReadCalls).toEqual([])
  })

  it('retains findings from an owning package whose key differs from the agent id', async () => {
    await seedSyncedState()
    const lockMod = await import('../../packages/core/src/agent-packages/lockfile')
    const current = lockMod.readLockfile()
    writeLockfile({
      version: 1,
      packages: {
        'artist.bundle': {
          ...current.packages.pixel,
          agentId: 'pixel',
        },
      },
    })

    const report = await scanAgentSync(undefined, { agentId: 'pixel' })

    expect(report.findings.some(
      (finding) => finding.type === 'source-missing' && finding.packageId === 'artist.bundle',
    )).toBe(true)
  })
})

describe('scanAgentSync — block staleness attribution', () => {
  it('attributes global context edits to the global input (all agents)', async () => {
    await seedSyncedState()
    writeFileSync(getGlobalContextPath(), '# House Rules\n\n- New global rule')
    const report = await scanAgentSync()
    const stale = report.findings.filter((f) => f.type === 'block-stale')
    expect(stale.length).toBeGreaterThanOrEqual(1)
    const pixelAgents = stale.find((f) => f.agentId === 'pixel' && f.file === 'AGENTS.md')
    expect(pixelAgents?.staleInputs).toEqual(['global'])
    // main has no lockfile, so its stale finding has no attribution
    const mainAgents = stale.find((f) => f.agentId === 'main' && f.file === 'AGENTS.md')
    expect(mainAgents).toBeDefined()
    expect(mainAgents?.staleInputs).toEqual([])
  })

  it('attributes package template edits to the package input', async () => {
    await seedSyncedState()
    writeFileSync(join(PKG_DIR, 'workspace', 'SOUL.md'), '# Soul v2\n\nYou are pixel, renewed.')
    const report = await scanAgentSync()
    const finding = report.findings.find((f) => f.type === 'block-stale' && f.file === 'SOUL.md')
    expect(finding?.agentId).toBe('pixel')
    expect(finding?.staleInputs).toEqual(['package'])
  })

  it('attributes lesson toggles to the lessons input', async () => {
    await seedSyncedState()
    const lock: Lockfile = { version: 1, packages: {} }
    const current = (await import('../../packages/core/src/agent-packages/lockfile')).readLockfile()
    const entry = current.packages.pixel
    lock.packages.pixel = { ...entry, lessonsEnabled: [] }
    writeLockfile(lock)
    const report = await scanAgentSync()
    const finding = report.findings.find((f) => f.type === 'block-stale' && f.file === 'SOUL.md')
    expect(finding?.staleInputs).toEqual(['lessons'])
  })

  it('flags in-place edits inside the managed block', async () => {
    await seedSyncedState()
    const key = 'pixel:SOUL.md'
    const file = workspaceFiles.get(key)!
    workspaceFiles.set(key, {
      ...file,
      content: file.content.replace('You are pixel.', 'You are pixel. EDITED INSIDE BLOCK.'),
    })
    const report = await scanAgentSync()
    const finding = report.findings.find((f) => f.type === 'block-stale' && f.file === 'SOUL.md')
    expect(finding?.staleInputs).toEqual(['in-place-edit'])
  })

  it('attributes a runtime tool-access style change to the tool-access input (P1.6)', async () => {
    const setStyle = (style: unknown) => {
      ;((globalThis as TestGlobal).__bakinAppServices as { runtime: { describeToolAccess: () => unknown } })
        .runtime.describeToolAccess = () => style
    }
    // Seed a synced state whose AGENTS.md carries the mcp (per-agent server) section…
    setStyle({ style: 'mcp', mcpServerTemplate: 'bakin-<agent>' })
    await seedSyncedState()
    // …then the active runtime switches to in-process — the tool-access section
    // (and only it) changes, so the block is stale and attributed to tool-access.
    setStyle({ style: 'in-process' })
    const report = await scanAgentSync()
    const finding = report.findings.find(
      (f) => f.type === 'block-stale' && f.agentId === 'pixel' && f.file === 'AGENTS.md',
    )
    expect(finding?.staleInputs).toEqual(['tool-access'])
  })
})

describe('scanAgentSync — structural block findings', () => {
  it('reports block-missing when a file lost its managed block', async () => {
    await seedSyncedState()
    workspaceFiles.set('pixel:SOUL.md', { path: 'SOUL.md', content: '# bare file, no block' })
    const report = await scanAgentSync()
    expect(report.findings.find((f) => f.type === 'block-missing' && f.file === 'SOUL.md')?.agentId).toBe('pixel')
  })

  it('reports block-broken on orphan markers and does not auto-fix', async () => {
    await seedSyncedState()
    workspaceFiles.set('pixel:SOUL.md', {
      path: 'SOUL.md',
      content: `<!-- bakin:${MANAGED_BLOCK_ID}:start -->\nno end marker ever`,
    })
    const report = await scanAgentSync()
    const finding = report.findings.find((f) => f.type === 'block-broken')
    expect(finding?.severity).toBe('error')
    expect(finding?.autoFixable).toBe(false)
  })

  it('reports file-missing as error for managed, warn for unmanaged', async () => {
    await seedSyncedState()
    workspaceFiles.delete('pixel:SOUL.md')
    workspaceFiles.delete('main:AGENTS.md')
    const report = await scanAgentSync()
    const pixelFinding = report.findings.find((f) => f.type === 'file-missing' && f.agentId === 'pixel')
    const mainFinding = report.findings.find((f) => f.type === 'file-missing' && f.agentId === 'main')
    expect(pixelFinding?.severity).toBe('error')
    expect(mainFinding?.severity).toBe('warn')
  })
})

describe('scanAgentSync — migration + source', () => {
  it('flags legacy lockfile shapes as migration-needed and suppresses per-file noise', async () => {
    await seedSyncedState()
    const lockMod = await import('../../packages/core/src/agent-packages/lockfile')
    const current = lockMod.readLockfile()
    const entry = current.packages.pixel
    const legacy: Lockfile = {
      version: 1,
      packages: {
        pixel: {
          ...entry,
          projections: [
            { kind: 'workspace-file', target: 'runtime:workspace-file:pixel:SOUL.md', sha256: 'x', templateOnly: true },
            { kind: 'lesson-marker', target: 'runtime:workspace-file:pixel:SOUL.md', blockId: 'lesson:pixel:style' },
          ],
        },
      },
    }
    writeLockfile(legacy)
    // Blow away pixel's blocks — would be very stale, but migration suppresses that noise
    workspaceFiles.set('pixel:SOUL.md', { path: 'SOUL.md', content: '# legacy soul' })

    const report = await scanAgentSync()
    expect(report.migrationNeeded).toBe(true)
    expect(report.findings.some((f) => f.type === 'migration-needed' && f.packageId === 'pixel')).toBe(true)
    expect(report.findings.some((f) => f.type === 'block-stale' && f.agentId === 'pixel')).toBe(false)
    expect(report.findings.some((f) => f.type === 'block-missing' && f.agentId === 'pixel')).toBe(false)
  })

  it('reports source-missing when the installed dir is gone', async () => {
    await seedSyncedState()
    rmSync(PKG_DIR, { recursive: true, force: true })
    const report = await scanAgentSync()
    const finding = report.findings.find((f) => f.type === 'source-missing')
    expect(finding?.packageId).toBe('pixel')
    expect(finding?.severity).toBe('error')
    expect(finding?.autoFixable).toBe(false)
  })
})

describe('scanAgentSync — skills', () => {
  it('reports skill-missing when the runtime lost the skill', async () => {
    await seedSyncedState()
    runtimeSkills.delete('pixel:image-gen')
    const report = await scanAgentSync()
    expect(report.findings.find((f) => f.type === 'skill-missing')?.target).toBe('runtime:agent-skill:pixel:image-gen')
  })

  it('the hash is STRICT over the files map — adapters must include SKILL.md (contract pin)', async () => {
    await seedSyncedState()
    // An incomplete files map (SKILL.md served only as `instructions`) reads
    // as drift by design: the scanner never trusts `instructions` to equal
    // the on-disk bytes, so a lossy adapter surfaces immediately instead of
    // masking genuine drift. Pi shipped this shape once — fixed adapter-side
    // (tests/adapter-pi/skills-files-map.test.ts pins the round trip).
    const { 'SKILL.md': skillMd, ...rest } = SKILL_FILES
    runtimeSkills.set('pixel:image-gen', {
      name: 'image-gen',
      instructions: skillMd,
      files: rest,
      metadata: {},
    } as RuntimeSkill)
    const report = await scanAgentSync()
    expect(report.findings.some((f) => f.type === 'skill-drifted')).toBe(true)
  })

  it('reports skill-drifted on content mismatch', async () => {
    await seedSyncedState()
    runtimeSkills.set('pixel:image-gen', {
      name: 'image-gen',
      instructions: 'tweaked',
      files: { 'SKILL.md': 'tweaked' },
      metadata: {},
    } as RuntimeSkill)
    const report = await scanAgentSync()
    expect(report.findings.some((f) => f.type === 'skill-drifted')).toBe(true)
  })

  it('reports user-edited skills as locked with a reclaim hint, not drifted', async () => {
    await seedSyncedState()
    runtimeSkills.set('pixel:image-gen', {
      name: 'image-gen',
      instructions: 'mine now',
      files: { 'SKILL.md': 'mine now' },
      metadata: { userEdited: true },
    } as RuntimeSkill)
    const report = await scanAgentSync()
    const finding = report.findings.find((f) => f.type === 'user-edited')
    expect(finding?.autoFixable).toBe(false)
    expect(finding?.hint).toContain('--reclaim')
    expect(report.findings.some((f) => f.type === 'skill-drifted')).toBe(false)
  })
})

describe('scanAgentSync — role context', () => {
  it('flags missing/stale role context files', async () => {
    await seedSyncedState()
    rmSync(join(testDir, 'team', 'context', 'roles', 'subagent.md'), { force: true })
    const report = await scanAgentSync()
    expect(report.findings.some((f) => f.type === 'role-context-stale')).toBe(true)
  })
})

describe('deriveExpectedBlocks — unmanaged agents', () => {
  it('expects AGENTS.md only (context layers), nothing else', async () => {
    seedContextFiles()
    const blocks = await deriveExpectedBlocks({
      agentId: 'roscoe', agentName: 'Roscoe', mainAgentId: 'main', mainAgentName: 'Main',
    })
    const byFile = new Map(blocks.map((b) => [b.file, b]))
    expect(byFile.get('AGENTS.md')?.body).toContain('role:subagent')
    expect(byFile.get('SOUL.md')?.body).toBeNull()
    expect(byFile.get('IDENTITY.md')?.body).toBeNull()
    expect(byFile.get('TOOLS.md')?.body).toBeNull()
  })
})
