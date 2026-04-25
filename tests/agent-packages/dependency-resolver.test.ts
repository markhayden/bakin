/**
 * Tests for the dependency resolver (Phase E-4, single-level V1).
 *
 * Coverage:
 *   - empty deps → []
 *   - one local skill-pack dep resolves
 *   - kind mismatch (manifest says skill-pack, dep slot expects workflow-pack)
 *     produces a clear error
 *   - manifest validation failure produces a formatManifestError-style msg
 *   - installAs override propagates to resolvedId
 *   - declaration order is preserved
 *   - missing dependency source throws
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-dep-resolver-${Date.now()}-${randomUUID()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { resolveDependencies } from '../../src/core/agent-packages/dependency-resolver'
import type {
  AgentManifest,
  Manifest,
} from '../../packages/core/src/agent-packages/manifest'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

function seedSkillPack(rel: string, id: string, version = '0.3.1'): string {
  const dir = join(testDir, rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id,
      kind: 'skill-pack',
      name: 'Visual Skills',
      version,
      contributions: { skills: ['skills/whatever'] },
    }),
  )
  return dir
}

function seedWorkflowPack(rel: string, id: string): string {
  const dir = join(testDir, rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id,
      kind: 'workflow-pack',
      name: 'Creative Workflows',
      version: '0.2.0',
      contributions: { workflows: ['workflows/foo.yaml'] },
    }),
  )
  return dir
}

function pixelWithDeps(deps: AgentManifest['dependencies']): AgentManifest {
  return {
    id: 'pixel',
    kind: 'agent',
    name: 'Pixel',
    version: '0.1.0',
    agent: { identity: { name: 'Pixel' } },
    install: {},
    contributions: {},
    dependencies: deps,
  }
}

describe('resolveDependencies — empty deps', () => {
  it('returns an empty array when no dependencies are declared', () => {
    expect(resolveDependencies(pixelWithDeps(undefined))).toEqual([])
  })

  it('returns an empty array when dependencies block is empty', () => {
    expect(resolveDependencies(pixelWithDeps({}))).toEqual([])
  })
})

describe('resolveDependencies — single dep', () => {
  it('resolves a local skill-pack dep', () => {
    const dir = seedSkillPack('visual-pack', 'visual')
    const parent = pixelWithDeps({
      skills: [{ source: dir, ref: 'v0.3.1' }],
    })

    const resolved = resolveDependencies(parent)
    expect(resolved).toHaveLength(1)
    expect(resolved[0].manifest.id).toBe('visual')
    expect(resolved[0].manifest.kind).toBe('skill-pack')
    expect(resolved[0].resolvedId).toBe('visual')
    expect(resolved[0].pulledBy).toBe('pixel')
    expect(resolved[0].fetched.kind).toBe('local')
  })

  it('honors installAs alias', () => {
    const dir = seedSkillPack('visual-pack', 'visual')
    const parent = pixelWithDeps({
      skills: [{ source: dir, ref: 'v0.3.1', installAs: 'alt-visual' }],
    })

    const resolved = resolveDependencies(parent)
    expect(resolved[0].resolvedId).toBe('alt-visual')
    // The fetched manifest still says id="visual"
    expect(resolved[0].manifest.id).toBe('visual')
  })
})

describe('resolveDependencies — multiple deps', () => {
  it('preserves declaration order across categories', () => {
    const skillDir = seedSkillPack('skills-pack', 'visual')
    const workflowDir = seedWorkflowPack('wf-pack', 'creative')
    const parent = pixelWithDeps({
      skills: [{ source: skillDir, ref: 'main' }],
      workflows: [{ source: workflowDir, ref: 'main' }],
    })

    const resolved = resolveDependencies(parent)
    expect(resolved.map((r) => r.manifest.id)).toEqual(['visual', 'creative'])
  })

  it('resolves multiple deps within a single category in order', () => {
    const a = seedSkillPack('pack-a', 'pack-a')
    const b = seedSkillPack('pack-b', 'pack-b')
    const parent = pixelWithDeps({
      skills: [
        { source: a, ref: 'main' },
        { source: b, ref: 'main' },
      ],
    })
    const resolved = resolveDependencies(parent)
    expect(resolved.map((r) => r.manifest.id)).toEqual(['pack-a', 'pack-b'])
  })
})

describe('resolveDependencies — error paths', () => {
  it('throws on kind mismatch (skill-pack manifest in workflows slot)', () => {
    const skillDir = seedSkillPack('mismatch', 'visual')
    const parent = pixelWithDeps({
      workflows: [{ source: skillDir, ref: 'main' }],
    })
    expect(() => resolveDependencies(parent)).toThrow(/kind="skill-pack"/)
  })

  it('throws when the dependency`s manifest fails validation', () => {
    const dir = join(testDir, 'broken-pack')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify({ kind: 'skill-pack' })) // missing required fields

    const parent = pixelWithDeps({
      skills: [{ source: dir, ref: 'main' }],
    })
    expect(() => resolveDependencies(parent)).toThrow(/failed validation/)
  })

  it('throws when the dependency source path does not exist', () => {
    const parent = pixelWithDeps({
      skills: [{ source: join(testDir, 'never-existed'), ref: 'main' }],
    })
    expect(() => resolveDependencies(parent)).toThrow(/does not exist/)
  })
})
