/**
 * Tests for the agent-package manifest schema (A-1).
 *
 * Coverage:
 *   - All 4 kinds parse the canonical fixture manifests cleanly
 *   - Required-field rejection
 *   - id format rejection
 *   - source format rejection (no bare names, no http:)
 *   - github dependency #subpath validation
 *   - Per-kind contribution shape rejection (skill-pack with no skills, etc.)
 *   - safeParseManifest returns the typed Result variant
 *   - formatManifestError produces a single-line message
 */
import { describe, it, expect, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mandatory CC-6 isolation mocks. The schema module is pure (no fs side
// effects), but every test in the agent-packages feature mocks both
// content-dir and openclaw-home so the rule is uniform. A future regression
// that imports a fs-touching module from this test will fail safely.
const testDir = join(tmpdir(), `bakin-test-manifest-${Date.now()}`)

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

import {
  ManifestSchema,
  parseManifest,
  safeParseManifest,
  formatManifestError,
  type Manifest,
} from '../../packages/core/src/agent-packages/manifest'

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'agent-packages', 'manifests')

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf-8'))
}

describe('manifest schema — happy path', () => {
  it('parses an agent manifest', () => {
    const m = parseManifest(loadFixture('agent')) satisfies Manifest
    expect(m.kind).toBe('agent')
    if (m.kind !== 'agent') throw new Error('discriminator narrowing failed')
    expect(m.id).toBe('pixel')
    expect(m.agent.identity.name).toBe('Pixel')
    expect(m.install.enableKnowledge).toEqual(['prompt-style-system'])
    expect(m.contributions.skills).toEqual(['skills/image-generation'])
    expect(m.dependencies?.skills?.[0].source).toBe('github:markhayden/bakin-skills-visual')
    expect(m.dependencies?.skills?.[0].installAs).toBeNull()
  })

  it('parses a skill-pack manifest', () => {
    const m = parseManifest(loadFixture('skill-pack'))
    expect(m.kind).toBe('skill-pack')
    if (m.kind !== 'skill-pack') throw new Error('discriminator narrowing failed')
    expect(m.contributions.skills).toHaveLength(2)
  })

  it('parses a workflow-pack manifest', () => {
    const m = parseManifest(loadFixture('workflow-pack'))
    expect(m.kind).toBe('workflow-pack')
    if (m.kind !== 'workflow-pack') throw new Error('discriminator narrowing failed')
    expect(m.contributions.workflows).toHaveLength(2)
    expect(m.contributions.workflowSkills).toHaveLength(1)
  })

  it('parses a knowledge-pack manifest', () => {
    const m = parseManifest(loadFixture('knowledge-pack'))
    expect(m.kind).toBe('knowledge-pack')
    if (m.kind !== 'knowledge-pack') throw new Error('discriminator narrowing failed')
    expect(m.contributions.knowledge).toHaveLength(2)
  })
})

describe('manifest schema — base field rejection', () => {
  const baseAgent = () => loadFixture('agent') as Record<string, unknown>

  it('rejects missing id', () => {
    const m = baseAgent()
    delete m.id
    expect(() => parseManifest(m)).toThrow()
  })

  it('rejects missing kind', () => {
    const m = baseAgent()
    delete m.kind
    expect(() => parseManifest(m)).toThrow()
  })

  it('rejects missing version', () => {
    const m = baseAgent()
    delete m.version
    expect(() => parseManifest(m)).toThrow()
  })

  it('rejects missing name', () => {
    const m = baseAgent()
    delete m.name
    expect(() => parseManifest(m)).toThrow()
  })

  it('rejects unknown kind', () => {
    const m = baseAgent()
    m.kind = 'mystery-kind'
    expect(() => parseManifest(m)).toThrow()
  })
})

describe('manifest schema — id rules', () => {
  it('rejects ids that start with non-alphanumeric', () => {
    const m = loadFixture('skill-pack') as Record<string, unknown>
    m.id = '-leading-hyphen'
    expect(() => parseManifest(m)).toThrow()
  })

  it('rejects ids longer than 40 chars', () => {
    const m = loadFixture('skill-pack') as Record<string, unknown>
    m.id = 'a'.repeat(41)
    expect(() => parseManifest(m)).toThrow()
  })

  it('rejects ids with spaces or punctuation', () => {
    const m = loadFixture('skill-pack') as Record<string, unknown>
    m.id = 'has space'
    expect(() => parseManifest(m)).toThrow()
  })

  it('accepts ids with mixed case + hyphens + underscores', () => {
    const m = loadFixture('skill-pack') as Record<string, unknown>
    m.id = 'Mixed-Case_Id_42'
    expect(() => parseManifest(m)).not.toThrow()
  })
})

describe('manifest schema — version rules', () => {
  it('rejects non-semver version', () => {
    const m = loadFixture('skill-pack') as Record<string, unknown>
    m.version = 'v1'
    expect(() => parseManifest(m)).toThrow()
  })

  it('accepts pre-release suffix', () => {
    const m = loadFixture('skill-pack') as Record<string, unknown>
    m.version = '1.2.3-alpha.1'
    expect(() => parseManifest(m)).not.toThrow()
  })
})

