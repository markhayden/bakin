/**
 * Tests for the sync engine (layered-context spec, C5).
 *
 * Coverage:
 *   - local sync (fetch: false) recomposes blocks after a context edit and
 *     the receipt records recomposed blocks + ok verification
 *   - --check mutates NOTHING (workspace, lockfile, receipts all untouched)
 *   - sentineled skill skipped with reclaim hint; --reclaim discards local
 *     edits, re-projects, and records the reclaim
 *   - unmanaged agents get their context AGENTS.md block maintained
 *   - receipts persist (latest only) and are readable
 *   - syncAll covers roster + lockfile agents, capturing per-agent errors
 *   - MigrationRequiredError on legacy lockfile shapes
 *   - lesson toggle = lockfile change + local sync (SOUL block recomposed)
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-sync-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
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
mock.module('../../src/core/plugin-registry', () => ({
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

import {
  MigrationRequiredError,
  lockfileNeedsMigration,
  syncAgent,
  syncAllAgents,
} from '../../src/core/agent-packages/sync'
import { setLessonEnabled } from '../../src/core/agent-packages/lesson-toggle'
import { readReceipt, receiptPath } from '../../src/core/agent-packages/receipts'
import {
  type Lockfile,
  type PackageEntry,
  readLockfile,
  writeLockfile,
} from '../../packages/core/src/agent-packages/lockfile'
import { MANAGED_BLOCK_ID } from '../../packages/core/src/agent-packages/composer'
import { extractBlock, hasBlock } from '../../packages/core/src/agent-packages/managed-blocks'
import { getGlobalContextPath, seedContextFiles } from '../../src/core/team-context'
import { projectPackage } from '../../src/core/agent-packages/projector'
import { settleFor } from '../helpers/wait'

// ─── Disk-backed runtime mock (same shape as projector.test.ts) ─────────────

type TestGlobal = typeof globalThis & { __bakinAppServices?: { runtime: AgentRuntimeAdapter } }

let rosterIds: Array<{ id: string; name?: string }> = []

function readJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return null }
}

function readSkillTree(root: string, prefix = ''): Record<string, string> {
  const files: Record<string, string> = {}
  if (!existsSync(join(root, prefix))) return files
  for (const entry of require('fs').readdirSync(join(root, prefix), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) Object.assign(files, readSkillTree(root, rel))
    else if (entry.isFile()) {
      if (entry.name === '.installedBy' || entry.name === '.userEdited') continue
      files[rel] = readFileSync(join(root, rel), 'utf-8')
    }
  }
  return files
}

function wsPath(agentId: string, path: string): string {
  return join(openClawDir, 'workspaces', agentId, path)
}

function skillDir(name: string, agentId?: string): string {
  return agentId
    ? join(openClawDir, 'workspaces', agentId, 'skills', name)
    : join(openClawDir, 'skills', name)
}

function installRuntimeMock(): void {
  const runtime = {
    agents: {
      list: async () => rosterIds.map((a) => ({ id: a.id, name: a.name ?? a.id, status: 'active' })),
      get: async (agentId: string) => {
        const entry = rosterIds.find((a) => a.id === agentId)
        return entry ? { id: entry.id, name: entry.name ?? entry.id, status: 'active' } : null
      },
      update: async (agentId: string, input: { name?: string }) => {
        const entry = rosterIds.find((a) => a.id === agentId)
        if (!entry) throw new Error(`update: unknown agent ${agentId}`)
        if (input.name) entry.name = input.name
        return { id: entry.id, name: entry.name ?? entry.id, status: 'active' }
      },
      readWorkspaceFile: async (agentId: string, path: string): Promise<WorkspaceFile | null> => {
        const file = wsPath(agentId, path)
        if (!existsSync(file)) return null
        return { path, content: readFileSync(file, 'utf-8'), metadata: { userEdited: existsSync(`${file}.userEdited`) } }
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
        const dir = skillDir(name, agentId)
        if (!existsSync(join(dir, 'SKILL.md'))) return null
        return {
          name,
          instructions: readFileSync(join(dir, 'SKILL.md'), 'utf-8'),
          files: readSkillTree(dir),
          metadata: {
            installedBy: readJson(join(dir, '.installedBy')),
            userEdited: existsSync(join(dir, '.userEdited')),
          },
        } as RuntimeSkill
      },
      write: async (skill: RuntimeSkill, agentId?: string) => {
        const dir = skillDir(skill.name, agentId)
        const files = skill.files ?? { 'SKILL.md': skill.instructions ?? '' }
        for (const [rel, content] of Object.entries(files)) {
          mkdirSync(dirname(join(dir, rel)), { recursive: true })
          writeFileSync(join(dir, rel), content, 'utf-8')
        }
        if (skill.metadata?.installedBy) {
          writeFileSync(join(dir, '.installedBy'), JSON.stringify(skill.metadata.installedBy), 'utf-8')
        }
      },
      remove: async (name: string, agentId?: string) => {
        rmSync(skillDir(name, agentId), { recursive: true, force: true })
      },
    },
  } as unknown as AgentRuntimeAdapter
  ;(globalThis as TestGlobal).__bakinAppServices = { runtime }
}

// ─── Fixture: installed pixel package + synced baseline ──────────────────────

const PKG_DIR = pathJoin(testDir, 'packages', 'agents', 'pixel@0.1.0')

function seedInstalledPackage(): void {
  mkdirSync(join(PKG_DIR, 'workspace'), { recursive: true })
  mkdirSync(join(PKG_DIR, 'lessons'), { recursive: true })
  mkdirSync(join(PKG_DIR, 'skills', 'image-gen'), { recursive: true })
  writeFileSync(join(PKG_DIR, 'bakin-package.json'), JSON.stringify({
    id: 'pixel',
    kind: 'agent',
    name: 'Pixel',
    version: '0.1.0',
    agent: { identity: { name: 'Pixel' } },
    install: { writeWorkspaceFiles: true, installSkills: true },
    contributions: {
      workspaceFiles: ['workspace/SOUL.md'],
      skills: ['skills/image-gen'],
      lessons: ['lessons/style.md'],
      assets: [],
    },
  }))
  writeFileSync(join(PKG_DIR, 'workspace', 'SOUL.md'), '# Soul\n\nYou are pixel.')
  writeFileSync(join(PKG_DIR, 'lessons', 'style.md'), '---\ntitle: Style\ndefaultEnabled: true\n---\n\nStyle lesson body.')
  writeFileSync(join(PKG_DIR, 'skills', 'image-gen', 'SKILL.md'), '# image-gen')
}

function lockEntry(overrides: Partial<PackageEntry> = {}): PackageEntry {
  return {
    kind: 'agent',
    version: '0.1.0',
    source: PKG_DIR, // local source — updater re-fetches from here
    ref: '',
    commitSha: '',
    installedAt: '2026-06-01T00:00:00Z',
    state: 'managed',
    agentId: 'pixel',
    lessonsEnabled: ['style'],
    projections: [],
    ...overrides,
  }
}

/** Install the fixture into a fully-synced baseline via a real local sync. */
async function seedSyncedBaseline(): Promise<void> {
  seedContextFiles()
  seedInstalledPackage()
  rosterIds = [{ id: 'main', name: 'Roscoe' }, { id: 'pixel', name: 'Pixel' }]
  writeLockfile({ version: 1, packages: { pixel: lockEntry() } })
  await syncAgent('pixel', { fetch: false })
  await syncAgent('main', { fetch: false })
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

describe('syncAgent — local sync', () => {
  it('brings a fresh install into verified sync', async () => {
    await seedSyncedBaseline()
    const receipt = await syncAgent('pixel', { fetch: false })
    expect(receipt.verification.status).toBe('ok')
    expect(receipt.state).toBe('managed')
    expect(receipt.blocks.find((b) => b.file === 'SOUL.md')?.action).toBe('unchanged')
    expect(hasBlock(readFileSync(wsPath('pixel', 'SOUL.md'), 'utf-8'), MANAGED_BLOCK_ID)).toBe(true)
  })

  it('recomposes stale blocks after a global context edit and says so in the receipt', async () => {
    await seedSyncedBaseline()
    writeFileSync(getGlobalContextPath(), '# House Rules\n\n- Be excellent')

    const receipt = await syncAgent('pixel', { fetch: false })
    const agentsBlock = receipt.blocks.find((b) => b.file === 'AGENTS.md')
    expect(agentsBlock?.action).toBe('recomposed')
    expect(agentsBlock?.sections).toContain('global')
    expect(receipt.verification.status).toBe('ok')
    expect(readFileSync(wsPath('pixel', 'AGENTS.md'), 'utf-8')).toContain('Be excellent')
  })

  it('persists the latest receipt only', async () => {
    await seedSyncedBaseline()
    await syncAgent('pixel', { fetch: false })
    const first = readReceipt('pixel')
    await settleFor(5, 'advance the clock so the second receipt gets a distinct timestamp')
    await syncAgent('pixel', { fetch: false })
    const second = readReceipt('pixel')
    expect(second?.syncedAt && first?.syncedAt && second.syncedAt >= first.syncedAt).toBe(true)
  })
})

describe('syncAgent — identity refresh', () => {
  it('re-applies the manifest display name when the runtime has drifted', async () => {
    await seedSyncedBaseline()
    // Simulate drift: the runtime record predates a package rename.
    rosterIds.find((a) => a.id === 'pixel')!.name = 'pixel'
    const receipt = await syncAgent('pixel', { fetch: false })
    expect(rosterIds.find((a) => a.id === 'pixel')!.name).toBe('Pixel')
    expect(receipt.projections).toContainEqual({ target: 'runtime:agent:pixel:name', kind: 'identity', action: 'written' })
  })

  it('no-ops when the name already matches (no identity projection in the receipt)', async () => {
    await seedSyncedBaseline()
    const receipt = await syncAgent('pixel', { fetch: false })
    expect(receipt.projections.find((p) => p.kind === 'identity')).toBeUndefined()
  })

  it('--check never touches the runtime name even when drifted', async () => {
    await seedSyncedBaseline()
    rosterIds.find((a) => a.id === 'pixel')!.name = 'pixel'
    await syncAgent('pixel', { fetch: false, check: true })
    expect(rosterIds.find((a) => a.id === 'pixel')!.name).toBe('pixel')
  })
})

describe('syncAgent — --check mutates nothing', () => {
  it('reports staleness without writing workspace, lockfile, or receipts', async () => {
    await seedSyncedBaseline()
    writeFileSync(getGlobalContextPath(), '# House Rules\n\n- Be excellent')

    const agentsBefore = readFileSync(wsPath('pixel', 'AGENTS.md'), 'utf-8')
    const lockBefore = readFileSync(join(testDir, 'packages', 'lock.json'), 'utf-8')
    const receiptBefore = readFileSync(receiptPath('pixel'), 'utf-8')

    const receipt = await syncAgent('pixel', { check: true, fetch: false })
    expect(receipt.checkOnly).toBe(true)
    expect(receipt.verification.status).toBe('issues')
    expect(receipt.verification.findings.some((f) => f.type === 'block-stale')).toBe(true)

    expect(readFileSync(wsPath('pixel', 'AGENTS.md'), 'utf-8')).toBe(agentsBefore)
    expect(readFileSync(join(testDir, 'packages', 'lock.json'), 'utf-8')).toBe(lockBefore)
    expect(readFileSync(receiptPath('pixel'), 'utf-8')).toBe(receiptBefore)
  })
})

describe('syncAgent — .userEdited skills + reclaim', () => {
  it('skips a sentineled skill loudly, then --reclaim takes it back', async () => {
    await seedSyncedBaseline()
    const dir = skillDir('image-gen', 'pixel')
    writeFileSync(join(dir, 'SKILL.md'), '# my hand-tuned version')
    writeFileSync(join(dir, '.userEdited'), '')

    const receipt = await syncAgent('pixel', { fetch: false })
    expect(receipt.skipped).toHaveLength(1)
    expect(receipt.skipped[0].reason).toBe('userEdited')
    expect(receipt.skipped[0].hint).toContain('--reclaim')
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf-8')).toBe('# my hand-tuned version')
    // Still tracked in the lockfile despite the skip
    const entry = readLockfile().packages.pixel
    expect(entry.projections?.some((p) => p.kind === 'skill')).toBe(true)

    const reclaimed = await syncAgent('pixel', { fetch: false, reclaim: ['image-gen'] })
    expect(reclaimed.projections.some((p) => p.action === 'reclaimed')).toBe(true)
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf-8')).toBe('# image-gen')
    expect(existsSync(join(dir, '.userEdited'))).toBe(false)
    expect(reclaimed.verification.status).toBe('ok')
  })
})

describe('syncAgent — unmanaged agents', () => {
  it('maintains the context AGENTS.md block for agents with no package', async () => {
    await seedSyncedBaseline()
    writeFileSync(getGlobalContextPath(), '# House Rules\n\n- {{agentName}} logs progress')

    const receipt = await syncAgent('main', { fetch: false })
    expect(receipt.state).toBe('unmanaged')
    const agents = readFileSync(wsPath('main', 'AGENTS.md'), 'utf-8')
    const body = extractBlock(agents, MANAGED_BLOCK_ID) ?? ''
    expect(body).toContain('Roscoe logs progress')
    expect(body).toContain('role:orchestrator')
    expect(receipt.verification.status).toBe('ok')
  })

  it('preserves unmanaged agent prose outside the block', async () => {
    await seedSyncedBaseline()
    const path = wsPath('main', 'AGENTS.md')
    writeFileSync(path, readFileSync(path, 'utf-8') + '\nMain agent notes.\n')
    await syncAgent('main', { fetch: false })
    expect(readFileSync(path, 'utf-8')).toContain('Main agent notes.')
  })
})

describe('syncAllAgents', () => {
  it('syncs roster + lockfile agents and isolates per-agent errors', async () => {
    await seedSyncedBaseline()
    rosterIds.push({ id: 'zen', name: 'Zen' })
    const results = await syncAllAgents({ fetch: false })
    expect(results.map((r) => r.agentId).sort()).toEqual(['main', 'pixel', 'zen'])
    expect(results.every((r) => r.receipt && !r.error)).toBe(true)
  })
})

describe('migration gating', () => {
  it('refuses to sync legacy lockfile entries', async () => {
    await seedSyncedBaseline()
    const entry = readLockfile().packages.pixel
    writeLockfile({
      version: 1,
      packages: {
        pixel: {
          ...entry,
          projections: [{ kind: 'workspace-file', target: 'runtime:workspace-file:pixel:SOUL.md', sha256: 'x', templateOnly: true }],
        },
      },
    } as Lockfile)
    expect(lockfileNeedsMigration()).toBe(true)
    await expect(syncAgent('pixel', { fetch: false })).rejects.toThrow(MigrationRequiredError)
  })
})

describe('lesson toggle → recomposition', () => {
  it('toggling a lesson recomposes the SOUL block via local sync', async () => {
    await seedSyncedBaseline()
    let body = extractBlock(readFileSync(wsPath('pixel', 'SOUL.md'), 'utf-8'), MANAGED_BLOCK_ID) ?? ''
    expect(body).toContain('Style lesson body.')

    const result = await setLessonEnabled('pixel', 'style', false)
    expect(result.changed).toBe(true)

    body = extractBlock(readFileSync(wsPath('pixel', 'SOUL.md'), 'utf-8'), MANAGED_BLOCK_ID) ?? ''
    expect(body).not.toContain('Style lesson body.')
    expect(body).toContain('- [ ] **Style** (`style`)')
    expect(readLockfile().packages.pixel.lessonsEnabled).toEqual([])
  })
})

// Reference so the projector import (used implicitly via sync) isn't flagged
void projectPackage
