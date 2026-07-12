/**
 * Workspace content carry — kind-aware snapshot + degrade-never-throw write
 * semantics the integration switch test doesn't isolate: skill-subtree
 * exclusion via stats, the stats-absent fallback, package-managed skill
 * skips, per-file write-failure degradation, and existing-agent skips.
 */
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, it, expect, mock } from 'bun:test'

const testDir = join(tmpdir(), `bakin-test-workspace-carry-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { snapshotAgentContent, carryAgentContent, previewWorkspaceCarry } from '../../src/core/workspace-carry'
import type { AgentRuntimeAdapter, RuntimeSkill, WorkspaceFile, WorkspaceFileStat } from '@bakin/core/adapters/runtime'

function sourceWith(overrides: {
  files?: Record<string, string>
  stats?: WorkspaceFileStat[] | null
  skills?: Array<{ name: string; installedBy?: unknown }>
  listThrows?: boolean
  skillsThrow?: boolean
}): AgentRuntimeAdapter {
  return {
    agents: {
      listWorkspaceFiles: async () => {
        if (overrides.listThrows) throw new Error('source workspace unreadable')
        return Object.keys(overrides.files ?? {})
      },
      readWorkspaceFile: async (_id: string, path: string): Promise<WorkspaceFile | null> => {
        const content = (overrides.files ?? {})[path]
        return content === undefined ? null : { path, content }
      },
      workspaceFileStats: overrides.stats === null ? undefined : async () => overrides.stats ?? [],
    },
    skills: {
      list: async () => {
        if (overrides.skillsThrow) throw new Error('skills unreadable')
        return (overrides.skills ?? []).map((s) => ({ name: s.name }))
      },
      get: async (name: string): Promise<RuntimeSkill | null> => {
        const found = (overrides.skills ?? []).find((s) => s.name === name)
        if (!found) return null
        return {
          name,
          instructions: `# ${name}`,
          files: { 'SKILL.md': `# ${name}` },
          ...(found.installedBy ? { metadata: { installedBy: found.installedBy } } : {}),
        }
      },
    },
  } as unknown as AgentRuntimeAdapter
}

function targetRecorder(overrides?: { failPaths?: string[]; failSkills?: string[] }) {
  const writes: Array<{ agentId: string; path: string; content: string }> = []
  const skillWrites: Array<{ agentId: string; name: string }> = []
  const target = {
    agents: {
      writeWorkspaceFile: async (agentId: string, file: WorkspaceFile) => {
        if (overrides?.failPaths?.includes(file.path)) throw new Error(`write denied: ${file.path}`)
        writes.push({ agentId, path: file.path, content: file.content })
      },
    },
    skills: {
      write: async (skill: RuntimeSkill, agentId?: string) => {
        if (overrides?.failSkills?.includes(skill.name)) throw new Error(`skill write denied: ${skill.name}`)
        skillWrites.push({ agentId: agentId ?? '<global>', name: skill.name })
      },
    },
  } as unknown as AgentRuntimeAdapter
  return { target, writes, skillWrites }
}

const AGENT = [{ id: 'pixel', name: 'Pixel' }]

describe('snapshotAgentContent — kind-aware capture', () => {
  it("excludes the skill subtree derived from stats 'skill' entries; skills ride the skills surface", async () => {
    const source = sourceWith({
      files: {
        'SOUL.md': 'i am pixel',
        'memory/2026-07.md': 'remembered things',
        'skills/crafting/SKILL.md': 'craft',
        'skills/crafting/reference.md': 'aux file in the skill dir',
      },
      stats: [
        { name: 'SOUL.md', bytes: 10, mtimeMs: 0, kind: 'canonical' },
        { name: 'memory/2026-07.md', bytes: 17, mtimeMs: 0, kind: 'memory' },
        { name: 'skills/crafting/SKILL.md', bytes: 5, mtimeMs: 0, kind: 'skill' },
      ],
      skills: [{ name: 'crafting' }],
    })
    const snapshot = await snapshotAgentContent(source, AGENT)
    const content = snapshot.agents.get('pixel')!
    expect(content.files.map((f) => f.path).sort()).toEqual(['SOUL.md', 'memory/2026-07.md'])
    expect(content.skills.map((s) => s.name)).toEqual(['crafting'])
    expect(content.errors).toEqual([])
  })

  it('carries every listed file when the adapter has no stats surface', async () => {
    const source = sourceWith({
      files: { 'SOUL.md': 'x', 'notes/a.md': 'y' },
      stats: null,
    })
    const snapshot = await snapshotAgentContent(source, AGENT)
    expect(snapshot.agents.get('pixel')!.files.map((f) => f.path).sort()).toEqual(['SOUL.md', 'notes/a.md'])
  })

  it('skips package-managed skills (installedBy marker) — sync re-projects those', async () => {
    const source = sourceWith({
      skills: [
        { name: 'own-skill' },
        { name: 'pack-skill', installedBy: { package: 'bits/pack' } },
      ],
    })
    const snapshot = await snapshotAgentContent(source, AGENT)
    const content = snapshot.agents.get('pixel')!
    expect(content.skills.map((s) => s.name)).toEqual(['own-skill'])
    expect(content.skippedPackageManaged).toBe(1)
  })

  it('a dead source degrades to per-agent error notes, never throws', async () => {
    const source = sourceWith({ listThrows: true, skillsThrow: true })
    const snapshot = await snapshotAgentContent(source, AGENT)
    const content = snapshot.agents.get('pixel')!
    expect(content.files).toEqual([])
    expect(content.errors).toEqual([
      'workspace files: source workspace unreadable',
      'skills: skills unreadable',
    ])
  })
})

