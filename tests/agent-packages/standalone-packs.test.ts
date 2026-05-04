/**
 * End-to-end tests for standalone pack installs (Phase H-1).
 *
 *   - skill-pack: skills project globally to ~/.openclaw/skills/<name>/
 *   - workflow-pack: source dir + manifest at
 *     ~/.bakin/packages/workflow-packs/<id>@<v>/; load-sources picks
 *     up workflows on next boot
 *   - lesson-pack: source dir + manifest at
 *     ~/.bakin/packages/lesson-packs/<id>@<v>/; lockfile tracking only
 *     for V1 (search indexing of lesson-pack lessons is a follow-up
 *     since the team plugin's content-type glob targets agent packages
 *     specifically — lesson-pack lessons don't yet land in search)
 *
 * Each pack lands at refCount=0 since no agent depends on it yet.
 * `bakin packages remove <id>` succeeds without --force when refCount=0;
 * adding a dependent and re-removing requires --force OR removing the
 * dependent first (covered by uninstaller.test.ts in Phase H-3).
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-standalone-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { installFilesystemRuntimeAppServices } from '../helpers/runtime-app-services'

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

mock.module('@/core/task-store', () => ({}))

import { installPackage } from '../../src/core/agent-packages/installer'
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'
import { readInstalledBy } from '../../packages/core/src/agent-packages/markers'
import { loadAgentPackageSources } from '../../src/core/agent-packages/load-sources'
import {
  clearSourceRegistry,
  getDefinition,
} from '../../plugins/workflows/lib/source-registry'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  openClawAgents = []
  installFilesystemRuntimeAppServices({
    openClawDir,
    agents: () => openClawAgents,
    onCreateAgent: (agent) => {
      openClawAgents = [...openClawAgents.filter((existing) => existing.id !== agent.id), { id: agent.id, identity: { name: agent.name } }]
    },
  })
  clearSourceRegistry()
})

// ─── skill-pack ──────────────────────────────────────────────────────────────

function seedSkillPack(id: string, version = '0.3.1', skillName = 'image-gen'): string {
  const dir = join(testDir, `${id}-pack`)
  mkdirSync(join(dir, 'skills', skillName), { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id,
      kind: 'skill-pack',
      name: id,
      version,
      contributions: { skills: [`skills/${skillName}`] },
    }),
  )
  writeFileSync(
    join(dir, 'skills', skillName, 'SKILL.md'),
    `# ${skillName}\n\nRun the thing.`,
  )
  writeFileSync(join(dir, 'skills', skillName, 'helper.sh'), '#!/bin/sh\necho hi\n')
  return dir
}

describe('installPackage — kind:"skill-pack"', () => {
  it('projects skills globally + writes lockfile entry with refCount=0', async () => {
    const src = seedSkillPack('visual-skills')
    const result = await installPackage({ source: src })

    expect(result.kind).toBe('skill-pack')
    expect(result.packageId).toBe('visual-skills')
    expect(result.createdAgent).toBe(false)
    expect(result.adopted).toBe(false)

    // Skill projected globally (kind:"skill-pack" → ~/.openclaw/skills/<name>/)
    const skillTarget = join(openClawDir, 'skills', 'image-gen')
    expect(existsSync(join(skillTarget, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(skillTarget, 'helper.sh'))).toBe(true)
    // Provenance sidecar in place
    expect(readInstalledBy(skillTarget)?.package).toBe('visual-skills')

    // Install dir at packages/skill-packs/<id>@<v>/
    const installDir = join(testDir, 'packages', 'skill-packs', 'visual-skills@0.3.1')
    expect(existsSync(join(installDir, 'bakin-package.json'))).toBe(true)

    // Lockfile entry: refCount 0, no agent fields
    const lock = readLockfile()
    const entry = lock.packages['visual-skills@0.3.1']
    expect(entry).toBeDefined()
    expect(entry.kind).toBe('skill-pack')
    expect(entry.refCount).toBe(0)
    expect(entry.agentId).toBeUndefined()
    expect(entry.state).toBeUndefined()
  })

  it('refuses installing the same skill-pack twice (already managed)', async () => {
    const src = seedSkillPack('visual-skills')
    await installPackage({ source: src })

    expect(async () => {
      await installPackage({ source: src })
    }).toThrow()
  })

  it('refuses a skill-pack when a declared skill directory is missing', async () => {
    const src = seedSkillPack('visual-skills')
    rmSync(join(src, 'skills', 'image-gen'), { recursive: true, force: true })

    expect(async () => {
      await installPackage({ source: src })
    }).toThrow(/skill source directory is missing/i)

    expect(Object.keys(readLockfile().packages)).toEqual([])
  })

  it('refuses a skill-pack when SKILL.md is missing', async () => {
    const src = seedSkillPack('visual-skills')
    rmSync(join(src, 'skills', 'image-gen', 'SKILL.md'), { force: true })

    expect(async () => {
      await installPackage({ source: src })
    }).toThrow(/SKILL\.md is missing/i)

    expect(Object.keys(readLockfile().packages)).toEqual([])
  })
})

// ─── workflow-pack ───────────────────────────────────────────────────────────

function seedWorkflowPack(id: string, version = '0.2.0'): string {
  const dir = join(testDir, `${id}-pack`)
  mkdirSync(join(dir, 'workflows'), { recursive: true })
  mkdirSync(join(dir, 'workflow-skills'), { recursive: true })

  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id,
      kind: 'workflow-pack',
      name: id,
      version,
      contributions: {
        workflows: ['workflows/image-flow.yaml'],
        workflowSkills: ['workflow-skills/critique.md'],
      },
    }),
  )
  writeFileSync(
    join(dir, 'workflows', 'image-flow.yaml'),
    `id: image-flow
name: Image Flow
description: Test workflow.
version: 1
steps:
  - id: gen
    type: agent
    label: Generate
    agent: pixel
`,
  )
  writeFileSync(
    join(dir, 'workflow-skills', 'critique.md'),
    `---
name: Critique
---

Critique the work.
`,
  )
  return dir
}

describe('installPackage — kind:"workflow-pack"', () => {
  it('lays down install dir + lockfile entry; load-sources picks up workflows', async () => {
    const src = seedWorkflowPack('creative-flows')
    const result = await installPackage({ source: src })

    expect(result.kind).toBe('workflow-pack')
    expect(result.packageId).toBe('creative-flows')

    // Install dir at packages/workflow-packs/<id>@<v>/
    const installDir = join(testDir, 'packages', 'workflow-packs', 'creative-flows@0.2.0')
    expect(existsSync(join(installDir, 'bakin-package.json'))).toBe(true)
    expect(existsSync(join(installDir, 'workflows', 'image-flow.yaml'))).toBe(true)

    // Lockfile entry
    const entry = readLockfile().packages['creative-flows@0.2.0']
    expect(entry?.kind).toBe('workflow-pack')
    expect(entry?.refCount).toBe(0)
    expect(entry?.state).toBeUndefined()
    expect(entry?.agentId).toBeUndefined()

    // Boot-time loader picks up workflow contributions
    const loadResult = loadAgentPackageSources(testDir)
    expect(loadResult.workflowsRegistered).toBe(1)
    expect(loadResult.skillsRegistered).toBe(1)
    const def = getDefinition('image-flow')
    expect(def?.source).toBe('agent-package')
    expect(def?.packageId).toBe('creative-flows')
  })

  it('refuses a workflow-pack when a declared workflow file is missing', async () => {
    const src = seedWorkflowPack('creative-flows')
    rmSync(join(src, 'workflows', 'image-flow.yaml'), { force: true })

    expect(async () => {
      await installPackage({ source: src })
    }).toThrow(/workflow source file is missing/i)

    expect(Object.keys(readLockfile().packages)).toEqual([])
  })

  it('refuses a workflow-pack when a declared workflow is invalid', async () => {
    const src = seedWorkflowPack('creative-flows')
    writeFileSync(join(src, 'workflows', 'image-flow.yaml'), 'bad: yaml: : :: invalid')

    expect(async () => {
      await installPackage({ source: src })
    }).toThrow(/workflow source file is invalid/i)

    expect(Object.keys(readLockfile().packages)).toEqual([])
  })

  it('refuses a workflow-pack when a declared workflow skill has no body content', async () => {
    const src = seedWorkflowPack('creative-flows')
    writeFileSync(
      join(src, 'workflow-skills', 'critique.md'),
      `---\nname: Critique\n---\n\n`,
    )

    expect(async () => {
      await installPackage({ source: src })
    }).toThrow(/workflow-skill source file is empty/i)

    expect(Object.keys(readLockfile().packages)).toEqual([])
  })
})

// ─── lesson-pack ──────────────────────────────────────────────────────────

function seedLessonPack(id: string, version = '1.0.0'): string {
  const dir = join(testDir, `${id}-pack`)
  mkdirSync(join(dir, 'lessons'), { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id,
      kind: 'lesson-pack',
      name: id,
      version,
      contributions: {
        lessons: ['lessons/lesson-one.md', 'lessons/lesson-two.md'],
      },
    }),
  )
  writeFileSync(
    join(dir, 'lessons', 'lesson-one.md'),
    `---\ntitle: Lesson One\ndefaultEnabled: true\n---\n\nFirst lesson body.`,
  )
  writeFileSync(
    join(dir, 'lessons', 'lesson-two.md'),
    `---\ntitle: Lesson Two\ndefaultEnabled: false\n---\n\nSecond lesson body.`,
  )
  return dir
}

describe('installPackage — kind:"lesson-pack"', () => {
  it('lays down install dir with lesson files preserved + lockfile entry', async () => {
    const src = seedLessonPack('shared-lessons')
    const result = await installPackage({ source: src })

    expect(result.kind).toBe('lesson-pack')

    // Install dir contains all lesson files
    const installDir = join(testDir, 'packages', 'lesson-packs', 'shared-lessons@1.0.0')
    expect(existsSync(join(installDir, 'lessons', 'lesson-one.md'))).toBe(true)
    expect(existsSync(join(installDir, 'lessons', 'lesson-two.md'))).toBe(true)
    // Frontmatter preserved
    const lessonOne = readFileSync(join(installDir, 'lessons', 'lesson-one.md'), 'utf-8')
    expect(lessonOne).toContain('defaultEnabled: true')

    // Lockfile entry: refCount 0, kind lesson-pack
    const entry = readLockfile().packages['shared-lessons@1.0.0']
    expect(entry?.kind).toBe('lesson-pack')
    expect(entry?.refCount).toBe(0)
  })

  it('does NOT project filesystem-side beyond the install dir (lesson-pack is FS-inert at install time)', async () => {
    const src = seedLessonPack('shared-lessons')
    await installPackage({ source: src })

    // No openclaw side-effects
    expect(existsSync(join(openClawDir, 'workspaces'))).toBe(false)
    // No bakin-agents side-effects
    expect(existsSync(join(testDir, 'agents'))).toBe(false)
    // Lockfile has no projections list (or empty)
    const entry = readLockfile().packages['shared-lessons@1.0.0']
    expect(entry?.projections ?? []).toEqual([])
  })

  it('refuses a lesson-pack when a contributed lesson file is missing', async () => {
    const src = seedLessonPack('shared-lessons')
    rmSync(join(src, 'lessons', 'lesson-two.md'), { force: true })

    expect(async () => {
      await installPackage({ source: src })
    }).toThrow(/lesson source file is missing/i)

    expect(Object.keys(readLockfile().packages)).toEqual([])
    expect(existsSync(join(testDir, 'packages', 'lesson-packs', 'shared-lessons@1.0.0'))).toBe(false)
  })

  it('refuses a lesson-pack when a contributed lesson has no body content', async () => {
    const src = seedLessonPack('shared-lessons')
    writeFileSync(
      join(src, 'lessons', 'lesson-two.md'),
      `---\ntitle: Lesson Two\ndefaultEnabled: false\n---\n\n`,
    )

    expect(async () => {
      await installPackage({ source: src })
    }).toThrow(/lesson source file is empty/i)

    expect(Object.keys(readLockfile().packages)).toEqual([])
    expect(existsSync(join(testDir, 'packages', 'lesson-packs', 'shared-lessons@1.0.0'))).toBe(false)
  })
})

// ─── refCount lifecycle (orphan handling) ────────────────────────────────────

describe('installPackage — standalone packs land at refCount=0', () => {
  it('a standalone skill-pack stays at refCount=0 until an agent depends on it', async () => {
    const src = seedSkillPack('visual-skills')
    await installPackage({ source: src })

    const lock = readLockfile()
    expect(lock.packages['visual-skills@0.3.1'].refCount).toBe(0)
    expect(lock.packages['visual-skills@0.3.1'].dependents ?? []).toEqual([])
  })
})