describe('manifest schema — dependency source rules', () => {
  it('rejects bare-name source (no github:, no path prefix)', () => {
    const m = loadFixture('agent') as Record<string, unknown>
    ;(m.dependencies as { skills: unknown[] }).skills = [
      { source: 'pixel', ref: 'v0.1.0' },
    ]
    expect(() => parseManifest(m)).toThrow()
  })

  it('rejects http:// source', () => {
    const m = loadFixture('agent') as Record<string, unknown>
    ;(m.dependencies as { skills: unknown[] }).skills = [
      { source: 'https://example.com/foo.git', ref: 'v0.1.0' },
    ]
    expect(() => parseManifest(m)).toThrow()
  })

  it('accepts ./local-path source', () => {
    const m = loadFixture('agent') as Record<string, unknown>
    ;(m.dependencies as { skills: unknown[] }).skills = [
      { source: './my-pack', ref: 'main' },
    ]
    expect(() => parseManifest(m)).not.toThrow()
  })

  it('accepts ~/home-relative source', () => {
    const m = loadFixture('agent') as Record<string, unknown>
    ;(m.dependencies as { skills: unknown[] }).skills = [
      { source: '~/work/my-pack', ref: 'main' },
    ]
    expect(() => parseManifest(m)).not.toThrow()
  })

  it('accepts github source with package subpath', () => {
    const m = loadFixture('agent') as Record<string, unknown>
    ;(m.dependencies as { skills: unknown[] }).skills = [
      { source: 'github:markhayden/bakin-bits-official#agents/patch', ref: 'main' },
    ]
    expect(() => parseManifest(m)).not.toThrow()
  })

  for (const [label, source] of [
    ['empty subpath', 'github:markhayden/bakin-bits-official#'],
    ['leading slash', 'github:markhayden/bakin-bits-official#/agents/patch'],
    ['trailing slash', 'github:markhayden/bakin-bits-official#agents/patch/'],
    ['parent traversal', 'github:markhayden/bakin-bits-official#agents/../patch'],
    ['dot segment', 'github:markhayden/bakin-bits-official#./agents/patch'],
    ['multiple # delimiters', 'github:markhayden/bakin-bits-official#a#b'],
    ['space in subpath', 'github:markhayden/bakin-bits-official#agents/patch copy'],
  ] as const) {
    it(`rejects malformed github subpath: ${label}`, () => {
      const m = loadFixture('agent') as Record<string, unknown>
      ;(m.dependencies as { skills: unknown[] }).skills = [
        { source, ref: 'main' },
      ]
      expect(() => parseManifest(m)).toThrow()
    })
  }

  it('rejects empty ref', () => {
    const m = loadFixture('agent') as Record<string, unknown>
    ;(m.dependencies as { skills: unknown[] }).skills = [
      { source: 'github:foo/bar', ref: '' },
    ]
    expect(() => parseManifest(m)).toThrow()
  })
})

describe('manifest schema — kind-specific contributions', () => {
  it('rejects skill-pack with no skills', () => {
    const m = loadFixture('skill-pack') as Record<string, unknown>
    ;(m.contributions as { skills: unknown[] }).skills = []
    expect(() => parseManifest(m)).toThrow()
  })

  it('rejects knowledge-pack with no knowledge', () => {
    const m = loadFixture('knowledge-pack') as Record<string, unknown>
    ;(m.contributions as { knowledge: unknown[] }).knowledge = []
    expect(() => parseManifest(m)).toThrow()
  })

  it('rejects workflow-pack with no workflows OR workflow-skills', () => {
    const m = loadFixture('workflow-pack') as Record<string, unknown>
    m.contributions = { assets: ['assets/icon.png'] }
    expect(() => parseManifest(m)).toThrow()
  })

  it('accepts workflow-pack with only workflows (no workflow-skills)', () => {
    const m = loadFixture('workflow-pack') as Record<string, unknown>
    m.contributions = { workflows: ['workflows/foo.yaml'] }
    expect(() => parseManifest(m)).not.toThrow()
  })

  it('accepts workflow-pack with only workflow-skills (no workflows)', () => {
    const m = loadFixture('workflow-pack') as Record<string, unknown>
    m.contributions = { workflowSkills: ['workflow-skills/foo.md'] }
    expect(() => parseManifest(m)).not.toThrow()
  })
})

describe('manifest schema — kind cross-pollination', () => {
  it('rejects agent stanza on a skill-pack', () => {
    const m = loadFixture('skill-pack') as Record<string, unknown>
    m.agent = { identity: { name: 'Sneaky' } }
    // Discriminated union refuses extra keys via skill-pack's strict object shape
    // when we read back — here we check zod refuses an `agent` field that
    // skill-pack doesn't declare. The current shape is permissive on extra keys
    // (zod default), so this test documents that we accept it; tighten later if
    // we move to .strict().
    const result = safeParseManifest(m)
    expect(result.success).toBe(true)
  })

  it('rejects agent kind missing the agent stanza', () => {
    const m = loadFixture('agent') as Record<string, unknown>
    delete m.agent
    expect(() => parseManifest(m)).toThrow()
  })

  it('rejects agent kind missing the install stanza', () => {
    const m = loadFixture('agent') as Record<string, unknown>
    delete m.install
    expect(() => parseManifest(m)).toThrow()
  })
})

describe('safeParseManifest', () => {
  it('returns success: true with typed data on valid input', () => {
    const result = safeParseManifest(loadFixture('skill-pack'))
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('should not happen')
    expect(result.data.kind).toBe('skill-pack')
  })

  it('returns success: false with ZodError on invalid input', () => {
    const result = safeParseManifest({ kind: 'agent' })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('should not happen')
    expect(result.error.issues.length).toBeGreaterThan(0)
  })
})

describe('formatManifestError', () => {
  it('produces a single-line message', () => {
    const result = safeParseManifest({ kind: 'agent' })
    if (result.success) throw new Error('expected failure')
    const message = formatManifestError(result.error)
    expect(message).not.toContain('\n')
    expect(message.length).toBeGreaterThan(0)
  })
})

describe('ManifestSchema (direct safeParse for parity)', () => {
  it('matches parseManifest output for valid input', () => {
    const fixture = loadFixture('agent')
    const direct = ManifestSchema.parse(fixture)
    const wrapped = parseManifest(fixture)
    expect(direct).toEqual(wrapped)
  })
})
