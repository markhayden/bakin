import { describe, expect, it, spyOn } from 'bun:test'
import * as fs from 'fs'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ScopedPluginStorageAdapter } from '../../packages/core/src/storage/scoped-plugin-storage'

describe('ScopedPluginStorageAdapter', () => {
  it('replaces a file without exposing partial content to an existing reader', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-plugin-storage-'))
    const storage = new ScopedPluginStorageAdapter(dir, 'sample')
    storage.write('project.md', 'original')
    const reader = fs.openSync(join(storage.root, 'project.md'), 'r')
    try {
      storage.write('project.md', 'replacement')
      expect(fs.readFileSync(reader, 'utf8')).toBe('original')
      expect(storage.read('project.md')).toBe('replacement')
      expect(storage.list()).toEqual(['project.md'])
    } finally {
      fs.closeSync(reader)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each(['write', 'rename'] as const)('preserves the previous file after a failed %s', (stage) => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-plugin-storage-'))
    const storage = new ScopedPluginStorageAdapter(dir, 'sample')
    storage.write('project.md', 'original')
    const write = fs.writeFileSync
    const failure = stage === 'write'
      ? spyOn(fs, 'writeFileSync').mockImplementation((path) => {
        write(path, 'partial')
        throw new Error('interrupted write')
      })
      : spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('interrupted rename') })
    try {
      expect(() => storage.write('project.md', 'replacement')).toThrow(`interrupted ${stage}`)
      expect(storage.read('project.md')).toBe('original')
      expect(storage.list()).toEqual(['project.md'])
    } finally {
      failure.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stores files under plugin-data/{pluginId}', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-plugin-storage-'))
    try {
      const storage = new ScopedPluginStorageAdapter(dir, 'sample')
      storage.write('nested/data.txt', 'hello')
      expect(storage.read('nested/data.txt')).toBe('hello')
      expect(existsSync(join(dir, 'plugin-data', 'sample', 'nested', 'data.txt'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('blocks absolute paths and parent traversal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-plugin-storage-'))
    try {
      const storage = new ScopedPluginStorageAdapter(dir, 'sample')
      expect(() => storage.write('/tmp/nope', 'x')).toThrow(/relative/)
      expect(() => storage.write('../nope', 'x')).toThrow(/escape/)
      expect(() => storage.read('nested/../../nope')).toThrow(/escape/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('supports list, stat, rename, remove, and JSON helpers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-plugin-storage-'))
    try {
      const storage = new ScopedPluginStorageAdapter(dir, 'sample')
      storage.writeJson('data/item.json', { ok: true })
      expect(storage.readJson<{ ok: boolean }>('data/item.json')).toEqual({ ok: true })
      expect(storage.list('data')).toEqual(['item.json'])
      expect(storage.stat('data/item.json')?.isFile).toBe(true)
      storage.rename('data/item.json', 'data/renamed.json')
      expect(storage.exists('data/item.json')).toBe(false)
      expect(storage.exists('data/renamed.json')).toBe(true)
      storage.remove('data')
      expect(storage.exists('data')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
