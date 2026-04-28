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
mock.module('@bakin/adapter-openclaw/home', () => ({
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

// ─── Transitive resolution (Phase H-2) ───────────────────────────────────────

/**
 * Seed a skill-pack at `rel` whose manifest declares a dep on the
 * skill-pack at `depDir`. Used to build multi-level chains.
 */
function seedSkillPackWithDep(rel: string, id: string, depDir: string, depRef = 'main'): string {
  const dir = join(testDir, rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id,
      kind: 'skill-pack',
      name: id,
      version: '0.1.0',
      contributions: { skills: ['skills/whatever'] },
      dependencies: { skills: [{ source: depDir, ref: depRef }] },
    }),
  )
  return dir
}

describe('resolveDependencies — transitive resolution', () => {
  it('walks a 3-deep chain and returns leaves first', () => {
    // bottom -> middle -> top -> pixel
    const bottom = seedSkillPack('bottom', 'bottom-pack')
    const middle = seedSkillPackWithDep('middle', 'middle-pack', bottom)
    const top = seedSkillPackWithDep('top', 'top-pack', middle)

    const parent = pixelWithDeps({
      skills: [{ source: top, ref: 'main' }],
    })

    const resolved = resolveDependencies(parent)
    expect(resolved.map((r) => r.manifest.id)).toEqual([
      'bottom-pack',
      'middle-pack',
      'top-pack',
    ])
    expect(resolved.map((r) => r.depth)).toEqual([3, 2, 1])
  })

  it('short-circuits on diamond deps (same dep pulled in via two paths, resolved once)', () => {
    // shared-leaf <- branch-a <- pixel
    // shared-leaf <- branch-b <- pixel
    const sharedLeaf = seedSkillPack('shared-leaf', 'shared')
    const branchA = seedSkillPackWithDep('branch-a', 'branch-a', sharedLeaf)
    const branchB = seedSkillPackWithDep('branch-b', 'branch-b', sharedLeaf)

    const parent = pixelWithDeps({
      skills: [
        { source: branchA, ref: 'main' },
        { source: branchB, ref: 'main' },
      ],
    })

    const resolved = resolveDependencies(parent)
    // shared-leaf appears exactly once despite two incoming edges
    const sharedCount = resolved.filter((r) => r.manifest.id === 'shared').length
    expect(sharedCount).toBe(1)
    // Topological order: shared-leaf first, then both branches
    const ids = resolved.map((r) => r.manifest.id)
    expect(ids[0]).toBe('shared')
    expect(ids).toContain('branch-a')
    expect(ids).toContain('branch-b')
  })

  it('detects cycles and throws with the loop path', () => {
    // a -> b -> a (b depends on a, a depends on b)
    const aDir = join(testDir, 'cycle-a')
    const bDir = join(testDir, 'cycle-b')
    mkdirSync(aDir, { recursive: true })
    mkdirSync(bDir, { recursive: true })
    writeFileSync(
      join(aDir, 'bakin-package.json'),
      JSON.stringify({
        id: 'a',
        kind: 'skill-pack',
        name: 'A',
        version: '0.1.0',
        contributions: { skills: ['skills/x'] },
        dependencies: { skills: [{ source: bDir, ref: 'main' }] },
      }),
    )
    writeFileSync(
      join(bDir, 'bakin-package.json'),
      JSON.stringify({
        id: 'b',
        kind: 'skill-pack',
        name: 'B',
        version: '0.1.0',
        contributions: { skills: ['skills/x'] },
        dependencies: { skills: [{ source: aDir, ref: 'main' }] },
      }),
    )

    const parent = pixelWithDeps({
      skills: [{ source: aDir, ref: 'main' }],
    })

    expect(() => resolveDependencies(parent)).toThrow(/cycle detected/i)
  })

  it('detects self-cycles (a depends on itself)', () => {
    const aDir = join(testDir, 'self-cycle')
    mkdirSync(aDir, { recursive: true })
    writeFileSync(
      join(aDir, 'bakin-package.json'),
      JSON.stringify({
        id: 'self',
        kind: 'skill-pack',
        name: 'Self',
        version: '0.1.0',
        contributions: { skills: ['skills/x'] },
        dependencies: { skills: [{ source: aDir, ref: 'main' }] },
      }),
    )

    const parent = pixelWithDeps({
      skills: [{ source: aDir, ref: 'main' }],
    })
    expect(() => resolveDependencies(parent)).toThrow(/cycle detected/i)
  })

  it('caps recursion depth and throws past the cap', () => {
    // Build a chain longer than the test-supplied cap of 2.
    const a = seedSkillPack('depth-a', 'a')
    const b = seedSkillPackWithDep('depth-b', 'b', a)
    const c = seedSkillPackWithDep('depth-c', 'c', b)
    const d = seedSkillPackWithDep('depth-d', 'd', c)

    const parent = pixelWithDeps({
      skills: [{ source: d, ref: 'main' }],
    })

    expect(() => resolveDependencies(parent, { maxDepth: 2 })).toThrow(/exceeds max depth/)
  })

  it('preserves the pulledBy field along the chain', () => {
    const bottom = seedSkillPack('pb-bottom', 'pb-bottom')
    const middle = seedSkillPackWithDep('pb-middle', 'pb-middle', bottom)

    const parent = pixelWithDeps({
      skills: [{ source: middle, ref: 'main' }],
    })

    const resolved = resolveDependencies(parent)
    const bottomEntry = resolved.find((r) => r.manifest.id === 'pb-bottom')!
    const middleEntry = resolved.find((r) => r.manifest.id === 'pb-middle')!
    expect(middleEntry.pulledBy).toBe('pixel') // direct dep
    expect(bottomEntry.pulledBy).toBe('pb-middle') // pulled by intermediate
  })
})
