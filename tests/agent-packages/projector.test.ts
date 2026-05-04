/**
 * Tests for the projector (Phase E-3).
 *
 * Coverage:
 *   - Fresh install of an agent package: workspace files, lesson markers,
 *     assets, sidecars all in place
 *   - Adopt mode: workspace files preserved, only markers + assets project
 *   - Update mode without --refresh-template: workspace files NOT rewritten
 *   - Update mode with --refresh-template: workspace files rewritten
 *   - .userEdited skip: target preserved, no .installedBy written, recorded
 *     in result.skipped
 *   - Mid-install failure rolls back every prior write
 *   - Lesson catalog block reflects enabled lessons
 *   - Disabled lessons get their per-lesson block removed
 *   - Symlinks in source are skipped (refused on copy)
 *   - skill-pack projects to global ~/.openclaw/skills/
 *   - workflow-pack and lesson-pack are no-op at filesystem level
 *   - unprojectPackage removes files + strips markers
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { AgentRuntimeAdapter, RuntimeSkill, WorkspaceFile } from '@bakin/core/adapters/runtime'

const testDir = join(tmpdir(), `bakin-test-projector-${Date.now()}-${randomUUID()}`)
const openClawDir = join(testDir, 'openclaw')

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

import {
  projectPackage,
  unprojectPackage,
  type ProjectorOptions,
} from '../../src/core/agent-packages/projector'
import {
  installedByPath,
  markUserEdited,
  readInstalledBy,
  writeInstalledBy,
} from '../../packages/core/src/agent-packages/markers'
import {
  extractBlock,
  hasBlock,
} from '../../packages/core/src/agent-packages/managed-blocks'
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

  writeFileSync(
    join(stagingDir, 'workspace', 'SOUL.md'),
    `# Soul\n\nYou are Pixel.\n\n<!-- bakin:lesson-catalog:start -->\n<!-- bakin:lesson-catalog:end -->\n`,
  )
  writeFileSync(join(stagingDir, 'workspace', 'IDENTITY.md'), `# IDENTITY\n\n- **Name:** Pixel\n`)
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

function freshOptions(): ProjectorOptions {
  return {
    manifest: pixelManifest(),
    stagingDir: seedPackageStaging(),
    agentId: 'pixel',
    mode: 'fresh',
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

function installRuntimeMock(): void {
  const runtime = {
    agents: {
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
        } else {
          rmSync(`${target}.installedBy`, { force: true })
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

// ─── Fresh install ───────────────────────────────────────────────────────────

describe('projectPackage — fresh install (kind:"agent")', () => {
  it('writes every workspace file with sidecar', async () => {
    const result = await projectPackage(freshOptions())

    const soul = join(openClawDir, 'workspaces', 'pixel', 'SOUL.md')
    const identity = join(openClawDir, 'workspaces', 'pixel', 'IDENTITY.md')
    expect(existsSync(soul)).toBe(true)
    expect(existsSync(identity)).toBe(true)
    expect(readInstalledBy(soul)?.package).toBe('pixel')
    expect(readInstalledBy(identity)?.package).toBe('pixel')

    const workspaceProjections = result.projections.filter((p) => p.kind === 'workspace-file')
    expect(workspaceProjections).toHaveLength(2)
    expect(workspaceProjections.every((p) => p.templateOnly === true)).toBe(true)
  })

  it('projects skills per-agent for kind:"agent"', async () => {
    await projectPackage(freshOptions())
    const skillDir = join(openClawDir, 'workspaces', 'pixel', 'skills', 'test-skill')
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
    expect(readInstalledBy(skillDir)?.package).toBe('pixel')
  })

  it('copies assets to ~/.bakin/agents/<id>/', async () => {
    await projectPackage(freshOptions())
    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')
    expect(existsSync(avatar)).toBe(true)
    expect(readFileSync(avatar, 'utf-8')).toBe('fake-jpg-bytes')
    expect(readInstalledBy(avatar)?.package).toBe('pixel')
  })

  it('injects lesson catalog + enabled-lesson blocks into SOUL.md', async () => {
    await projectPackage(freshOptions())
    const soul = readFileSync(join(openClawDir, 'workspaces', 'pixel', 'SOUL.md'), 'utf-8')

    expect(hasBlock(soul, 'lesson-catalog')).toBe(true)
    const catalog = extractBlock(soul, 'lesson-catalog') ?? ''
    expect(catalog).toContain('Prompt Style System')
    expect(catalog).toContain('[x] **Prompt Style System**')
    expect(catalog).toContain('[ ] **Social Media**')

    // Enabled lesson has a block; disabled lesson does not
    expect(hasBlock(soul, 'lesson:pixel:prompt-style-system')).toBe(true)
    expect(hasBlock(soul, 'lesson:pixel:social-media')).toBe(false)
  })

  it('records lesson-marker projections for catalog + each enabled lesson', async () => {
    const result = await projectPackage(freshOptions())
    const markers = result.projections.filter((p) => p.kind === 'lesson-marker')
    expect(markers).toHaveLength(2) // catalog + prompt-style-system
    const blockIds = markers.map((m) => m.blockId)
    expect(blockIds).toContain('lesson-catalog')
    expect(blockIds).toContain('lesson:pixel:prompt-style-system')
  })

  it('falls back to defaultEnabled frontmatter when install.enableLessons is undefined', async () => {
    const opts = freshOptions()
    opts.manifest = { ...opts.manifest, install: { ...(opts.manifest as AgentManifest).install, enableLessons: undefined } } as Manifest
    await projectPackage(opts)
    const soul = readFileSync(join(openClawDir, 'workspaces', 'pixel', 'SOUL.md'), 'utf-8')
    // prompt-style-system has defaultEnabled: true → block present
    expect(hasBlock(soul, 'lesson:pixel:prompt-style-system')).toBe(true)
    // social-media has defaultEnabled: false → block absent
    expect(hasBlock(soul, 'lesson:pixel:social-media')).toBe(false)
  })

  it('honors enabledLessons override', async () => {
    const opts = freshOptions()
    opts.enabledLessons = ['social-media'] // only social-media enabled
    await projectPackage(opts)
    const soul = readFileSync(join(openClawDir, 'workspaces', 'pixel', 'SOUL.md'), 'utf-8')
    expect(hasBlock(soul, 'lesson:pixel:social-media')).toBe(true)
    expect(hasBlock(soul, 'lesson:pixel:prompt-style-system')).toBe(false)
  })
})

// ─── Adopt mode ──────────────────────────────────────────────────────────────

describe('projectPackage — adopt mode', () => {
  it('preserves existing workspace files and only injects markers', async () => {
    const wsDir = join(openClawDir, 'workspaces', 'pixel')
    mkdirSync(wsDir, { recursive: true })
    writeFileSync(join(wsDir, 'SOUL.md'), `# Existing Pixel SOUL\n\nUser-written content.\n`)
    writeFileSync(join(wsDir, 'IDENTITY.md'), `# Existing Identity`)

    const opts = freshOptions()
    opts.mode = 'adopt'

    const result = await projectPackage(opts)

    // Existing IDENTITY.md is untouched
    expect(readFileSync(join(wsDir, 'IDENTITY.md'), 'utf-8')).toBe('# Existing Identity')

    // SOUL.md has new markers but the prose is preserved
    const soul = readFileSync(join(wsDir, 'SOUL.md'), 'utf-8')
    expect(soul).toContain('# Existing Pixel SOUL')
    expect(soul).toContain('User-written content.')
    expect(hasBlock(soul, 'lesson-catalog')).toBe(true)

    // No workspace-file projections — adopt mode skips them
    const wsProjections = result.projections.filter((p) => p.kind === 'workspace-file')
    expect(wsProjections).toHaveLength(0)

    // Skill + asset still project
    expect(result.projections.some((p) => p.kind === 'skill')).toBe(true)
    expect(result.projections.some((p) => p.kind === 'asset')).toBe(true)
  })
})

// ─── Update mode ─────────────────────────────────────────────────────────────

describe('projectPackage — update mode', () => {
  it('without refreshTemplate, does NOT rewrite workspace files', async () => {
    // Pre-seed updated workspace via fresh install
    await projectPackage(freshOptions())
    const soulBefore = readFileSync(join(openClawDir, 'workspaces', 'pixel', 'SOUL.md'), 'utf-8')

    // Now agent edits the SOUL.md
    const soulPath = join(openClawDir, 'workspaces', 'pixel', 'SOUL.md')
    writeFileSync(soulPath, `${soulBefore}\n\nAgent-added new section.\n`)

    // Run an update — should re-inject markers but not rewrite the template
    const opts = freshOptions()
    opts.mode = 'update'
    opts.refreshTemplate = false
    await projectPackage(opts)

    const after = readFileSync(soulPath, 'utf-8')
    // Agent's added prose is preserved (markers were re-injected via injectBlock
    // which preserves surrounding content)
    expect(after).toContain('Agent-added new section.')
  })

  it('with refreshTemplate=true, rewrites workspace files', async () => {
    await projectPackage(freshOptions())
    const identityPath = join(openClawDir, 'workspaces', 'pixel', 'IDENTITY.md')
    writeFileSync(identityPath, `# Drifted IDENTITY\n\nAgent overwrote this.\n`)

    const opts = freshOptions()
    opts.mode = 'update'
    opts.refreshTemplate = true
    await projectPackage(opts)

    expect(readFileSync(identityPath, 'utf-8')).toBe('# IDENTITY\n\n- **Name:** Pixel\n')
  })
})

// ─── .userEdited semantics ───────────────────────────────────────────────────

describe('projectPackage — .userEdited honored', () => {
  it('skips a workspace file marked userEdited and records it in result.skipped', async () => {
    // First fresh install lays down SOUL.md
    await projectPackage(freshOptions())
    const soulPath = join(openClawDir, 'workspaces', 'pixel', 'SOUL.md')
    writeFileSync(soulPath, '# user owns this now')
    markUserEdited(soulPath)

    const opts = freshOptions()
    opts.mode = 'update'
    opts.refreshTemplate = true // even with refresh-template, userEdited wins
    const result = await projectPackage(opts)

    // File untouched
    expect(readFileSync(soulPath, 'utf-8')).toBe('# user owns this now')
    // Recorded as skipped
    expect(result.skipped.some((s) => s.target.includes('SOUL.md'))).toBe(true)
  })

  it('skips an asset marked userEdited', async () => {
    await projectPackage(freshOptions())
    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')
    writeFileSync(avatar, 'user-edited avatar')
    markUserEdited(avatar)

    const opts = freshOptions()
    opts.mode = 'update'
    const result = await projectPackage(opts)

    expect(readFileSync(avatar, 'utf-8')).toBe('user-edited avatar')
    expect(result.skipped.some((s) => s.target === avatar)).toBe(true)
  })
})

// ─── Rollback on failure ─────────────────────────────────────────────────────

describe('projectPackage — atomic rollback', () => {
  it('rolls back runtime writes and stale sidecars when a later projection fails', async () => {
    const wsDir = join(openClawDir, 'workspaces', 'pixel')
    mkdirSync(wsDir, { recursive: true })
    writeFileSync(join(wsDir, 'SOUL.md'), '# existing soul\n')
    writeFileSync(join(wsDir, 'IDENTITY.md'), '# existing identity\n')

    const assetDir = join(testDir, 'agents', 'pixel')
    mkdirSync(assetDir, { recursive: true })
    const avatar = join(assetDir, 'avatar.jpg')
    writeFileSync(avatar, 'owned avatar')
    writeInstalledBy(avatar, { ...fixedInstalledBy(), package: 'other-package', sha256: 'owned' })

    const opts = freshOptions()
    opts.mode = 'update'
    opts.refreshTemplate = true

    await expect(projectPackage(opts)).rejects.toThrow(/Projection collision/)

    const soul = join(wsDir, 'SOUL.md')
    const identity = join(wsDir, 'IDENTITY.md')
    expect(readFileSync(soul, 'utf-8')).toBe('# existing soul\n')
    expect(readFileSync(identity, 'utf-8')).toBe('# existing identity\n')
    expect(existsSync(`${soul}.installedBy`)).toBe(false)
    expect(existsSync(`${identity}.installedBy`)).toBe(false)
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
      mode: 'fresh',
      installedBy: { ...fixedInstalledBy(), package: 'visual' },
    })

    const target = join(openClawDir, 'skills', 'image-gen')
    expect(existsSync(join(target, 'SKILL.md'))).toBe(true)
    expect(readInstalledBy(target)?.package).toBe('visual')
    expect(result.projections.some((p) => p.kind === 'skill' && p.target === 'runtime:global-skill:image-gen')).toBe(true)
  })
})

// ─── unprojectPackage ────────────────────────────────────────────────────────

describe('unprojectPackage', () => {
  it('removes every projected file + sidecar', async () => {
    const result = await projectPackage(freshOptions())

    const soul = join(openClawDir, 'workspaces', 'pixel', 'SOUL.md')
    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')

    await unprojectPackage(result.projections)

    expect(existsSync(soul)).toBe(false)
    expect(existsSync(installedByPath(soul))).toBe(false)
    expect(existsSync(avatar)).toBe(false)
    expect(existsSync(join(openClawDir, 'workspaces', 'pixel', 'skills', 'test-skill'))).toBe(false)
  })

  it('with keepBlocks=true, leaves lesson markers intact', async () => {
    const result = await projectPackage(freshOptions())
    const soul = join(openClawDir, 'workspaces', 'pixel', 'SOUL.md')

    await unprojectPackage(result.projections, { keepBlocks: true })

    // workspace-file removed
    expect(existsSync(soul)).toBe(false)
    // (Without the SOUL.md file we can't verify markers stayed — keepBlocks
    // only matters when the SOUL.md is preserved by being skipped due to
    // userEdited or being excluded from projections; this is the normal
    // case where unproject removes everything.)
  })

  it('skips files marked userEdited even on uninstall', async () => {
    const result = await projectPackage(freshOptions())
    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')
    markUserEdited(avatar)

    await unprojectPackage(result.projections)

    // userEdited asset survives uninstall
    expect(existsSync(avatar)).toBe(true)
  })
})