describe('carryAgentContent — degrade, never throw', () => {
  async function snapshotOf(files: Record<string, string>, skills: Array<{ name: string; installedBy?: unknown }> = []) {
    return snapshotAgentContent(sourceWith({ files, stats: null, skills }), AGENT)
  }

  it('writes files + skills for carried agents and reports byte-honest counts', async () => {
    const snapshot = await snapshotOf({ 'SOUL.md': 'i am pixel', 'memory/a.md': 'notes' }, [{ name: 'crafting' }])
    const { target, writes, skillWrites } = targetRecorder()
    const report = await carryAgentContent(snapshot, target, ['pixel'], [])
    expect(writes.map((w) => w.path).sort()).toEqual(['SOUL.md', 'memory/a.md'])
    expect(skillWrites).toEqual([{ agentId: 'pixel', name: 'crafting' }])
    expect(report.carried).toEqual([{ agentId: 'pixel', files: 2, bytes: Buffer.byteLength('i am pixel') + Buffer.byteLength('notes') }])
    expect(report.skills).toEqual([{ agentId: 'pixel', carried: 1, skippedPackageManaged: 0 }])
    expect(report.failed).toEqual([])
  })

  it('existing target agents are NEVER written — reported skipped when the source had content', async () => {
    const snapshot = await snapshotOf({ 'SOUL.md': 'x' })
    const { target, writes } = targetRecorder()
    const report = await carryAgentContent(snapshot, target, [], ['pixel'])
    expect(writes).toEqual([])
    expect(report.carried).toEqual([])
    expect(report.skippedExisting).toEqual(['pixel'])
  })

  it('a write failure degrades to failed[] while the rest of the carry continues', async () => {
    const snapshot = await snapshotOf({ 'SOUL.md': 'x', 'memory/a.md': 'y' }, [{ name: 'crafting' }])
    const { target, writes, skillWrites } = targetRecorder({ failPaths: ['SOUL.md'], failSkills: ['crafting'] })
    const report = await carryAgentContent(snapshot, target, ['pixel'], [])
    expect(writes.map((w) => w.path)).toEqual(['memory/a.md'])
    expect(skillWrites).toEqual([])
    expect(report.carried).toEqual([{ agentId: 'pixel', files: 1, bytes: 1 }])
    expect(report.failed).toEqual([
      { agentId: 'pixel', path: 'SOUL.md', error: 'write denied: SOUL.md' },
      { agentId: 'pixel', path: 'skill:crafting', error: 'skill write denied: crafting' },
    ])
  })

  it('previewWorkspaceCarry reports the same counts as a real carry, with zero writes', async () => {
    const snapshot = await snapshotOf({ 'SOUL.md': 'i am pixel', 'memory/a.md': 'notes' }, [
      { name: 'crafting' },
      { name: 'pack-skill', installedBy: { package: 'bits/pack' } },
    ])
    const preview = previewWorkspaceCarry(snapshot, ['pixel'], [])
    const { target, writes, skillWrites } = targetRecorder()
    const real = await carryAgentContent(snapshot, target, ['pixel'], [])
    expect(preview).toEqual(real)
    expect(writes.length).toBe(2)
    expect(skillWrites.length).toBe(1)
  })

  it('snapshot-side read failures surface in failed[] for carried agents', async () => {
    const snapshot = await snapshotAgentContent(sourceWith({ listThrows: true }), AGENT)
    const { target } = targetRecorder()
    const report = await carryAgentContent(snapshot, target, ['pixel'], [])
    expect(report.failed).toEqual([
      { agentId: 'pixel', path: '<snapshot>', error: 'workspace files: source workspace unreadable' },
    ])
  })
})
