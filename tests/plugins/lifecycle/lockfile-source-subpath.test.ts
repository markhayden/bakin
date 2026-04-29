/**
 * Schema-level coverage for the `#subpath` extension to SourceStringSchema
 * (Phase 1 P1.C1). The schema is loose by design — the install/upgrade
 * parsers carry the actual git-clone hardening — but it is the last line
 * of defence before the lockfile lands on disk, so malformed subpaths
 * must round-trip-fail here.
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-source-subpath-${Date.now()}-${randomUUID()}`)
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
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import {
  PluginLockfileSchema,
  type PluginLockEntry,
} from '../../../packages/core/src/plugins/lockfile'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

const NOW = '2026-04-25T12:00:00Z'

function entryWithSource(source: string): PluginLockEntry {
  return {
    source,
    type: 'github',
    ref: 'main',
    commitSha: '0123456789abcdef0123456789abcdef01234567',
    installedAt: NOW,
    version: '1.0.0',
    permissions: ['storage.read'],
    manifestSha: 'deadbeefcafe',
  }
}

function parseSource(source: string): { ok: boolean } {
  const candidate = {
    version: 1,
    plugins: { foo: entryWithSource(source) },
  }
  const result = PluginLockfileSchema.safeParse(candidate)
  return { ok: result.success }
}

describe('SourceStringSchema — accepted forms', () => {
  it.each([
    'github:user/repo',
    'github:user/repo.git',
    'github:user/repo@v1.2.3',
    'github:user/repo@main',
    'github:user/repo#plugins/foo',
    'github:user/repo#plugins/foo-bar',
    'github:user/repo#plugins/foo_bar.v2',
    'github:user/repo@v1.2.3#plugins/foo',
    'github:user/repo#deep/nested/path/to/plugin',
    'https://github.com/user/repo.git',
    'https://github.com/user/repo.git#plugins/foo',
    'git@github.com:user/repo.git',
    '/Users/dev/local-plugin',
    '~/dev/local-plugin',
  ])('accepts %p', (source) => {
    expect(parseSource(source).ok).toBe(true)
  })
})

describe('SourceStringSchema — rejected forms', () => {
  it.each([
    ['empty string', ''],
    ['leading dash (option smuggling)', '-rf /tmp'],
    ['control char', 'github:user/repo\x00'],
    ['empty subpath after #', 'github:user/repo#'],
    ['leading slash in subpath', 'github:user/repo#/plugins/foo'],
    ['trailing slash in subpath', 'github:user/repo#plugins/foo/'],
    ['parent traversal in subpath', 'github:user/repo#plugins/../etc'],
    ['dot segment in subpath', 'github:user/repo#./plugins/foo'],
    ['multiple # delimiters', 'github:user/repo#a#b'],
    ['space in subpath', 'github:user/repo#plugins/foo bar'],
    ['null byte in subpath', 'github:user/repo#plugins/\x00'],
  ])('rejects %s', (_label, source) => {
    expect(parseSource(source).ok).toBe(false)
  })
})
