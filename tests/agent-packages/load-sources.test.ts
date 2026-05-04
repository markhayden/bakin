/**
 * Tests for boot-time agent-package source loading (Phase C-3).
 *
 * Coverage:
 *   - empty lockfile → no-op
 *   - missing lockfile → no-op (no throw)
 *   - missing package source dir → warning, no throw
 *   - malformed manifest → warning, no throw
 *   - workflow YAML registers under registerAgentPackageDefinition
 *   - workflow-skills md registers under registerAgentPackageSkill
 *   - skill-pack + lesson-pack entries are skipped (no workflows to load)
 *   - re-running is idempotent (re-registers same content; doesn't duplicate)
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-load-sources-${Date.now()}-${randomUUID()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/task-store', () => ({}))

import { loadAgentPackageSources } from '../../src/core/agent-packages/load-sources'
import {
  type Lockfile,
  type PackageEntry,
  writeLockfile,
} from '../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../packages/core/src/agent-packages/package-paths'
import {
  clearSourceRegistry,
  getDefinition,
} from '../../plugins/workflows/lib/source-registry'
import {
  clearAgentPackageSkillRegistry,
  getAgentPackageSkills,
} from '../../plugins/workflows/lib/agent-package-skill-registry'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  clearSourceRegistry()
  clearAgentPackageSkillRegistry()
})

const NOW = '2026-04-24T12:00:00Z'

function pixelEntry(version = '0.1.0'): PackageEntry {
  return {
    kind: 'agent',
    version,
    source: 'github:madeinwyo/bakin-agent-pixel',
    ref: `v${version}`,
    commitSha: 'abc123',
    installedAt: NOW,
    state: 'managed',
    agentId: 'pixel',
  }
}

function seedPixelPackage(): { packageDir: string } {
  const packageDir = getPackageSourceDir(testDir, 'agent', 'pixel', '0.1.0')
  mkdirSync(packageDir, { recursive: true })
  mkdirSync(join(packageDir, 'workflows'), { recursive: true })
  mkdirSync(join(packageDir, 'workflow-skills'), { recursive: true })

  writeFileSync(
    join(packageDir, 'bakin-package.json'),
    JSON.stringify({
      id: 'pixel',
      kind: 'agent',
      name: 'Pixel',
      version: '0.1.0',
      contributions: {
        workflows: ['workflows/image-generation.yaml'],
        workflowSkills: ['workflow-skills/generate-image.md'],
      },
    }),
  )

  writeFileSync(
    join(packageDir, 'workflows', 'image-generation.yaml'),
    `id: image-generation
name: Image Generation
description: Generate an image with optional approval gate.
version: 1
steps:
  - id: gen
    type: agent
    label: Generate
    agent: pixel
`,
  )

  writeFileSync(
    join(packageDir, 'workflow-skills', 'generate-image.md'),
    `---
name: Generate Image
output_schema:
  type: object
  required:
    - asset_path
  properties:
    asset_path:
      type: string
---

## Instructions

Run nano-banana-pro and report the asset path.
`,
  )

  return { packageDir }
}

describe('loadAgentPackageSources — empty + missing states', () => {
  it('no-ops on missing lockfile', () => {
    const result = loadAgentPackageSources(testDir)
    expect(result.packagesProcessed).toEqual([])
    expect(result.workflowsRegistered).toBe(0)
    expect(result.skillsRegistered).toBe(0)
    expect(result.warnings).toEqual([])
  })

  it('no-ops on empty lockfile', () => {
    const lock: Lockfile = { version: 1, packages: {} }
    writeLockfile(lock)
    const result = loadAgentPackageSources(testDir)
    expect(result.packagesProcessed).toEqual([])
    expect(result.workflowsRegistered).toBe(0)
    expect(result.skillsRegistered).toBe(0)
  })
})

describe('loadAgentPackageSources — happy path', () => {
  it('registers workflow + workflow-skill from a managed agent package', () => {
    seedPixelPackage()
    writeLockfile({ version: 1, packages: { pixel: pixelEntry() } })

    const result = loadAgentPackageSources(testDir)

    expect(result.packagesProcessed).toEqual(['pixel'])
    expect(result.workflowsRegistered).toBe(1)
    expect(result.skillsRegistered).toBe(1)
    expect(result.warnings).toEqual([])

    // Workflow lands in the source registry
    const def = getDefinition('image-generation')
    expect(def).toBeDefined()
    expect(def!.source).toBe('agent-package')
    expect(def!.packageId).toBe('pixel')
    expect(def!.definition.name).toBe('Image Generation')

    // Workflow-skill lands in the skill registry
    const skills = getAgentPackageSkills()
    expect(skills.has('generate-image')).toBe(true)
    expect(skills.get('generate-image')!.name).toBe('Generate Image')
  })

  it('falls back to slugged-name id when manifest workflow has no id field', () => {
    const { packageDir } = seedPixelPackage()
    writeFileSync(
      join(packageDir, 'workflows', 'image-generation.yaml'),
      `name: Slugged Workflow Name
version: 1
steps:
  - id: a
    type: agent
    agent: pixel
`,
    )
    writeLockfile({ version: 1, packages: { pixel: pixelEntry() } })

    loadAgentPackageSources(testDir)
    expect(getDefinition('slugged-workflow-name')).toBeDefined()
  })

  it('is idempotent — re-running re-registers the same package without errors', () => {
    seedPixelPackage()
    writeLockfile({ version: 1, packages: { pixel: pixelEntry() } })

    loadAgentPackageSources(testDir)
    const second = loadAgentPackageSources(testDir)
    expect(second.warnings).toEqual([])
    expect(second.workflowsRegistered).toBe(1)
    expect(second.skillsRegistered).toBe(1)
  })

  it('skips skill-pack and lesson-pack entries (no workflow content to load)', () => {
    const lock: Lockfile = {
      version: 1,
      packages: {
        'visual@0.3.1': {
          kind: 'skill-pack',
          version: '0.3.1',
          source: 'github:madeinwyo/bakin-skills-visual',
          ref: 'v0.3.1',
          commitSha: 'def456',
          installedAt: NOW,
          refCount: 0,
          dependents: [],
        },
        'lessons@1.0.0': {
          kind: 'lesson-pack',
          version: '1.0.0',
          source: 'github:madeinwyo/bakin-lessons',
          ref: 'v1.0.0',
          commitSha: 'ghi789',
          installedAt: NOW,
          refCount: 0,
          dependents: [],
        },
      },
    }
    writeLockfile(lock)

    const result = loadAgentPackageSources(testDir)
    expect(result.packagesProcessed).toEqual([])
    expect(result.workflowsRegistered).toBe(0)
  })
})

describe('loadAgentPackageSources — failure-tolerant', () => {
  it('warns + skips when the package source dir is missing', () => {
    writeLockfile({ version: 1, packages: { pixel: pixelEntry() } })

    const result = loadAgentPackageSources(testDir)
    expect(result.packagesProcessed).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0].packageId).toBe('pixel')
    expect(result.warnings[0].message).toContain('package source dir missing')
  })

  it('warns + skips when bakin-package.json is missing', () => {
    const packageDir = getPackageSourceDir(testDir, 'agent', 'pixel', '0.1.0')
    mkdirSync(packageDir, { recursive: true })
    writeLockfile({ version: 1, packages: { pixel: pixelEntry() } })

    const result = loadAgentPackageSources(testDir)
    expect(result.packagesProcessed).toEqual([])
    expect(result.warnings[0].message).toMatch(/bakin-package\.json (missing|malformed)/)
  })

  it('warns + continues when a workflow YAML is malformed', () => {
    const { packageDir } = seedPixelPackage()
    writeFileSync(
      join(packageDir, 'workflows', 'image-generation.yaml'),
      'bad: yaml: : :: invalid',
    )
    writeLockfile({ version: 1, packages: { pixel: pixelEntry() } })

    const result = loadAgentPackageSources(testDir)
    expect(result.warnings.some((w) => w.message.includes('failed to parse'))).toBe(true)
    // Skill still registers even though workflow failed
    expect(result.skillsRegistered).toBe(1)
  })

  it('warns when a contributions path points at a missing file', () => {
    const { packageDir } = seedPixelPackage()
    rmSync(join(packageDir, 'workflows', 'image-generation.yaml'))
    writeLockfile({ version: 1, packages: { pixel: pixelEntry() } })

    const result = loadAgentPackageSources(testDir)
    expect(result.warnings.some((w) => w.message.includes('workflow file missing'))).toBe(true)
  })
})
