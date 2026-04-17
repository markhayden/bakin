import { describe, it, expect, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-resolver-${Date.now()}`)
vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import {
  setFilename,
  unsetFilename,
  resolveFilename,
  filenameExists,
  clearResolver,
  listByFilename,
  listCollisions,
  resolverSize,
} from '@bakin/assets/lib/resolver'

describe('assets/resolver', () => {
  beforeEach(() => {
    clearResolver()
  })

  it('maps filename to path', () => {
    setFilename('hero.png', 'assets/images/task-1/hero.png')
    expect(resolveFilename('hero.png')).toBe('assets/images/task-1/hero.png')
  })

  it('returns null for unknown filename', () => {
    expect(resolveFilename('nope.png')).toBeNull()
  })

  it('overwrites when same filename re-upserted with same path', () => {
    setFilename('hero.png', 'assets/images/task-1/hero.png')
    setFilename('hero.png', 'assets/images/task-1/hero.png')
    expect(resolverSize()).toBe(1)
  })

  it('records collisions when same filename appears at two paths', () => {
    setFilename('hero.png', 'assets/images/task-1/hero.png')
    setFilename('hero.png', 'assets/research/task-2/hero.png')
    // Primary remains first-registered
    expect(resolveFilename('hero.png')).toBe('assets/images/task-1/hero.png')
    const collisions = listCollisions()
    expect(collisions).toHaveLength(1)
    expect(collisions[0].filename).toBe('hero.png')
    expect(collisions[0].alternates).toContain('assets/research/task-2/hero.png')
  })

  it('unsetFilename only removes when current path matches', () => {
    setFilename('hero.png', 'assets/images/task-1/hero.png')
    // Unset for a different path: should not remove
    unsetFilename('hero.png', 'assets/other/task/hero.png')
    expect(resolveFilename('hero.png')).toBe('assets/images/task-1/hero.png')
  })

  it('unsetFilename promotes a collision alternate when primary removed', () => {
    setFilename('hero.png', 'assets/images/task-1/hero.png')
    setFilename('hero.png', 'assets/research/task-2/hero.png')
    unsetFilename('hero.png', 'assets/images/task-1/hero.png')
    expect(resolveFilename('hero.png')).toBe('assets/research/task-2/hero.png')
    expect(listCollisions()).toHaveLength(0)
  })

  it('unsetFilename deletes entry entirely when no alternates', () => {
    setFilename('hero.png', 'assets/images/task-1/hero.png')
    unsetFilename('hero.png', 'assets/images/task-1/hero.png')
    expect(resolveFilename('hero.png')).toBeNull()
    expect(filenameExists('hero.png')).toBe(false)
  })

  it('filenameExists reports collisions even when primary was dropped', () => {
    setFilename('hero.png', 'assets/images/task-1/hero.png')
    setFilename('hero.png', 'assets/research/task-2/hero.png')
    expect(filenameExists('hero.png')).toBe(true)
  })

  it('listByFilename enumerates all mappings', () => {
    setFilename('a.png', 'assets/images/t/a.png')
    setFilename('b.png', 'assets/images/t/b.png')
    const list = listByFilename()
    expect(list).toHaveLength(2)
    expect(list.find(e => e.filename === 'a.png')?.path).toBe('assets/images/t/a.png')
  })

  it('clearResolver drops all state', () => {
    setFilename('hero.png', 'assets/images/task-1/hero.png')
    clearResolver()
    expect(resolverSize()).toBe(0)
    expect(listCollisions()).toHaveLength(0)
  })

  it('tolerates out-of-order add/unlink (add-before-unlink)', () => {
    // Simulate: retype moves old → new. Chokidar fires "add new" then "unlink old".
    setFilename('hero.png', 'assets/research/task-1/hero.png') // add new
    setFilename('hero.png', 'assets/text/task-1/hero.png')     // (old upserted last — still goes first in map)
    // With first-wins primary and collision tracking, hero.png still resolves.
    expect(filenameExists('hero.png')).toBe(true)
    unsetFilename('hero.png', 'assets/text/task-1/hero.png')   // unlink old
    expect(resolveFilename('hero.png')).toBe('assets/research/task-1/hero.png')
  })

  it('tolerates out-of-order add/unlink (unlink-before-add)', () => {
    // Initial state: file at the old path.
    setFilename('hero.png', 'assets/text/task-1/hero.png')
    // unlink of the old path arrives before add of the new path.
    unsetFilename('hero.png', 'assets/text/task-1/hero.png')
    expect(resolveFilename('hero.png')).toBeNull()
    // Then the add arrives.
    setFilename('hero.png', 'assets/research/task-1/hero.png')
    expect(resolveFilename('hero.png')).toBe('assets/research/task-1/hero.png')
  })
})
