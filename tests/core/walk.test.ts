/**
 * packages/core/src/storage/walk.ts — the shared directory walker. Pure fs
 * over a private temp fixture tree; content-dir mocks are present defensively
 * per the repo's testing convention.
 */
import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-walk-${Date.now()}-${Math.random().toString(36).slice(2)}`)
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { walkFiles } from '../../packages/core/src/storage/walk'

const root = join(testDir, 'tree')

beforeAll(() => {
  mkdirSync(join(root, 'a/b'), { recursive: true })
  mkdirSync(join(root, 'node_modules/dep'), { recursive: true })
  mkdirSync(join(root, '.hidden-dir'), { recursive: true })
  writeFileSync(join(root, 'top.md'), 'top')
  writeFileSync(join(root, '.dotfile'), 'dot')
  writeFileSync(join(root, 'a', 'one.json'), '{}')
  writeFileSync(join(root, 'a', 'two.txt'), 'two')
  writeFileSync(join(root, 'a/b', 'deep.md'), 'deep')
  writeFileSync(join(root, 'node_modules/dep', 'index.js'), '')
  writeFileSync(join(root, '.hidden-dir', 'inside.md'), 'hidden')
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

function relPaths(opts?: Parameters<typeof walkFiles>[1]): string[] {
  return Array.from(walkFiles(root, opts), (f) => f.relPath).sort()
}

describe('walkFiles', () => {
  it('yields every file recursively with /-joined relative paths', () => {
    expect(relPaths()).toEqual([
      '.dotfile',
      '.hidden-dir/inside.md',
      'a/b/deep.md',
      'a/one.json',
      'a/two.txt',
      'node_modules/dep/index.js',
      'top.md',
    ])
  })

  it('joins path from the root argument', () => {
    const first = Array.from(walkFiles(root)).find((f) => f.relPath === 'top.md')
    expect(first?.path).toBe(join(root, 'top.md'))
    expect(first?.name).toBe('top.md')
  })

  it('yields nothing for a missing root instead of throwing', () => {
    expect(Array.from(walkFiles(join(root, 'nope')))).toEqual([])
  })

  it('skipDirs prunes matching directories without touching same-named files', () => {
    writeFileSync(join(root, 'a', 'node_modules'), 'a FILE named node_modules')
    try {
      const rels = relPaths({ skipDirs: ['node_modules'] })
      expect(rels).not.toContain('node_modules/dep/index.js')
      expect(rels).toContain('a/node_modules')
    } finally {
      rmSync(join(root, 'a', 'node_modules'))
    }
  })

  it('skipDotEntries drops dot files AND dot directories', () => {
    const rels = relPaths({ skipDotEntries: true })
    expect(rels).not.toContain('.dotfile')
    expect(rels).not.toContain('.hidden-dir/inside.md')
    expect(rels).toContain('top.md')
  })

  it('ext filters files by suffix', () => {
    expect(relPaths({ ext: ['.md'] })).toEqual([
      '.hidden-dir/inside.md',
      'a/b/deep.md',
      'top.md',
    ])
    expect(relPaths({ ext: ['.md', '.json'] })).toContain('a/one.json')
  })

  it('does not follow or yield symlinks', () => {
    symlinkSync(join(root, 'a'), join(root, 'link-to-a'))
    symlinkSync(join(root, 'top.md'), join(root, 'link-to-top.md'))
    try {
      const rels = relPaths()
      expect(rels).not.toContain('link-to-a/one.json')
      expect(rels).not.toContain('link-to-top.md')
    } finally {
      rmSync(join(root, 'link-to-a'))
      rmSync(join(root, 'link-to-top.md'))
    }
  })
})
