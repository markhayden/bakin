/**
 * Tests for the projector (rewritten for the layered-context block model, C5).
 *
 * Coverage:
 *   - Agent projection writes ONE composed managed block per contributed
 *     workspace file (template + lessons inside the block), creating files
 *     that don't exist and preserving agent content in ones that do
 *   - Re-projection rewrites the block in place (idempotent; agent prose
 *     outside the markers survives)
 *   - Lesson catalog checkboxes + enabled-lesson bodies live inside the
 *     SOUL.md block; enabledLessons override + defaultEnabled fallback
 *   - Skills + assets project with sidecars; .userEdited skips recorded
 *     (workspace files NO LONGER honor .userEdited — blocks are Bakin-owned)
 *   - Projection entries carry composedSha + inputs (no templateOnly /
 *     lesson-marker kinds)
 *   - Mid-projection failure rolls back workspace block writes
 *   - skill-pack projects to global skills
 *   - unprojectPackage removes skills/assets but only strips the BLOCK from
 *     workspace files (never deletes them); legacy entries handled
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-projector-${Date.now()}-${randomUUID()}`)
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

import {
  projectPackage,
  unprojectPackage,
  type ProjectorOptions,
} from '../../src/core/agent-packages/projector'
import {
  markUserEdited,
  readInstalledBy,
  writeInstalledBy,
} from '../../packages/core/src/agent-packages/markers'
import {
  extractBlock,
  hasBlock,
} from '../../packages/core/src/agent-packages/managed-blocks'
import { MANAGED_BLOCK_ID } from '../../packages/core/src/agent-packages/composer'
import type {
  AgentManifest,
  Manifest,
  SkillPackManifest,
} from '../../packages/core/src/agent-packages/manifest'

type TestGlobal = typeof globalThis & {
  __bakinAppServices?: { runtime: AgentRuntimeAdapter }
}

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  installRuntimeMock()
})

const NOW = '2026-04-24T12:00:00Z'

function pixelManifest(): AgentManifest {
  return {
    id: 'pixel',
    kind: 'agent',
    name: 'Pixel',
    version: '0.1.0',
    agent: { identity: { name: 'Pixel' } },
    install: {
      writeWorkspaceFiles: true,
      installSkills: true,
      enableLessons: ['prompt-style-system'],
    },
    contributions: {
      workspaceFiles: ['workspace/SOUL.md', 'workspace/IDENTITY.md'],
      skills: ['skills/test-skill'],
      lessons: [
        'lessons/prompt-style-system.md',
        'lessons/social-media.md',
      ],
      assets: ['assets/avatar.jpg'],
    },
  }
}

function seedPackageStaging(): string {
  const stagingDir = join(testDir, 'staging-pixel')
  mkdirSync(join(stagingDir, 'workspace'), { recursive: true })
  mkdirSync(join(stagingDir, 'skills', 'test-skill'), { recursive: true })
  mkdirSync(join(stagingDir, 'lessons'), { recursive: true })
  mkdirSync(join(stagingDir, 'assets'), { recursive: true })

  writeFileSync(join(stagingDir, 'workspace', 'SOUL.md'), `# Soul\n\nYou are Pixel.`)
  writeFileSync(join(stagingDir, 'workspace', 'IDENTITY.md'), `# IDENTITY\n\n- **Name:** Pixel`)
  writeFileSync(join(stagingDir, 'skills', 'test-skill', 'SKILL.md'), '# Skill\n')

  writeFileSync(
    join(stagingDir, 'lessons', 'prompt-style-system.md'),
    `---\ntitle: Prompt Style System\ndefaultEnabled: true\n---\n\n## Anatomy of a prompt\n\nFour ingredients...`,
  )
  writeFileSync(
    join(stagingDir, 'lessons', 'social-media.md'),
    `---\ntitle: Social Media\ndefaultEnabled: false\n---\n\nViral patterns...`,
  )

  writeFileSync(join(stagingDir, 'assets', 'avatar.jpg'), 'fake-jpg-bytes')

  return stagingDir
}

function fixedInstalledBy(): ProjectorOptions['installedBy'] {
  return {
    package: 'pixel',
    version: '0.1.0',
    ref: 'v0.1.0',
    commitSha: 'abc123',
    installedAt: NOW,
  }
}

function pixelOptions(): ProjectorOptions {
  return {
    manifest: pixelManifest(),
    stagingDir: seedPackageStaging(),
    agentId: 'pixel',
    installedBy: fixedInstalledBy(),
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function readSkillTree(root: string, prefix = ''): Record<string, string> {
  const files: Record<string, string> = {}
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
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

function readSoul(): string {
  return readFileSync(runtimeWorkspaceFile('pixel', 'SOUL.md'), 'utf-8')
}

function installRuntimeMock(): void {
  const runtime = {
    agents: {
      list: async () => [
        { id: 'main', name: 'Roscoe', status: 'active' },
        { id: 'pixel', name: 'Pixel', status: 'active' },
      ],
      listWorkspaceFiles: async () => [],
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
        }
      },
      removeWorkspaceFile: async (agentId: string, path: string) => {
        rmSync(runtimeWorkspaceFile(agentId, path), { force: true })
        rmSync(`${runtimeWorkspaceFile(agentId, path)}.installedBy`, { force: true })
      },
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
        }
      },
      remove: async (name: string, agentId?: string) => {
        rmSync(runtimeSkillDir(name, agentId), { recursive: true, force: true })
      },
    },
  } as unknown as AgentRuntimeAdapter
  ;(globalThis as TestGlobal).__bakinAppServices = { runtime }
}

// ─── Composed-block projection ───────────────────────────────────────────────

describe('projectPackage — composed managed blocks', () => {
  it('creates each contributed workspace file with exactly one managed block', async () => {
    const result = await projectPackage(pixelOptions())

    const soul = readSoul()
    expect(hasBlock(soul, MANAGED_BLOCK_ID)).toBe(true)
    const body = extractBlock(soul, MANAGED_BLOCK_ID) ?? ''
    expect(body).toContain('<!-- bakin-section: package -->')
    expect(body).toContain('You are Pixel.')

    const identity = readFileSync(runtimeWorkspaceFile('pixel', 'IDENTITY.md'), 'utf-8')
    expect(extractBlock(identity, MANAGED_BLOCK_ID)).toContain('- **Name:** Pixel')

    // SOUL + IDENTITY from the package, plus AGENTS.md which always gets
    // the context-layer block (role context is seeded by the projector).
    const wsProjections = result.projections.filter((p) => p.kind === 'workspace-file')
    expect(wsProjections).toHaveLength(3)
    const agentsMd = readFileSync(runtimeWorkspaceFile('pixel', 'AGENTS.md'), 'utf-8')
    expect(extractBlock(agentsMd, MANAGED_BLOCK_ID)).toContain('bakin-section: role:subagent')
    expect(wsProjections.every((p) => typeof p.composedSha === 'string')).toBe(true)
    expect(wsProjections.every((p) => p.templateOnly === undefined)).toBe(true)
    expect(result.projections.some((p) => p.kind === 'lesson-marker')).toBe(false)
  })

  it('preserves agent content outside the block in existing files', async () => {
    const wsDir = join(openClawDir, 'workspaces', 'pixel')
    mkdirSync(wsDir, { recursive: true })
    writeFileSync(join(wsDir, 'SOUL.md'), `# Existing Pixel SOUL\n\nUser-written content.\n`)

    await projectPackage(pixelOptions())

    const soul = readSoul()
    expect(soul).toContain('# Existing Pixel SOUL')
    expect(soul).toContain('User-written content.')
    expect(hasBlock(soul, MANAGED_BLOCK_ID)).toBe(true)
  })

  it('re-projection is idempotent and rewrites the block in place', async () => {
    await projectPackage(pixelOptions())
    const soulPath = runtimeWorkspaceFile('pixel', 'SOUL.md')
    writeFileSync(soulPath, readFileSync(soulPath, 'utf-8') + '\nAgent-added new section.\n')

    // Change the template, re-project — block updates, agent prose stays
    const opts = pixelOptions()
    writeFileSync(join(opts.stagingDir, 'workspace', 'SOUL.md'), `# Soul v2\n\nYou are Pixel, renewed.`)
    await projectPackage(opts)

    const after = readSoul()
    expect(after).toContain('Agent-added new section.')
    expect(extractBlock(after, MANAGED_BLOCK_ID)).toContain('You are Pixel, renewed.')
    expect(after).not.toContain('You are Pixel.\n') // old template gone from block

    // Identical re-projection: byte-stable
    await projectPackage(opts)
    expect(readSoul()).toBe(after)
  })

  it('composes the lesson catalog + enabled bodies inside the SOUL block', async () => {
    await projectPackage(pixelOptions())
    const body = extractBlock(readSoul(), MANAGED_BLOCK_ID) ?? ''
    expect(body).toContain('<!-- bakin-section: lessons -->')
    expect(body).toContain('[x] **Prompt Style System**')
    expect(body).toContain('[ ] **Social Media**')
    expect(body).toContain('Four ingredients...')
    expect(body).not.toContain('Viral patterns...')
  })

  it('falls back to defaultEnabled frontmatter when install.enableLessons is undefined', async () => {
    const opts = pixelOptions()
    opts.manifest = { ...opts.manifest, install: { ...(opts.manifest as AgentManifest).install, enableLessons: undefined } } as Manifest
    await projectPackage(opts)
    const body = extractBlock(readSoul(), MANAGED_BLOCK_ID) ?? ''
    expect(body).toContain('Four ingredients...') // defaultEnabled: true
    expect(body).not.toContain('Viral patterns...') // defaultEnabled: false
  })

  it('honors enabledLessons override', async () => {
    const opts = pixelOptions()
    opts.enabledLessons = ['social-media']
    await projectPackage(opts)
    const body = extractBlock(readSoul(), MANAGED_BLOCK_ID) ?? ''
    expect(body).toContain('Viral patterns...')
    expect(body).not.toContain('Four ingredients...')
  })

  it('does NOT honor workspace .userEdited sentinels (blocks are Bakin-owned)', async () => {
    await projectPackage(pixelOptions())
    const soulPath = runtimeWorkspaceFile('pixel', 'SOUL.md')
    writeFileSync(`${soulPath}.userEdited`, '')
    const opts = pixelOptions()
    writeFileSync(join(opts.stagingDir, 'workspace', 'SOUL.md'), `# Soul v3`)
    const result = await projectPackage(opts)
    expect(extractBlock(readSoul(), MANAGED_BLOCK_ID)).toContain('# Soul v3')
    expect(result.skipped.some((s) => s.target.includes('SOUL.md'))).toBe(false)
  })
})

// ─── Skills + assets (unchanged semantics) ───────────────────────────────────

describe('projectPackage — skills + assets', () => {
  it('projects skills per-agent for kind:"agent"', async () => {
    await projectPackage(pixelOptions())
    const skillDir = join(openClawDir, 'workspaces', 'pixel', 'skills', 'test-skill')
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
    expect(readInstalledBy(skillDir)?.package).toBe('pixel')
  })

  it('copies assets to ~/.bakin/agents/<id>/', async () => {
    await projectPackage(pixelOptions())
    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')
    expect(existsSync(avatar)).toBe(true)
    expect(readInstalledBy(avatar)?.package).toBe('pixel')
  })

  it('projects a webp avatar asset (format-agnostic) — #339', async () => {
    // The projector copies by basename, so any image format projects the same
    // way; this guards the dual-format avatar path end to end.
    const stagingDir = seedPackageStaging()
    writeFileSync(join(stagingDir, 'assets', 'avatar.webp'), 'fake-webp-bytes')
    const manifest = pixelManifest()
    manifest.contributions.assets = ['assets/avatar.webp']

    await projectPackage({ manifest, stagingDir, agentId: 'pixel', installedBy: fixedInstalledBy() })

    const avatar = join(testDir, 'agents', 'pixel', 'avatar.webp')
    expect(existsSync(avatar)).toBe(true)
    expect(readInstalledBy(avatar)?.package).toBe('pixel')
  })

  it('skips an asset marked userEdited and records it', async () => {
    await projectPackage(pixelOptions())
    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')
    writeFileSync(avatar, 'user-edited avatar')
    markUserEdited(avatar)

    const result = await projectPackage(pixelOptions())
    expect(readFileSync(avatar, 'utf-8')).toBe('user-edited avatar')
    expect(result.skipped.some((s) => s.target === avatar)).toBe(true)
  })

  it('skips a skill marked userEdited and records it', async () => {
    await projectPackage(pixelOptions())
    const skillDir = runtimeSkillDir('test-skill', 'pixel')
    writeFileSync(join(skillDir, 'SKILL.md'), '# my tweaked skill')
    writeFileSync(join(skillDir, '.userEdited'), '')

    const result = await projectPackage(pixelOptions())
    expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')).toBe('# my tweaked skill')
    expect(result.skipped.some((s) => s.target.includes('test-skill'))).toBe(true)
  })
})

// ─── Rollback on failure ─────────────────────────────────────────────────────

describe('projectPackage — atomic rollback', () => {
  it('rolls back workspace block writes when a later projection fails', async () => {
    const wsDir = join(openClawDir, 'workspaces', 'pixel')
    mkdirSync(wsDir, { recursive: true })
    writeFileSync(join(wsDir, 'SOUL.md'), '# existing soul\n')

    // Seed an avatar owned by a DIFFERENT package — asset projection collides
    const assetDir = join(testDir, 'agents', 'pixel')
    mkdirSync(assetDir, { recursive: true })
    const avatar = join(assetDir, 'avatar.jpg')
    writeFileSync(avatar, 'owned avatar')
    writeInstalledBy(avatar, { ...fixedInstalledBy(), package: 'other-package', sha256: 'owned' })

    await expect(projectPackage(pixelOptions())).rejects.toThrow(/Projection collision/)

    // SOUL.md restored to pre-projection content (block write rolled back)
    expect(readFileSync(join(wsDir, 'SOUL.md'), 'utf-8')).toBe('# existing soul\n')
    // IDENTITY.md (created during the failed run) removed again
    expect(existsSync(join(wsDir, 'IDENTITY.md'))).toBe(false)
    // Skill rolled back; foreign avatar untouched
    expect(existsSync(join(wsDir, 'skills', 'test-skill'))).toBe(false)
    expect(readFileSync(avatar, 'utf-8')).toBe('owned avatar')
    expect(readInstalledBy(avatar)?.package).toBe('other-package')
  })
})

// ─── skill-pack projection ───────────────────────────────────────────────────

describe('projectPackage — skill-pack', () => {
  it('projects skills to ~/.openclaw/skills/ globally', async () => {
    const stagingDir = join(testDir, 'staging-skill-pack')
    mkdirSync(join(stagingDir, 'skills', 'image-gen'), { recursive: true })
    writeFileSync(join(stagingDir, 'skills', 'image-gen', 'SKILL.md'), '# image-gen')

    const manifest: SkillPackManifest = {
      id: 'visual',
      kind: 'skill-pack',
      name: 'Visual Skills',
      version: '0.3.1',
      contributions: { skills: ['skills/image-gen'] },
    }

    const result = await projectPackage({
      manifest,
      stagingDir,
      installedBy: { ...fixedInstalledBy(), package: 'visual' },
    })

    const target = join(openClawDir, 'skills', 'image-gen')
    expect(existsSync(join(target, 'SKILL.md'))).toBe(true)
    expect(result.projections.some((p) => p.kind === 'skill' && p.target === 'runtime:global-skill:image-gen')).toBe(true)
  })
})

// ─── unprojectPackage ────────────────────────────────────────────────────────

describe('unprojectPackage', () => {
  it('removes skills/assets but only strips the block from workspace files', async () => {
    const result = await projectPackage(pixelOptions())
    const soulPath = runtimeWorkspaceFile('pixel', 'SOUL.md')
    writeFileSync(soulPath, readFileSync(soulPath, 'utf-8') + '\nAgent prose to keep.\n')

    await unprojectPackage(result.projections)

    // Workspace file survives, block is gone, agent prose kept
    expect(existsSync(soulPath)).toBe(true)
    const soul = readFileSync(soulPath, 'utf-8')
    expect(hasBlock(soul, MANAGED_BLOCK_ID)).toBe(false)
    expect(soul).toContain('Agent prose to keep.')

    // Skill + asset removed
    expect(existsSync(join(openClawDir, 'workspaces', 'pixel', 'skills', 'test-skill'))).toBe(false)
    expect(existsSync(join(testDir, 'agents', 'pixel', 'avatar.jpg'))).toBe(false)
  })

  it('with keepBlocks=true, leaves workspace files fully intact', async () => {
    const result = await projectPackage(pixelOptions())
    const soulBefore = readSoul()

    await unprojectPackage(result.projections, { keepBlocks: true })

    expect(readSoul()).toBe(soulBefore)
    expect(existsSync(join(testDir, 'agents', 'pixel', 'avatar.jpg'))).toBe(false)
  })

  it('leaves legacy templateOnly workspace projections alone entirely', async () => {
    const wsDir = join(openClawDir, 'workspaces', 'pixel')
    mkdirSync(wsDir, { recursive: true })
    writeFileSync(join(wsDir, 'SOUL.md'), '# legacy whole-file template')

    await unprojectPackage([
      { kind: 'workspace-file', target: 'runtime:workspace-file:pixel:SOUL.md', sha256: 'x', templateOnly: true },
    ])

    expect(readFileSync(join(wsDir, 'SOUL.md'), 'utf-8')).toBe('# legacy whole-file template')
  })

  it('skips assets marked userEdited even on uninstall', async () => {
    const result = await projectPackage(pixelOptions())
    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')
    markUserEdited(avatar)

    await unprojectPackage(result.projections)
    expect(existsSync(avatar)).toBe(true)
  })
})
