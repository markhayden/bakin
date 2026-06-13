/**
 * Tests for the one-time block migration (layered-context spec, C6).
 *
 * Coverage:
 *   - legacy managed agent: workspace files fully overwritten with composed
 *     block-only content (agent prose discarded), lockfile rewritten to v2,
 *     post-migration sync verifies clean
 *   - unmanaged agent with legacy managed-context block: legacy blocks
 *     swapped for the composed block, user prose PRESERVED
 *   - tarball backup written before any mutation
 *   - missing installed source: per-agent error, other agents proceed
 *   - idempotency: second run reports alreadyMigrated and touches nothing
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-migration-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AgentRuntimeAdapter, RuntimeSkill, WorkspaceFile } from '@bakin/core/adapters/runtime'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/lib/plugin-registry', () => ({
  getHookRegistry: () => ({ invoke: async () => undefined }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({ invoke: async () => undefined }),
}))
const silentLogger = {
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}
mock.module('../../src/core/logger', () => silentLogger)
mock.module('@/core/logger', () => silentLogger)

import { migrateToManagedBlocks } from '../../src/core/agent-packages/migration'
import { scanAgentSync } from '../../src/core/agent-packages/sync-scanner'
import {
  type Lockfile,
  type PackageEntry,
  readLockfile,
  writeLockfile,
} from '../../packages/core/src/agent-packages/lockfile'
import { MANAGED_BLOCK_ID } from '../../packages/core/src/agent-packages/composer'
import { extractBlock, hasBlock } from '../../packages/core/src/agent-packages/managed-blocks'

// ─── Disk-backed runtime mock ────────────────────────────────────────────────

type TestGlobal = typeof globalThis & { __bakinAppServices?: { runtime: AgentRuntimeAdapter } }

let rosterIds: Array<{ id: string; name?: string }> = []

function wsPath(agentId: string, path: string): string {
  return join(openClawDir, 'workspaces', agentId, path)
}

function skillDirOf(name: string, agentId: string): string {
  return join(openClawDir, 'workspaces', agentId, 'skills', name)
}

function installRuntimeMock(): void {
  const runtime = {
    agents: {
      list: async () => rosterIds.map((a) => ({ id: a.id, name: a.name ?? a.id, status: 'active' })),
      readWorkspaceFile: async (agentId: string, path: string): Promise<WorkspaceFile | null> => {
        const file = wsPath(agentId, path)
        if (!existsSync(file)) return null
        return { path, content: readFileSync(file, 'utf-8'), metadata: {} }
      },
      writeWorkspaceFile: async (agentId: string, file: WorkspaceFile) => {
        const target = wsPath(agentId, file.path)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, file.content, 'utf-8')
      },
      removeWorkspaceFile: async (agentId: string, path: string) => {
        rmSync(wsPath(agentId, path), { force: true })
      },
    },
    skills: {
      get: async (name: string, agentId?: string): Promise<RuntimeSkill | null> => {
        if (!agentId) return null
        const dir = skillDirOf(name, agentId)
        if (!existsSync(join(dir, 'SKILL.md'))) return null
        return {
          name,
          instructions: readFileSync(join(dir, 'SKILL.md'), 'utf-8'),
          files: { 'SKILL.md': readFileSync(join(dir, 'SKILL.md'), 'utf-8') },
          metadata: {},
        } as RuntimeSkill
      },
      write: async (skill: RuntimeSkill, agentId?: string) => {
        if (!agentId) return
        const dir = skillDirOf(skill.name, agentId)
        const files = skill.files ?? { 'SKILL.md': skill.instructions ?? '' }
        for (const [rel, content] of Object.entries(files)) {
          mkdirSync(dirname(join(dir, rel)), { recursive: true })
          writeFileSync(join(dir, rel), content, 'utf-8')
        }
      },
      remove: async (name: string, agentId?: string) => {
        if (agentId) rmSync(skillDirOf(name, agentId), { recursive: true, force: true })
      },
    },
  } as unknown as AgentRuntimeAdapter
  ;(globalThis as TestGlobal).__bakinAppServices = { runtime }
}

// ─── Legacy fixture ──────────────────────────────────────────────────────────

const PKG_DIR = pathJoin(testDir, 'packages', 'agents', 'pixel@0.1.0')

function seedInstalledPackage(): void {
  mkdirSync(join(PKG_DIR, 'workspace'), { recursive: true })
  mkdirSync(join(PKG_DIR, 'lessons'), { recursive: true })
  writeFileSync(join(PKG_DIR, 'bakin-package.json'), JSON.stringify({
    id: 'pixel',
    kind: 'agent',
    name: 'Pixel',
    version: '0.1.0',
    agent: { identity: { name: 'Pixel' } },
    install: { writeWorkspaceFiles: true, installSkills: true },
    contributions: {
      workspaceFiles: ['workspace/SOUL.md', 'workspace/AGENTS.md'],
      skills: [],
      lessons: ['lessons/style.md'],
      assets: [],
    },
  }))
  writeFileSync(join(PKG_DIR, 'workspace', 'SOUL.md'), '# Soul v2\n\nYou are pixel, renewed.')
  writeFileSync(join(PKG_DIR, 'workspace', 'AGENTS.md'), '# Operating Notes')
  writeFileSync(join(PKG_DIR, 'lessons', 'style.md'), '---\ntitle: Style\ndefaultEnabled: true\n---\n\nStyle lesson body.')
}

function legacyEntry(): PackageEntry {
  return {
    kind: 'agent',
    version: '0.1.0',
    source: PKG_DIR,
    ref: '',
    commitSha: '',
    installedAt: '2026-01-01T00:00:00Z',
    state: 'managed',
    agentId: 'pixel',
    lessonsEnabled: ['style'],
    projections: [
      { kind: 'workspace-file', target: 'runtime:workspace-file:pixel:SOUL.md', sha256: 'old', templateOnly: true },
      { kind: 'lesson-marker', target: 'runtime:workspace-file:pixel:SOUL.md', blockId: 'lesson:pixel:style' },
    ],
  }
}

/** Legacy world: pre-block SOUL.md blend + main with old managed-context. */
function seedLegacyWorld(): void {
  seedInstalledPackage()
  rosterIds = [{ id: 'main', name: 'Roscoe' }, { id: 'pixel', name: 'Pixel' }]
  writeLockfile({ version: 1, packages: { pixel: legacyEntry() } } as Lockfile)

  mkdirSync(join(openClawDir, 'workspaces', 'pixel'), { recursive: true })
  writeFileSync(wsPath('pixel', 'SOUL.md'), [
    '# Soul',
    '',
    'You are pixel. (old template)',
    '',
    'AGENT ADDED THIS PROSE OVER TIME.',
    '',
    '<!-- bakin:lesson-catalog:start -->',
    '- [x] **Style** (`style`)',
    '<!-- bakin:lesson-catalog:end -->',
    '',
    '<!-- bakin:lesson:pixel:style:start -->',
    'Old style lesson body.',
    '<!-- bakin:lesson:pixel:style:end -->',
  ].join('\n'))
  writeFileSync(wsPath('pixel', 'AGENTS.md'), [
    '# Pixel Agent Notes (old template)',
    '',
    '<!-- bakin:managed-context:start -->',
    '## Bakin Managed Context',
    'old rules content',
    '<!-- bakin:managed-context:end -->',
  ].join('\n'))

  mkdirSync(join(openClawDir, 'workspaces', 'main'), { recursive: true })
  writeFileSync(wsPath('main', 'AGENTS.md'), [
    '# Main Agent',
    '',
    'MAIN USER PROSE — must survive.',
    '',
    '<!-- bakin:managed-context:start -->',
    '## Bakin Orchestrator Rules (old)',
    '<!-- bakin:managed-context:end -->',
  ].join('\n'))
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  rosterIds = []
  installRuntimeMock()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('migrateToManagedBlocks', () => {
  it('fully overwrites legacy managed agents with composed block-only files', async () => {
    seedLegacyWorld()
    const result = await migrateToManagedBlocks()
    expect(result.alreadyMigrated).toBe(false)

    const pixel = result.agents.find((a) => a.agentId === 'pixel')
    expect(pixel?.error).toBeUndefined()
    expect(pixel?.filesOverwritten.sort()).toEqual(['AGENTS.md', 'SOUL.md'])

    const soul = readFileSync(wsPath('pixel', 'SOUL.md'), 'utf-8')
    expect(soul).not.toContain('AGENT ADDED THIS PROSE OVER TIME.')
    expect(soul).not.toContain('lesson-catalog:start')
    const body = extractBlock(soul, MANAGED_BLOCK_ID) ?? ''
    expect(body).toContain('You are pixel, renewed.')
    expect(body).toContain('Style lesson body.')

    const agents = readFileSync(wsPath('pixel', 'AGENTS.md'), 'utf-8')
    expect(agents).not.toContain('managed-context:start')
    expect(extractBlock(agents, MANAGED_BLOCK_ID)).toContain('role:subagent')
  })

  it('rewrites the lockfile to v2 and the post-state scans clean', async () => {
    seedLegacyWorld()
    const result = await migrateToManagedBlocks()
    expect(result.agents.every((a) => !a.error)).toBe(true)

    const entry = readLockfile().packages.pixel
    expect(entry.projections?.every((p) => p.kind !== 'lesson-marker' && !p.templateOnly)).toBe(true)
    expect(entry.projections?.some((p) => p.kind === 'workspace-file' && p.composedSha)).toBe(true)

    const scan = await scanAgentSync()
    expect(scan.migrationNeeded).toBe(false)
    expect(scan.findings).toEqual([])
  })

  it('preserves unmanaged agents\' prose, swapping only the legacy blocks', async () => {
    seedLegacyWorld()
    const result = await migrateToManagedBlocks()

    const main = result.agents.find((a) => a.agentId === 'main')
    expect(main?.state).toBe('unmanaged')
    expect(main?.legacyBlocksRemoved).toContain('managed-context')
    expect(main?.filesOverwritten).toEqual([])

    const agents = readFileSync(wsPath('main', 'AGENTS.md'), 'utf-8')
    expect(agents).toContain('MAIN USER PROSE — must survive.')
    expect(agents).not.toContain('Bakin Orchestrator Rules (old)')
    expect(extractBlock(agents, MANAGED_BLOCK_ID)).toContain('role:orchestrator')
  })

  it('writes a tarball backup before mutating anything', async () => {
    seedLegacyWorld()
    const result = await migrateToManagedBlocks()
    expect(result.backupPath).not.toBeNull()
    expect(existsSync(result.backupPath!)).toBe(true)
    expect(result.backupPath!).toContain('.backups')
  })

  it('records a per-agent error when the installed source is missing, others proceed', async () => {
    seedLegacyWorld()
    rmSync(PKG_DIR, { recursive: true, force: true })
    const result = await migrateToManagedBlocks()

    const pixel = result.agents.find((a) => a.agentId === 'pixel')
    expect(pixel?.error).toContain('Installed source missing')
    // pixel's files untouched (no replacement available — don't destroy)
    expect(readFileSync(wsPath('pixel', 'SOUL.md'), 'utf-8')).toContain('AGENT ADDED THIS PROSE OVER TIME.')

    // main still migrated fine
    const main = result.agents.find((a) => a.agentId === 'main')
    expect(main?.error).toBeUndefined()
    expect(hasBlock(readFileSync(wsPath('main', 'AGENTS.md'), 'utf-8'), MANAGED_BLOCK_ID)).toBe(true)
  })

  it('is idempotent — second run reports alreadyMigrated and changes nothing', async () => {
    seedLegacyWorld()
    await migrateToManagedBlocks()
    const soulAfterFirst = readFileSync(wsPath('pixel', 'SOUL.md'), 'utf-8')
    const backupsAfterFirst = readdirSync(join(testDir, '.backups')).length

    const second = await migrateToManagedBlocks()
    expect(second.alreadyMigrated).toBe(true)
    expect(second.agents).toEqual([])
    expect(readFileSync(wsPath('pixel', 'SOUL.md'), 'utf-8')).toBe(soulAfterFirst)
    expect(readdirSync(join(testDir, '.backups')).length).toBe(backupsAfterFirst)
  })
})
