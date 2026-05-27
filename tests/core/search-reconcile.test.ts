import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

import {
  globToRegex,
  matchesAnyPattern,
  findMatchingMapper,
  walkFiles,
  performStartupReconcile,
  MTIME_FIELD,
} from '@/core/search-reconcile'
import type { FileBackedContentTypeDefinition, FilePatternMapper } from '../../packages/core/src/plugin-types'

describe('search-reconcile', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-reconcile-'))
    mock.clearAllMocks()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // globToRegex / matching
  // -------------------------------------------------------------------------

  describe('globToRegex', () => {
    it('matches *.md files in a flat directory', () => {
      const re = globToRegex('projects/*.md')
      expect(re.test('projects/foo.md')).toBe(true)
      expect(re.test('projects/sub/foo.md')).toBe(false)
      expect(re.test('projects/foo.json')).toBe(false)
    })

    it('matches alternation patterns', () => {
      const re = globToRegex('workflows/definitions/*.{yaml,yml}')
      expect(re.test('workflows/definitions/x.yaml')).toBe(true)
      expect(re.test('workflows/definitions/x.yml')).toBe(true)
      expect(re.test('workflows/definitions/x.json')).toBe(false)
    })

    it('matches recursive ** patterns', () => {
      const re = globToRegex('assets/**/*')
      expect(re.test('assets/image/file.jpg')).toBe(true)
      expect(re.test('assets/image/sub/file.jpg')).toBe(true)
      expect(re.test('assets/file.jpg')).toBe(true)
    })

    it('matches exclude pattern for trash subdirs', () => {
      const re = globToRegex('assets/**/.trash/**')
      expect(re.test('assets/image/.trash/old.jpg')).toBe(true)
      expect(re.test('assets/image/.trash/sub/old.jpg')).toBe(true)
      expect(re.test('assets/image/old.jpg')).toBe(false)
    })

    it('escapes regex metacharacters in literals', () => {
      const re = globToRegex('a.b/c.json')
      expect(re.test('a.b/c.json')).toBe(true)
      expect(re.test('aXb/cXjson')).toBe(false)
    })
  })

  describe('matchesAnyPattern', () => {
    it('returns true on first match', () => {
      expect(matchesAnyPattern('projects/foo.md', ['projects/*.md', 'workflows/*.yaml'])).toBe(true)
      expect(matchesAnyPattern('workflows/foo.yaml', ['projects/*.md', 'workflows/*.yaml'])).toBe(true)
    })

    it('returns false when no pattern matches', () => {
      expect(matchesAnyPattern('random/x.txt', ['projects/*.md'])).toBe(false)
    })
  })

  describe('findMatchingMapper', () => {
    it('returns the first matching mapper', () => {
      const mapperA: FilePatternMapper = {
        pattern: 'workflows/definitions/*.yaml',
        fileToId: () => 'a',
        fileToDoc: async () => null,
      }
      const mapperB: FilePatternMapper = {
        pattern: 'workflows/instances/*.json',
        fileToId: () => 'b',
        fileToDoc: async () => null,
      }
      expect(findMatchingMapper('workflows/definitions/x.yaml', [mapperA, mapperB])).toBe(mapperA)
      expect(findMatchingMapper('workflows/instances/x.json', [mapperA, mapperB])).toBe(mapperB)
      expect(findMatchingMapper('other/x.md', [mapperA, mapperB])).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // walkFiles
  // -------------------------------------------------------------------------

  describe('walkFiles', () => {
    it('finds files matching include patterns', () => {
      mkdirSync(join(tempDir, 'projects'), { recursive: true })
      writeFileSync(join(tempDir, 'projects', 'one.md'), 'a')
      writeFileSync(join(tempDir, 'projects', 'two.md'), 'b')
      writeFileSync(join(tempDir, 'projects', 'ignore.json'), 'c')

      const found = walkFiles(tempDir, ['projects/*.md'])
      const rels = found.map(f => f.rel).sort()
      expect(rels).toEqual(['projects/one.md', 'projects/two.md'])
      expect(found[0].mtimeMs).toBeGreaterThan(0)
    })

    it('honors exclude patterns', () => {
      mkdirSync(join(tempDir, 'assets', 'image'), { recursive: true })
      mkdirSync(join(tempDir, 'assets', 'image', '.trash'), { recursive: true })
      writeFileSync(join(tempDir, 'assets', 'image', 'live.jpg'), 'x')
      writeFileSync(join(tempDir, 'assets', 'image', '.trash', 'dead.jpg'), 'y')

      const found = walkFiles(tempDir, ['assets/**/*'], ['assets/**/.trash/**'])
      const rels = found.map(f => f.rel)
      expect(rels).toContain('assets/image/live.jpg')
      expect(rels.some(r => r.includes('.trash'))).toBe(false)
    })

    it('skips dotfiles by default', () => {
      mkdirSync(join(tempDir, 'projects'), { recursive: true })
      writeFileSync(join(tempDir, 'projects', '.hidden.md'), 'x')
      writeFileSync(join(tempDir, 'projects', 'visible.md'), 'y')

      const found = walkFiles(tempDir, ['projects/*.md'])
      expect(found.map(f => f.rel)).toEqual(['projects/visible.md'])
    })

    it('walks nested directories for ** patterns', () => {
      mkdirSync(join(tempDir, 'a', 'b', 'c'), { recursive: true })
      writeFileSync(join(tempDir, 'a', 'b', 'c', 'deep.md'), 'd')

      const found = walkFiles(tempDir, ['a/**/*.md'])
      expect(found.map(f => f.rel)).toEqual(['a/b/c/deep.md'])
    })
  })

  // -------------------------------------------------------------------------
  // performStartupReconcile
  // -------------------------------------------------------------------------

  function makeDef(overrides: Partial<FileBackedContentTypeDefinition> = {}): FileBackedContentTypeDefinition {
    return {
      table: 'projects',
      schema: { title: { type: 'text' } },
      searchableFields: ['title'],
      embeddingTemplate: '{{title}}',
      reindex: async function* () {},
      verifyExists: async () => true,
      filePatterns: [
        {
          pattern: 'projects/*.md',
          fileToId: (rel) => rel.replace(/^projects\//, '').replace(/\.md$/, ''),
          fileToDoc: async (rel, content) => ({ title: rel, body: content }),
        },
      ],
      ...overrides,
    }
  }

  it('indexes files that exist on disk but not in the index', async () => {
    mkdirSync(join(tempDir, 'projects'), { recursive: true })
    writeFileSync(join(tempDir, 'projects', 'alpha.md'), 'alpha body')

    const indexed: Array<{ key: string; doc: Record<string, unknown> }> = []
    const removed: string[] = []

    const result = await performStartupReconcile(makeDef(), tempDir, {
      index: async (key, doc) => { indexed.push({ key, doc }) },
      remove: async (key) => { removed.push(key) },
      scanIndex: async function* () {},
    })

    expect(indexed).toHaveLength(1)
    expect(indexed[0].key).toBe('alpha')
    expect(indexed[0].doc.title).toBe('projects/alpha.md')
    expect(indexed[0].doc[MTIME_FIELD]).toBeGreaterThan(0)
    expect(removed).toEqual([])
    expect(result.indexed).toBe(1)
    expect(result.removed).toBe(0)
  })

  it('removes index entries with no matching file on disk', async () => {
    mkdirSync(join(tempDir, 'projects'), { recursive: true })
    // No files on disk, but the index contains "stale".

    const indexed: string[] = []
    const removed: string[] = []

    const result = await performStartupReconcile(makeDef(), tempDir, {
      index: async (key) => { indexed.push(key) },
      remove: async (key) => { removed.push(key) },
      scanIndex: async function* () {
        yield { key: 'stale', mtimeMs: 1000 }
      },
    })

    expect(indexed).toEqual([])
    expect(removed).toEqual(['stale'])
    expect(result.removed).toBe(1)
  })

  it('keeps virtual index entries that still exist according to verifyExists', async () => {
    mkdirSync(join(tempDir, 'projects'), { recursive: true })

    const removed: string[] = []
    const result = await performStartupReconcile(makeDef({
      preserveVirtualDocuments: true,
      verifyExists: async (key) => key === 'virtual',
    }), tempDir, {
      index: async () => {},
      remove: async (key) => { removed.push(key) },
      scanIndex: async function* () {
        yield { key: 'virtual', mtimeMs: 1000 }
        yield { key: 'stale', mtimeMs: 1000 }
      },
    })

    expect(removed).toEqual(['stale'])
    expect(result.removed).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('indexes virtual documents from reindex when preserveVirtualDocuments is enabled', async () => {
    mkdirSync(join(tempDir, 'projects'), { recursive: true })

    const indexed: Array<{ key: string; doc: Record<string, unknown> }> = []
    const removed: string[] = []
    const result = await performStartupReconcile(makeDef({
      preserveVirtualDocuments: true,
      reindex: async function* () {
        yield { key: 'virtual', doc: { title: 'Virtual doc' } }
      },
      verifyExists: async (key) => key === 'virtual',
    }), tempDir, {
      index: async (key, doc) => { indexed.push({ key, doc }) },
      remove: async (key) => { removed.push(key) },
      scanIndex: async function* () {},
    })

    expect(indexed).toHaveLength(1)
    expect(indexed[0].key).toBe('virtual')
    expect(indexed[0].doc.title).toBe('Virtual doc')
    expect(indexed[0].doc[MTIME_FIELD]).toBe(0)
    expect(removed).toEqual([])
    expect(result.indexed).toBe(1)
  })

  it('skips files whose mtime matches the indexed mtime', async () => {
    mkdirSync(join(tempDir, 'projects'), { recursive: true })
    const filePath = join(tempDir, 'projects', 'beta.md')
    writeFileSync(filePath, 'beta body')
    const fixedMtime = new Date('2026-01-01T00:00:00Z')
    utimesSync(filePath, fixedMtime, fixedMtime)

    const indexed: string[] = []
    const result = await performStartupReconcile(makeDef(), tempDir, {
      index: async (key) => { indexed.push(key) },
      remove: async () => {},
      scanIndex: async function* () {
        yield { key: 'beta', mtimeMs: fixedMtime.getTime() }
      },
    })

    expect(indexed).toEqual([])
    expect(result.skipped).toBe(1)
    expect(result.indexed).toBe(0)
  })

  it('re-indexes files whose fs mtime is newer than indexed mtime', async () => {
    mkdirSync(join(tempDir, 'projects'), { recursive: true })
    const filePath = join(tempDir, 'projects', 'gamma.md')
    writeFileSync(filePath, 'gamma body')

    const indexed: string[] = []
    const result = await performStartupReconcile(makeDef(), tempDir, {
      index: async (key) => { indexed.push(key) },
      remove: async () => {},
      scanIndex: async function* () {
        yield { key: 'gamma', mtimeMs: 1000 } // very stale
      },
    })

    expect(indexed).toEqual(['gamma'])
    expect(result.indexed).toBe(1)
  })

  it('uses onSync escape hatch when provided', async () => {
    mkdirSync(join(tempDir, 'projects'), { recursive: true })
    writeFileSync(join(tempDir, 'projects', 'delta.md'), 'delta body')

    const onSync = mock(async () => {})
    const indexed: string[] = []

    await performStartupReconcile(
      makeDef({ onSync }),
      tempDir,
      {
        index: async (key) => { indexed.push(key) },
        remove: async () => {},
        scanIndex: async function* () {},
      },
    )

    expect(onSync).toHaveBeenCalledTimes(1)
    expect(onSync).toHaveBeenCalledWith('projects/delta.md', 'delta body')
    expect(indexed).toEqual([])
  })

  it('skips files whose mapper.fileToDoc returns null', async () => {
    mkdirSync(join(tempDir, 'projects'), { recursive: true })
    writeFileSync(join(tempDir, 'projects', 'epsilon.md'), 'x')

    const def = makeDef({
      filePatterns: [
        {
          pattern: 'projects/*.md',
          fileToId: (rel) => rel,
          fileToDoc: async () => null,
        },
      ],
    })

    const indexed: string[] = []
    const result = await performStartupReconcile(def, tempDir, {
      index: async (key) => { indexed.push(key) },
      remove: async () => {},
      scanIndex: async function* () {},
    })

    expect(indexed).toEqual([])
    expect(result.skipped).toBe(1)
  })

  it('skips files whose mapper.fileToId returns null', async () => {
    mkdirSync(join(tempDir, 'projects'), { recursive: true })
    writeFileSync(join(tempDir, 'projects', 'zeta.md'), 'x')

    const def = makeDef({
      filePatterns: [
        {
          pattern: 'projects/*.md',
          fileToId: () => null,
          fileToDoc: async () => ({ title: 'x' }),
        },
      ],
    })

    const indexed: string[] = []
    await performStartupReconcile(def, tempDir, {
      index: async (key) => { indexed.push(key) },
      remove: async () => {},
      scanIndex: async function* () {},
    })

    expect(indexed).toEqual([])
  })

  it('skips zombie index rows with empty keys instead of calling remove', async () => {
    // A legacy / corrupted row with an empty _key in the underlying store
    // must not cause the reconcile to blow up with "nonempty key required".
    mkdirSync(join(tempDir, 'projects'), { recursive: true })
    writeFileSync(join(tempDir, 'projects', 'alpha.md'), 'alpha body')

    const removed: string[] = []
    const result = await performStartupReconcile(makeDef(), tempDir, {
      index: async () => {},
      remove: async (key) => { removed.push(key) },
      scanIndex: async function* () {
        yield { key: '', mtimeMs: 0 }
        yield { key: 'real-orphan', mtimeMs: 1000 }
      },
    })

    // Real orphan still removed; empty key is skipped cleanly.
    expect(removed).toEqual(['real-orphan'])
    expect(result.removed).toBe(1)
    expect(result.errors).toBe(0)
  })

  it('handles mixed drift in a single pass', async () => {
    mkdirSync(join(tempDir, 'projects'), { recursive: true })
    writeFileSync(join(tempDir, 'projects', 'fresh.md'), 'new content')

    const indexed: string[] = []
    const removed: string[] = []

    const result = await performStartupReconcile(makeDef(), tempDir, {
      index: async (key) => { indexed.push(key) },
      remove: async (key) => { removed.push(key) },
      scanIndex: async function* () {
        yield { key: 'orphan', mtimeMs: 1000 } // not on disk → remove
      },
    })

    expect(indexed).toEqual(['fresh'])
    expect(removed).toEqual(['orphan'])
    expect(result.indexed).toBe(1)
    expect(result.removed).toBe(1)
  })
})
