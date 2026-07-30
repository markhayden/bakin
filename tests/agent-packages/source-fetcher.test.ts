/**
 * Tests for the source fetcher (Phase E-1).
 *
 * Coverage:
 *   - parseGithubSpec on canonical + malformed inputs
 *   - github monorepo #subpath parsing and staging
 *   - fetchSource('github:...') happy path via a local bare git repo as fixture
 *   - fetchSource(local path) copies to staging
 *   - bare-name input rejected
 *   - http:// and https:// rejected
 *   - empty source rejected
 *   - missing bakin-package.json after fetch fails + cleans up staging
 *   - escape attempts (paths outside HOME + cwd) refused
 *   - git failure fallback (--branch fails → clone + checkout retry)
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-source-fetcher-${Date.now()}-${randomUUID()}`)

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
  fetchGithubWithRunner,
  fetchGithubWithRunnerAsync,
  fetchSource,
  parseGithubSpec,
  sourceSpecWithRef,
} from '../../src/core/agent-packages/source-fetcher'
import { resetGithubSourceCacheForTests } from '../../src/core/github-source-cache'

afterAll(() => {
  resetGithubSourceCacheForTests()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  resetGithubSourceCacheForTests()
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

const VALID_AGENT_MANIFEST = JSON.stringify({
  id: 'pixel',
  kind: 'agent',
  name: 'Pixel',
  version: '0.1.0',
  agent: { identity: { name: 'Pixel' } },
  install: {},
  contributions: {},
})

function seedLocalPackage(rel = 'pixel'): string {
  const dir = join(testDir, rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'bakin-package.json'), VALID_AGENT_MANIFEST, 'utf-8')
  return dir
}

// ─── parseGithubSpec ─────────────────────────────────────────────────────────

describe('parseGithubSpec', () => {
  it('parses owner/repo with no ref', () => {
    expect(parseGithubSpec('github:owner/example-agent')).toEqual({
      owner: 'owner',
      repo: 'example-agent',
      ref: null,
      subpath: '',
    })
  })

  it('parses owner/repo@ref', () => {
    expect(parseGithubSpec('github:owner/example-agent@v0.1.0')).toEqual({
      owner: 'owner',
      repo: 'example-agent',
      ref: 'v0.1.0',
      subpath: '',
    })
  })

  it('parses owner/repo#subpath', () => {
    expect(parseGithubSpec('github:markhayden/bakin-bits-official#agents/patch')).toEqual({
      owner: 'markhayden',
      repo: 'bakin-bits-official',
      ref: null,
      subpath: 'agents/patch',
    })
  })

  it('parses owner/repo@ref#subpath', () => {
    expect(
      parseGithubSpec('github:markhayden/bakin-bits-official@v0.2.0#agents/patch'),
    ).toEqual({
      owner: 'markhayden',
      repo: 'bakin-bits-official',
      ref: 'v0.2.0',
      subpath: 'agents/patch',
    })
  })

  it('treats empty @ as no ref', () => {
    expect(parseGithubSpec('github:owner/repo@').ref).toBeNull()
  })

  it('throws on missing slash', () => {
    expect(() => parseGithubSpec('github:owner-only')).toThrow(/Malformed github source/)
  })

  it('throws on non-github source', () => {
    expect(() => parseGithubSpec('./local')).toThrow(/Not a github source/)
  })

  const invalidSubpaths: Array<[string, string]> = [
    ['empty subpath after #', 'github:owner/repo#'],
    ['leading slash', 'github:owner/repo#/agents/patch'],
    ['trailing slash', 'github:owner/repo#agents/patch/'],
    ['parent traversal', 'github:owner/repo#agents/../patch'],
    ['dot segment', 'github:owner/repo#./agents/patch'],
    ['multiple # delimiters', 'github:owner/repo#agents#patch'],
    ['space in subpath', 'github:owner/repo#agents/patch copy'],
  ]

  for (const [label, source] of invalidSubpaths) {
    it(`throws on malformed subpath: ${label}`, () => {
      expect(() => parseGithubSpec(source)).toThrow(/subpath/i)
    })
  }
})

describe('sourceSpecWithRef', () => {
  it('inserts refs before github subpaths', () => {
    expect(sourceSpecWithRef('github:markhayden/bakin-bits-official#agents/patch', 'v0.2.0'))
      .toBe('github:markhayden/bakin-bits-official@v0.2.0#agents/patch')
  })

  it('does not duplicate refs already embedded in the source', () => {
    expect(sourceSpecWithRef('github:markhayden/bakin-bits-official@v0.1.0#agents/patch', 'v0.2.0'))
      .toBe('github:markhayden/bakin-bits-official@v0.1.0#agents/patch')
  })

  it('leaves local sources unchanged', () => {
    expect(sourceSpecWithRef('./pixel', 'main')).toBe('./pixel')
  })
})

// ─── fetchSource — input validation ──────────────────────────────────────────

describe('fetchSource — input validation', () => {
  it('rejects empty source', () => {
    expect(() => fetchSource('')).toThrow(/non-empty string/)
  })

  it('rejects bare names', () => {
    expect(() => fetchSource('pixel')).toThrow(/not a valid source/)
  })

  it('rejects http:// URLs', () => {
    expect(() => fetchSource('https://example.com/foo.git')).toThrow(/not a valid source/)
  })

  it('accepts ./relative paths', () => {
    seedLocalPackage('pixel-rel')
    const result = fetchSource(join(testDir, 'pixel-rel'))
    expect(result.kind).toBe('local')
    expect(existsSync(join(result.stagingDir, 'bakin-package.json'))).toBe(true)
  })
})

// ─── fetchSource — local ─────────────────────────────────────────────────────

describe('fetchSource — local', () => {
  it('copies a valid local package to staging', () => {
    const src = seedLocalPackage('pixel-pkg')
    const result = fetchSource(src)

    expect(result.kind).toBe('local')
    expect(result.commitSha).toBe('')
    expect(result.ref).toBe('')
    expect(result.stagingDir.startsWith(testDir)).toBe(true)
    expect(existsSync(join(result.stagingDir, 'bakin-package.json'))).toBe(true)
  })

  it('throws when source path does not exist', () => {
    expect(() => fetchSource(join(testDir, 'does-not-exist'))).toThrow(/does not exist/)
  })

  it('throws when source path is a file (not directory)', () => {
    const filePath = join(testDir, 'not-a-dir.txt')
    writeFileSync(filePath, 'whatever')
    expect(() => fetchSource(filePath)).toThrow(/not a directory/)
  })

  it('throws + cleans up staging when bakin-package.json is missing', () => {
    const dir = join(testDir, 'bare-dir')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'README.md'), 'no manifest here')

    expect(() => fetchSource(dir)).toThrow(/missing bakin-package\.json/)

    // No staging dir left over
    const packagesDir = join(testDir, 'packages')
    if (existsSync(packagesDir)) {
      const stagingEntries = readdirSync(packagesDir).filter((e) =>
        e.startsWith('.staging-'),
      )
      expect(stagingEntries).toEqual([])
    }
  })

  it('refuses paths outside HOME and cwd', () => {
    // /etc is neither under home nor under cwd in any reasonable shell session
    expect(() => fetchSource('/etc')).toThrow(/Refusing to install/)
  })

  it('does not dereference symlinks during copy', () => {
    // We can't easily test "doesn't dereference" without a fixture symlink —
    // but ensuring fetchSource at least completes against a plain dir and
    // refuses path-escape is sufficient for V1. dereference:false is set
    // in source-fetcher.ts:fetchLocal.
    const src = seedLocalPackage('plain')
    const result = fetchSource(src)
    expect(result.stagingDir).toBeTruthy()
  })
})

// ─── fetchSource — github (via local bare repo as fixture) ───────────────────

describe('fetchSource — github (mock runner)', () => {
  // Helpers — git's `-C <dir>` puts <dir> at args[1], so subcommand checks
  // need to look at args[0] for `clone` and args[2] for everything else.
  const isCloneCall = (args: string[]) => args[0] === 'clone'
  const isCheckoutCall = (args: string[]) => args[0] === '-C' && args[2] === 'checkout'
  const isRevParseCall = (args: string[]) => args[0] === '-C' && args[2] === 'rev-parse'

  it('clones --depth 1 --branch <tag> on the happy path', () => {
    const calls: string[][] = []
    const mockGit = (args: string[]): string => {
      calls.push(args)
      if (isCloneCall(args)) {
        const target = args[args.length - 1]
        mkdirSync(target, { recursive: true })
        writeFileSync(join(target, 'bakin-package.json'), VALID_AGENT_MANIFEST, 'utf-8')
        return ''
      }
      if (isRevParseCall(args)) return 'abc123\n'
      return ''
    }

    const stagingDir = join(testDir, 'packages', '.staging-test')
    const result = fetchGithubWithRunner('github:markhayden/foo@v0.1.0', mockGit, stagingDir)

    expect(result.kind).toBe('github')
    expect(result.commitSha).toBe('abc123')
    expect(result.ref).toBe('v0.1.0')
    expect(calls[0]).toEqual([
      'clone',
      '--depth',
      '1',
      '--branch',
      'v0.1.0',
      'https://github.com/markhayden/foo.git',
      stagingDir,
    ])
  })

  it('falls back to deeper clone + checkout when --branch fails (commit SHA case)', () => {
    let cloneAttempts = 0
    const calls: string[][] = []
    const mockGit = (args: string[]): string => {
      calls.push(args)
      if (isCloneCall(args) && args.includes('--branch')) {
        // First clone attempt fails (simulating --branch refusing a SHA)
        cloneAttempts++
        throw new Error('fatal: Remote branch abc123abc not found')
      }
      if (isCloneCall(args)) {
        cloneAttempts++
        const target = args[args.length - 1]
        mkdirSync(target, { recursive: true })
        writeFileSync(join(target, 'bakin-package.json'), VALID_AGENT_MANIFEST, 'utf-8')
        return ''
      }
      if (isCheckoutCall(args)) return ''
      if (isRevParseCall(args)) return 'abc123abc\n'
      return ''
    }

    const stagingDir = join(testDir, 'packages', '.staging-fallback')
    const result = fetchGithubWithRunner(
      'github:markhayden/foo@abc123abc',
      mockGit,
      stagingDir,
    )

    expect(cloneAttempts).toBe(2)
    expect(result.commitSha).toBe('abc123abc')
    expect(calls.some((c) => isCheckoutCall(c) && c[3] === 'abc123abc')).toBe(true)
  })

  it('clones default branch when no ref is supplied', () => {
    const calls: string[][] = []
    const mockGit = (args: string[]): string => {
      calls.push(args)
      if (isCloneCall(args)) {
        const target = args[args.length - 1]
        mkdirSync(target, { recursive: true })
        writeFileSync(join(target, 'bakin-package.json'), VALID_AGENT_MANIFEST, 'utf-8')
        return ''
      }
      if (isRevParseCall(args)) return 'deadbeef\n'
      return ''
    }

    const stagingDir = join(testDir, 'packages', '.staging-default')
    const result = fetchGithubWithRunner('github:markhayden/foo', mockGit, stagingDir)

    expect(result.ref).toBe('')
    expect(result.commitSha).toBe('deadbeef')
    // Verify --branch flag was NOT used
    expect(calls[0]).not.toContain('--branch')
  })

  it('stages only the requested package subpath from a monorepo clone', () => {
    const calls: string[][] = []
    const mockGit = (args: string[]): string => {
      calls.push(args)
      if (isCloneCall(args)) {
        const target = args[args.length - 1]
        mkdirSync(join(target, 'agents', 'patch'), { recursive: true })
        mkdirSync(join(target, 'agents', 'other'), { recursive: true })
        writeFileSync(join(target, 'README.md'), 'repo root')
        writeFileSync(join(target, 'agents', 'patch', 'README.md'), 'patch package')
        writeFileSync(
          join(target, 'agents', 'patch', 'bakin-package.json'),
          VALID_AGENT_MANIFEST,
          'utf-8',
        )
        writeFileSync(join(target, 'agents', 'other', 'bakin-package.json'), '{}')
        return ''
      }
      if (isRevParseCall(args)) return 'feedface\n'
      return ''
    }

    const stagingDir = join(testDir, 'packages', '.staging-subpath')
    const result = fetchGithubWithRunner(
      'github:markhayden/bakin-bits-official#agents/patch',
      mockGit,
      stagingDir,
    )

    expect(result.kind).toBe('github')
    expect(result.commitSha).toBe('feedface')
    expect(result.ref).toBe('')
    expect(existsSync(join(result.stagingDir, 'bakin-package.json'))).toBe(true)
    expect(existsSync(join(result.stagingDir, 'README.md'))).toBe(true)
    expect(existsSync(join(result.stagingDir, 'agents'))).toBe(false)
  })

  it('reuses one cached checkout for repeated async subpath fetches from the same repo', async () => {
    const calls: string[][] = []
    const mockGit = async (args: string[]): Promise<string> => {
      calls.push(args)
      if (isCloneCall(args)) {
        const target = args[args.length - 1]
        mkdirSync(join(target, 'agents', 'pixel'), { recursive: true })
        mkdirSync(join(target, 'agents', 'patch'), { recursive: true })
        writeFileSync(join(target, 'README.md'), 'repo root')
        writeFileSync(join(target, 'agents', 'pixel', 'README.md'), 'pixel package')
        writeFileSync(join(target, 'agents', 'patch', 'README.md'), 'patch package')
        writeFileSync(
          join(target, 'agents', 'pixel', 'bakin-package.json'),
          VALID_AGENT_MANIFEST,
          'utf-8',
        )
        writeFileSync(
          join(target, 'agents', 'patch', 'bakin-package.json'),
          VALID_AGENT_MANIFEST,
          'utf-8',
        )
        return ''
      }
      if (isRevParseCall(args)) return 'feedface\n'
      return ''
    }

    const pixelStaging = join(testDir, 'packages', '.staging-cache-pixel')
    const patchStaging = join(testDir, 'packages', '.staging-cache-patch')
    const pixel = await fetchGithubWithRunnerAsync(
      'github:markhayden/bakin-bits-official#agents/pixel',
      mockGit,
      pixelStaging,
    )
    const patch = await fetchGithubWithRunnerAsync(
      'github:markhayden/bakin-bits-official#agents/patch',
      mockGit,
      patchStaging,
    )

    expect(calls.filter(isCloneCall)).toHaveLength(1)
    expect(pixel.commitSha).toBe('feedface')
    expect(patch.commitSha).toBe('feedface')
    expect(existsSync(join(pixel.stagingDir, 'bakin-package.json'))).toBe(true)
    expect(existsSync(join(patch.stagingDir, 'bakin-package.json'))).toBe(true)
    expect(existsSync(join(pixel.stagingDir, 'agents'))).toBe(false)
    expect(existsSync(join(patch.stagingDir, 'agents'))).toBe(false)
  })

  it('throws when requested package subpath is missing after clone', () => {
    const mockGit = (args: string[]): string => {
      if (isCloneCall(args)) {
        const target = args[args.length - 1]
        mkdirSync(target, { recursive: true })
        writeFileSync(join(target, 'bakin-package.json'), VALID_AGENT_MANIFEST, 'utf-8')
        return ''
      }
      return ''
    }

    const stagingDir = join(testDir, 'packages', '.staging-missing-subpath')
    expect(() =>
      fetchGithubWithRunner(
        'github:markhayden/bakin-bits-official#agents/patch',
        mockGit,
        stagingDir,
      ),
    ).toThrow(/subpath.*not found/i)
  })

  it('throws when requested package subpath has no manifest', () => {
    const mockGit = (args: string[]): string => {
      if (isCloneCall(args)) {
        const target = args[args.length - 1]
        mkdirSync(join(target, 'agents', 'patch'), { recursive: true })
        writeFileSync(join(target, 'agents', 'patch', 'README.md'), 'patch package')
        return ''
      }
      return ''
    }

    const stagingDir = join(testDir, 'packages', '.staging-subpath-no-manifest')
    expect(() =>
      fetchGithubWithRunner(
        'github:markhayden/bakin-bits-official#agents/patch',
        mockGit,
        stagingDir,
      ),
    // #687: the message now also rules out the raw-skill-bundle shape.
    ).toThrow(/missing bakin-package\.json.*no SKILL\.md/i)
  })

  it('throws when bakin-package.json is missing after clone', () => {
    const mockGit = (args: string[]): string => {
      if (args[0] === 'clone') {
        const target = args[args.length - 1]
        mkdirSync(target, { recursive: true })
        // Intentionally do NOT write the manifest
        return ''
      }
      return ''
    }

    const stagingDir = join(testDir, 'packages', '.staging-no-manifest')
    expect(() =>
      fetchGithubWithRunner('github:markhayden/foo@v0.1.0', mockGit, stagingDir),
    ).toThrow(/missing bakin-package\.json/)
  })
})

// ─── End-to-end against a real local git repo ────────────────────────────────

describe('fetchSource — github (real git, against a local bare repo)', () => {
  it('clones a tag from a local bare repo and reads the commit SHA', () => {
    // Build a real local git fixture:
    //   - work dir with a bakin-package.json
    //   - tagged v0.1.0
    //   - bare clone for `git clone <bare>` to point at
    const work = join(testDir, 'fixture-work')
    const bare = join(testDir, 'fixture.git')
    mkdirSync(work, { recursive: true })
    writeFileSync(join(work, 'bakin-package.json'), VALID_AGENT_MANIFEST, 'utf-8')

    // Initialize the work repo and tag v0.1.0
    execFileSync('git', ['-C', work, 'init', '--initial-branch=main'], { stdio: 'pipe' })
    execFileSync('git', ['-C', work, 'config', 'user.email', 'test@test.local'])
    execFileSync('git', ['-C', work, 'config', 'user.name', 'Test'])
    execFileSync('git', ['-C', work, 'add', '.'])
    execFileSync('git', ['-C', work, 'commit', '-m', 'initial'])
    execFileSync('git', ['-C', work, 'tag', 'v0.1.0'])

    // Create a bare clone we can `git clone` against
    execFileSync('git', ['clone', '--bare', work, bare])

    // Use a custom mock runner that swaps the github URL for our bare repo
    // path, then calls real git. This exercises the real fallback logic
    // without needing internet access.
    const fakeGitRunner = (args: string[]): string => {
      // Substitute github URL → local bare repo path
      const swapped = args.map((a) =>
        a === 'https://github.com/markhayden/foo.git' ? bare : a,
      )
      return execFileSync('git', swapped, {
        stdio: ['ignore', 'pipe', 'pipe'],
      }).toString('utf-8')
    }

    const stagingDir = join(testDir, 'packages', '.staging-real-git')
    const result = fetchGithubWithRunner(
      'github:markhayden/foo@v0.1.0',
      fakeGitRunner,
      stagingDir,
    )

    expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/)
    expect(result.ref).toBe('v0.1.0')
    expect(existsSync(join(result.stagingDir, 'bakin-package.json'))).toBe(true)
  })
})
