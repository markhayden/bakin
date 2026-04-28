import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ScopedPluginStorageAdapter } from '../../packages/core/src/storage/scoped-plugin-storage'

describe('ScopedPluginStorageAdapter', () => {
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
