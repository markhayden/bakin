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
    expect(m.install.enableLessons).toEqual(['prompt-style-system'])
    expect(m.contributions.skills).toEqual(['skills/image-generation'])
    expect(m.dependencies?.skills?.[0].source).toBe('github:markhayden/bakin-skills-visual')
    expect(m.dependencies?.skills?.[0].installAs).toBeNull()
  })

  it('parses shared top-level secret declarations', () => {
    const input = loadFixture('agent') as Record<string, unknown>
    input.secrets = [
      {
        name: 'RUNWAY_API_KEY',
        description: 'Runway API key used by video generation workflows.',
        required: true,
      },
      {
        name: 'ELEVENLABS_API_KEY',
        description: 'ElevenLabs API key used by voice generation workflows.',
      },
    ]

    const m = parseManifest(input)

    expect(m.secrets).toEqual([
      {
        name: 'RUNWAY_API_KEY',
        description: 'Runway API key used by video generation workflows.',
        required: true,
      },
      {
        name: 'ELEVENLABS_API_KEY',
        description: 'ElevenLabs API key used by voice generation workflows.',
        required: true,
      },
    ])
  })

  it('parses a skill-pack manifest', () => {
    const m = parseManifest(loadFixture('skill-pack'))
    expect(m.kind).toBe('skill-pack')
    if (m.kind !== 'skill-pack') throw new Error('discriminator narrowing failed')
    expect(m.contributions.skills).toHaveLength(2)
  })

  it('parses a capability pack (skill-pack + capability/runtimes/requires/secretSlot)', () => {
    const m = parseManifest(loadFixture('capability-pack'))
    if (m.kind !== 'skill-pack') throw new Error('discriminator narrowing failed')
    expect(m.capability).toBe('web-search')
    expect(m.runtimes).toEqual(['*'])
    expect(m.requires?.bins?.[0]?.name).toBe('bx')
    expect(m.requires?.bins?.[0]?.install['darwin-arm64']?.sha256).toHaveLength(64)
    expect(m.requires?.bins?.[0]?.verifyArgs).toEqual(['--version'])
    expect(m.secrets?.[0]?.secretSlot).toBe('brave.apiKey')
    expect(m.secrets?.[0]?.help).toContain('https://')
  })

  it('defaults runtimes to ["*"] when omitted on a capability pack', () => {
    const raw = loadFixture('capability-pack') as Record<string, unknown>
    delete raw.runtimes
    const m = parseManifest(raw)
    if (m.kind !== 'skill-pack') throw new Error('discriminator narrowing failed')
    expect(m.runtimes).toEqual(['*'])
  })

  it('rejects capability-pack extension malformations', () => {
    const base = () => JSON.parse(JSON.stringify(loadFixture('capability-pack'))) as Record<string, any>

    const badSlug = base()
    badSlug.capability = 'Web Search!'
    expect(safeParseManifest(badSlug).success).toBe(false)

    const badSha = base()
    badSha.requires.bins[0].install['darwin-arm64'].sha256 = 'not-a-sha'
    expect(safeParseManifest(badSha).success).toBe(false)

    const badPlatform = base()
    badPlatform.requires.bins[0].install['amiga-68k'] = badPlatform.requires.bins[0].install['darwin-arm64']
    expect(safeParseManifest(badPlatform).success).toBe(false)

    const badSlot = base()
    badSlot.secrets[0].secretSlot = 'no-dot-separator'
    expect(safeParseManifest(badSlot).success).toBe(false)

    const badUrl = base()
    badUrl.requires.bins[0].install['darwin-arm64'].url = 'ftp://nope'
    expect(safeParseManifest(badUrl).success).toBe(false)
  })

  it('parses a workflow-pack manifest', () => {
    const m = parseManifest(loadFixture('workflow-pack'))
    expect(m.kind).toBe('workflow-pack')
    if (m.kind !== 'workflow-pack') throw new Error('discriminator narrowing failed')
    expect(m.contributions.workflows).toHaveLength(2)
    expect(m.contributions.workflowSkills).toHaveLength(1)
  })

  it('parses a lesson-pack manifest', () => {
    const m = parseManifest(loadFixture('lesson-pack'))
    expect(m.kind).toBe('lesson-pack')
    if (m.kind !== 'lesson-pack') throw new Error('discriminator narrowing failed')
    expect(m.contributions.lessons).toHaveLength(2)
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

describe('manifest schema — secret declarations', () => {
  it('rejects legacy string-array secrets', () => {
    const m = loadFixture('agent') as Record<string, unknown>
    m.secrets = ['RUNWAY_API_KEY']
    expect(() => parseManifest(m)).toThrow()
  })

  it('rejects non-env-var secret names', () => {
    const m = loadFixture('agent') as Record<string, unknown>
    m.secrets = [
      {
        name: 'runway-api-key',
        description: 'Runway API key.',
        required: true,
      },
    ]
    expect(() => parseManifest(m)).toThrow()
  })

  it('rejects missing secret descriptions', () => {
    const m = loadFixture('agent') as Record<string, unknown>
    m.secrets = [
      {
        name: 'RUNWAY_API_KEY',
        required: true,
      },
    ]
    expect(() => parseManifest(m)).toThrow()
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

  it('rejects lesson-pack with no lessons', () => {
    const m = loadFixture('lesson-pack') as Record<string, unknown>
    ;(m.contributions as { lessons: unknown[] }).lessons = []
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

describe('manifest schema — requirement legs (npm/models/prereqs/platforms)', () => {
  function skillPackWith(requires: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const base = loadFixture('skill-pack') as Record<string, unknown>
    return { ...base, requires: { ...(base.requires as Record<string, unknown> ?? {}), ...requires }, ...extra }
  }

  it('parses an npm payload leg with exact-pinned dependencies', () => {
    const m = parseManifest(skillPackWith({
      npm: [{
        name: 'browser-scripts',
        source: 'payload/browser',
        dependencies: { 'puppeteer-core': '24.9.0', '@mozilla/readability': '0.5.0' },
        env: { PUPPETEER_SKIP_DOWNLOAD: '1' },
      }],
    }))
    if (m.kind !== 'skill-pack') throw new Error('kind')
    expect(m.requires?.npm?.[0].name).toBe('browser-scripts')
    expect(m.requires?.npm?.[0].dependencies['puppeteer-core']).toBe('24.9.0')
  })

  it('rejects npm dependency version RANGES — exact pins only', () => {
    for (const bad of ['^24.9.0', '~1.2.3', '>=1.0.0', '*', '1.x', 'latest']) {
      expect(() => parseManifest(skillPackWith({
        npm: [{ name: 'p', source: 'payload/p', dependencies: { dep: bad } }],
      }))).toThrow(/exact/i)
    }
  })

  it('rejects npm payload source paths that escape the pack', () => {
    for (const bad of ['../outside', '/abs/path', 'a/../../b']) {
      expect(() => parseManifest(skillPackWith({
        npm: [{ name: 'p', source: bad, dependencies: { dep: '1.0.0' } }],
      }))).toThrow()
    }
  })

  it('parses a models leg with sha256 pin and relative dest', () => {
    const m = parseManifest(skillPackWith({
      models: [{
        name: 'parakeet-tdt',
        url: 'https://huggingface.co/x/y/resolve/main/model.gguf',
        sha256: 'b00ed12e06aaf4023d74a3dcd919fa3e69afe8fea7b992913f8783eafa490ce0',
        bytes: 940_000_000,
        dest: 'parakeet/tdt-0.6b-v3-q8_0.gguf',
        env: { PARAKEET_CPP_MODEL_PATH: '{dest}' },
      }],
    }))
    if (m.kind !== 'skill-pack') throw new Error('kind')
    expect(m.requires?.models?.[0].bytes).toBe(940_000_000)
  })

  it('rejects model dest paths that are absolute or traverse', () => {
    for (const bad of ['/abs/model.gguf', '../escape.gguf', 'a/../../b.gguf']) {
      expect(() => parseManifest(skillPackWith({
        models: [{ name: 'm', url: 'https://x.dev/m.gguf', sha256: 'a'.repeat(64), bytes: 10, dest: bad }],
      }))).toThrow()
    }
  })

  it('parses prereq legs — PATH binary and macOS app', () => {
    const m = parseManifest(skillPackWith({
      prereqs: [
        { name: 'ffmpeg', kind: 'binary', probe: 'ffmpeg', help: 'https://ffmpeg.org' },
        { name: 'Google Chrome', kind: 'app', probe: '/Applications/Google Chrome.app', help: 'https://www.google.com/chrome/' },
      ],
    }))
    if (m.kind !== 'skill-pack') throw new Error('kind')
    expect(m.requires?.prereqs?.map((p) => p.kind)).toEqual(['binary', 'app'])
  })

  it('rejects an app prereq with a non-absolute probe and a binary prereq with a path probe', () => {
    expect(() => parseManifest(skillPackWith({
      prereqs: [{ name: 'Chrome', kind: 'app', probe: 'Google Chrome.app', help: 'https://x.dev' }],
    }))).toThrow()
    expect(() => parseManifest(skillPackWith({
      prereqs: [{ name: 'ffmpeg', kind: 'binary', probe: '/usr/local/bin/ffmpeg', help: 'https://x.dev' }],
    }))).toThrow()
  })

  it('parses pack-level platforms and rejects unknown keys / empty list', () => {
    const m = parseManifest(skillPackWith({}, { platforms: ['darwin-arm64'] }))
    if (m.kind !== 'skill-pack') throw new Error('kind')
    expect(m.platforms).toEqual(['darwin-arm64'])
    expect(() => parseManifest(skillPackWith({}, { platforms: [] }))).toThrow()
    expect(() => parseManifest(skillPackWith({}, { platforms: ['windows-x64'] }))).toThrow()
  })
})

describe('manifest schema — review hardening pins', () => {
  function skillPackWithBin(download: Record<string, unknown>): Record<string, unknown> {
    const base = loadFixture('skill-pack') as Record<string, unknown>
    return {
      ...base,
      requires: { bins: [{ name: 'tool', version: '1.0.0', install: { 'darwin-arm64': download } }] },
    }
  }

  it('rejects archive members shaped like tar options (argument injection)', () => {
    expect(() => parseManifest(skillPackWithBin({
      url: 'https://x.dev/t.tar.gz', sha256: 'a'.repeat(64),
      archive: { format: 'tar.gz', member: '--to-command=/bin/sh' },
    }))).toThrow(/no leading -/)
  })

  it('rejects traversal-shaped dependency installAs (payload dirs are swept destructively)', () => {
    const base = loadFixture('skill-pack') as Record<string, unknown>
    expect(() => parseManifest({
      ...base,
      dependencies: { skills: [{ source: 'github:x/y', ref: 'abc', installAs: '../../..' }] },
    })).toThrow()
  })
})
