import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { installFromPath, installFromGithub, removePlugin, listInstalled } from '../../src/core/plugin-installer'

describe('plugin-installer', () => {
  let tempDir: string
  let projectRoot: string
  let sourceDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-installer-test-'))
    projectRoot = join(tempDir, 'project')
    sourceDir = join(tempDir, 'source')
    mkdirSync(join(projectRoot, 'plugins'), { recursive: true })
    mkdirSync(sourceDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  /** Write a valid plugin source directory with manifest + entry file. */
  function writeSourcePlugin(
    id: string,
    opts: { entry?: string; missingField?: string; missingEntry?: boolean; invalidJson?: boolean } = {},
  ) {
    const dir = join(sourceDir, id)
    mkdirSync(dir, { recursive: true })

    if (opts.invalidJson) {
      writeFileSync(join(dir, 'bakin-plugin.json'), '{ broken json')
      return dir
    }

    const manifest: Record<string, unknown> = {
      id,
      name: `Plugin ${id}`,
      version: '1.0.0',
      description: `Test plugin ${id}`,
      bakin: '>=1.0.0',
      entry: { server: opts.entry || 'index.js' },
    }

    if (opts.missingField) {
      delete manifest[opts.missingField]
    }

    writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify(manifest))

    if (!opts.missingEntry) {
      writeFileSync(join(dir, opts.entry || 'index.js'), 'module.exports = {}')
    }

    return dir
  }

  // -------------------------------------------------------------------------
  // validateManifest (tested via installFromPath)
  // -------------------------------------------------------------------------

  describe('installFromPath', () => {
    it('installs a valid plugin', async () => {
      const src = writeSourcePlugin('my-addon')
      const result = await installFromPath(src, projectRoot)

      expect(result.ok).toBe(true)
      expect(result.pluginId).toBe('my-addon')
      expect(existsSync(join(projectRoot, 'plugins', 'my-addon', 'index.js'))).toBe(true)
      expect(existsSync(join(projectRoot, 'plugins', 'my-addon', 'bakin-plugin.json'))).toBe(true)
    })

    it('rejects when no manifest exists', async () => {
      const dir = join(sourceDir, 'no-manifest')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.js'), 'module.exports = {}')

      const result = await installFromPath(dir, projectRoot)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('No bakin-plugin.json found')
    })

    it('rejects invalid JSON in manifest', async () => {
      const src = writeSourcePlugin('bad-json', { invalidJson: true })
      const result = await installFromPath(src, projectRoot)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Invalid manifest JSON')
    })

    it('rejects manifest missing required field "id"', async () => {
      const src = writeSourcePlugin('no-id', { missingField: 'id' })
      const result = await installFromPath(src, projectRoot)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Missing required field: id')
    })

    it('rejects manifest missing required field "entry"', async () => {
      const src = writeSourcePlugin('no-entry', { missingField: 'entry' })
      const result = await installFromPath(src, projectRoot)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Missing required field: entry')
    })

    it('rejects when entry.server file does not exist and cleans up', async () => {
      const src = writeSourcePlugin('missing-entry', { missingEntry: true })
      const result = await installFromPath(src, projectRoot)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Entry file not found')
      // Should have cleaned up the copied directory
      expect(existsSync(join(projectRoot, 'plugins', 'missing-entry'))).toBe(false)
    })

    it('rejects when plugin already exists', async () => {
      const src = writeSourcePlugin('dupe')
      // Pre-install
      mkdirSync(join(projectRoot, 'plugins', 'dupe'), { recursive: true })

      const result = await installFromPath(src, projectRoot)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('already installed')
    })

    it('updates mc.config.ts when it exists', async () => {
      const configPath = join(projectRoot, 'mc.config.ts')
      writeFileSync(configPath, `export default {
  plugins: [
    { path: 'plugins/tasks' },
  ],
  theme: {}
}`)

      const src = writeSourcePlugin('my-addon')
      await installFromPath(src, projectRoot)

      const config = readFileSync(configPath, 'utf-8')
      expect(config).toContain("{ path: 'plugins/my-addon' }")
    })

    it('succeeds even if mc.config.ts does not exist', async () => {
      const src = writeSourcePlugin('my-addon')
      const result = await installFromPath(src, projectRoot)
      expect(result.ok).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // installFromGithub
  // -------------------------------------------------------------------------

  describe('installFromGithub', () => {
    it('returns error when git clone fails', async () => {
      const result = await installFromGithub('nonexistent/repo-that-does-not-exist-xyz', projectRoot)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Git clone failed')
    })
  })

  // -------------------------------------------------------------------------
  // removePlugin
  // -------------------------------------------------------------------------

  describe('removePlugin', () => {
    it('removes an installed plugin directory', async () => {
      // Install first
      const src = writeSourcePlugin('removable')
      await installFromPath(src, projectRoot)
      expect(existsSync(join(projectRoot, 'plugins', 'removable'))).toBe(true)

      const result = removePlugin('removable', projectRoot)
      expect(result.ok).toBe(true)
      expect(result.pluginId).toBe('removable')
      expect(existsSync(join(projectRoot, 'plugins', 'removable'))).toBe(false)
    })

    it('returns error when plugin not found', () => {
      const result = removePlugin('nonexistent', projectRoot)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('removes entry from mc.config.ts', async () => {
      const configPath = join(projectRoot, 'mc.config.ts')
      writeFileSync(configPath, `export default {
  plugins: [
    { path: 'plugins/tasks' },
    { path: 'plugins/removable' },
  ],
}`)

      // Create the plugin dir so removePlugin finds it
      const src = writeSourcePlugin('removable')
      await installFromPath(src, projectRoot)

      removePlugin('removable', projectRoot)
      const config = readFileSync(configPath, 'utf-8')
      expect(config).not.toContain('plugins/removable')
      expect(config).toContain('plugins/tasks')
    })
  })

  // -------------------------------------------------------------------------
  // listInstalled
  // -------------------------------------------------------------------------

  describe('listInstalled', () => {
    it('returns empty array when no plugins directory exists', () => {
      const emptyRoot = join(tempDir, 'empty')
      mkdirSync(emptyRoot)
      expect(listInstalled(emptyRoot)).toEqual([])
    })

    it('returns empty array when plugins directory is empty', () => {
      expect(listInstalled(projectRoot)).toEqual([])
    })

    it('lists installed plugins with manifest data', async () => {
      const src1 = writeSourcePlugin('alpha')
      const src2 = writeSourcePlugin('bravo')
      await installFromPath(src1, projectRoot)
      await installFromPath(src2, projectRoot)

      const list = listInstalled(projectRoot)
      expect(list).toHaveLength(2)
      const ids = list.map((m) => m.id)
      expect(ids).toContain('alpha')
      expect(ids).toContain('bravo')
    })

    it('skips directories without manifests', () => {
      mkdirSync(join(projectRoot, 'plugins', 'no-manifest'))
      writeFileSync(join(projectRoot, 'plugins', 'no-manifest', 'index.js'), '')

      expect(listInstalled(projectRoot)).toEqual([])
    })

    it('skips directories with invalid manifest JSON', () => {
      const dir = join(projectRoot, 'plugins', 'bad-json')
      mkdirSync(dir)
      writeFileSync(join(dir, 'bakin-plugin.json'), '{ broken')

      expect(listInstalled(projectRoot)).toEqual([])
    })
  })
})
