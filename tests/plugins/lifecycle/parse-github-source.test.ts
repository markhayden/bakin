/**
 * Coverage for the shared install-source parser introduced in Phase 1
 * P1.C2. The parser is pure (no fs / git / env reads) but CLAUDE.md
 * test isolation rules demand the standard content-dir + openclaw-home
 * mocks be in place so any future regression that adds a side effect
 * cannot accidentally touch `~/.bakin/` or `~/.openclaw/`.
 *
 * The parser is the single source of truth for both the install endpoint
 * (`packages/host/src/api/plugins/install.ts`) and the upgrade flow
 * (`src/core/plugins/upgrade.ts`); these tests are the contract.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-parse-github-source-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

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
  parseGithubSource,
  InvalidGithubSourceError,
} from '../../../packages/core/src/plugins/source'

describe('parseGithubSource — shorthand', () => {
  it('expands github:user/repo to full https clone URL', () => {
    expect(parseGithubSource('github:owner/repo')).toEqual({
      cloneUrl: 'https://github.com/owner/repo.git',
      subpath: '',
    })
  })

  it('expands user/repo (no prefix) to full https clone URL', () => {
    expect(parseGithubSource('owner/repo')).toEqual({
      cloneUrl: 'https://github.com/owner/repo.git',
      subpath: '',
    })
  })

  it('preserves explicit .git suffix', () => {
    expect(parseGithubSource('github:owner/repo.git')).toEqual({
      cloneUrl: 'https://github.com/owner/repo.git',
      subpath: '',
    })
  })

  it('rejects shorthand with `@ref` until #177 lands', () => {
    expect(() => parseGithubSource('github:owner/repo@v1.2.3')).toThrow(
      InvalidGithubSourceError,
    )
  })
})

describe('parseGithubSource — full URLs pass through', () => {
  it.each([
    ['https://github.com/owner/repo.git', 'https://github.com/owner/repo.git'],
    ['http://example.com/owner/repo.git', 'http://example.com/owner/repo.git'],
    ['git@github.com:owner/repo.git', 'git@github.com:owner/repo.git'],
    ['ssh://git@github.com/owner/repo.git', 'ssh://git@github.com/owner/repo.git'],
    ['file:///abs/path/to/repo', 'file:///abs/path/to/repo'],
  ])('passes through %p', (input, expected) => {
    expect(parseGithubSource(input).cloneUrl).toBe(expected)
  })
})

describe('parseGithubSource — subpath extraction', () => {
  it('extracts subpath from shorthand', () => {
    expect(parseGithubSource('github:owner/repo#plugins/foo')).toEqual({
      cloneUrl: 'https://github.com/owner/repo.git',
      subpath: 'plugins/foo',
    })
  })

  it('extracts subpath from https URL', () => {
    expect(parseGithubSource('https://github.com/owner/repo.git#plugins/foo')).toEqual({
      cloneUrl: 'https://github.com/owner/repo.git',
      subpath: 'plugins/foo',
    })
  })

  it('extracts subpath from git@ form', () => {
    expect(parseGithubSource('git@github.com:owner/repo.git#plugins/foo')).toEqual({
      cloneUrl: 'git@github.com:owner/repo.git',
      subpath: 'plugins/foo',
    })
  })

  it('handles deep nested subpaths', () => {
    expect(parseGithubSource('github:owner/repo#deep/nested/plugin/path')).toEqual({
      cloneUrl: 'https://github.com/owner/repo.git',
      subpath: 'deep/nested/plugin/path',
    })
  })

  it('returns empty subpath when no `#`', () => {
    expect(parseGithubSource('github:owner/repo').subpath).toBe('')
  })
})

describe('parseGithubSource — security/refusal cases', () => {
  it.each([
    ['empty string', ''],
    ['leading dash', '-rf /tmp'],
    ['control char', 'github:owner/repo\x00'],
    ['whitespace', 'github:owner/repo '],
    ['empty subpath after #', 'github:owner/repo#'],
    ['leading slash in subpath', 'github:owner/repo#/plugins/foo'],
    ['trailing slash in subpath', 'github:owner/repo#plugins/foo/'],
    ['parent traversal', 'github:owner/repo#plugins/../etc'],
    ['dot segment', 'github:owner/repo#./plugins/foo'],
    ['multiple #', 'github:owner/repo#a#b'],
    ['invalid shorthand', 'not-a-valid-shorthand'],
    ['shorthand with @ref', 'github:owner/repo@v1'],
    ['leading dot in owner', 'github:.owner/repo'],
  ])('rejects %s', (_label, source) => {
    expect(() => parseGithubSource(source)).toThrow(InvalidGithubSourceError)
  })

  it('rejects clone URL longer than 2048 bytes', () => {
    const long = 'https://github.com/' + 'a'.repeat(2100) + '/repo.git'
    expect(() => parseGithubSource(long)).toThrow(InvalidGithubSourceError)
  })
})
