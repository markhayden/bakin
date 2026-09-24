/**
 * plugin-resources — the ONE resolver for plugin `defaults/**` files.
 *
 * Pins the two-way switch (plugin root on disk → read disk; otherwise → read
 * the embedded copies), repo-root (never cwd) resolution of config-relative
 * plugin paths, and the non-URL key scheme that keeps embedded defaults out of
 * the static HTTP handler.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-plugin-resources-${Date.now()}-${Math.random().toString(16).slice(2)}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}))

import { setEmbeddedAssets } from '../../packages/host/src/api/_embedded-assets'
import {
  PLUGIN_DEFAULTS_KEY_PREFIX,
  RUNNING_FROM_BINARY,
  describePluginDefaults,
  listPluginDefaultFiles,
  listPluginDefaultFilesWithExtension,
  pluginDefaultsKey,
  pluginDefaultsSource,
  pluginRootFromModuleUrl,
  resolvePluginRoot,
  shippedWorkflowFiles,
} from '../../src/core/plugin-resources'

const REPO_ROOT = process.cwd()
const alphaRoot = join(testDir, 'plugins', 'alpha')

function seed(rel: string, content = 'id: x\n'): string {
  const full = join(testDir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  return full
}

beforeAll(() => {
  seed('plugins/alpha/defaults/workflows/b.yaml')
  seed('plugins/alpha/defaults/workflows/a.yml')
  seed('plugins/alpha/defaults/workflows/nested/c.yaml')
  seed('plugins/alpha/defaults/workflows/notes.txt', 'not a workflow')
  seed('plugins/alpha/defaults/workflows/a.yml.map', '{}')
  seed('plugins/alpha/defaults/runtime-skills/do-thing/SKILL.md', '# skill')
  seed('plugins/alpha/defaults/runtime-skills/do-thing/scripts/run.sh', 'echo hi')
  seed('plugins/empty/bakin-plugin.json', '{}')
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))
afterEach(() => setEmbeddedAssets(new Map()))

describe('key scheme', () => {
  it('embedded keys are never URL paths (no leading slash), so the static handler cannot serve them', () => {
    expect(PLUGIN_DEFAULTS_KEY_PREFIX.startsWith('/')).toBe(false)
    expect(pluginDefaultsKey('alpha', 'workflows/a.yaml')).toBe('plugin-defaults:alpha/workflows/a.yaml')
  })
})

describe('source switch', () => {
  it('a plugin root that exists on disk resolves from disk', () => {
    expect(pluginDefaultsSource(alphaRoot)).toBe('disk')
  })

  it('a plugin root that does not exist (the compiled-binary shape) resolves from the embedded copies', () => {
    expect(pluginDefaultsSource('/$bunfs/root')).toBe('embedded')
    expect(pluginDefaultsSource(join(testDir, 'plugins', 'missing'))).toBe('embedded')
    expect(pluginDefaultsSource(undefined)).toBe('embedded')
  })

  it('config-relative plugin paths resolve against the repo root, never process.cwd()', () => {
    const before = process.cwd()
    try {
      process.chdir(testDir)
      expect(resolvePluginRoot('plugins/workflows')).toBe(join(REPO_ROOT, 'plugins', 'workflows'))
      expect(pluginDefaultsSource('plugins/workflows')).toBe('disk')
    } finally {
      process.chdir(before)
    }
  })

  it('this test process is not a compiled binary', () => {
    expect(RUNNING_FROM_BINARY).toBe(false)
    expect(pluginRootFromModuleUrl(import.meta.url)).toBe(import.meta.dir)
  })
})

describe('disk listing', () => {
  it('walks defaults/<kind> recursively, skips source maps, sorts by relPath', () => {
    const files = listPluginDefaultFiles({ pluginId: 'alpha', pluginPath: alphaRoot, kind: 'workflows' })
    expect(files.map(f => f.relPath)).toEqual(['a.yml', 'b.yaml', 'nested/c.yaml', 'notes.txt'])
    expect(files.every(f => f.source === 'disk')).toBe(true)
    expect(files[0]?.path).toBe(join(alphaRoot, 'defaults', 'workflows', 'a.yml'))
  })

  it('a checkout plugin that ships no defaults yields nothing and does NOT fall through to embedded entries', () => {
    setEmbeddedAssets(new Map([[pluginDefaultsKey('empty', 'workflows/ghost.yaml'), seed('ghost.yaml')]]))
    expect(listPluginDefaultFiles({ pluginId: 'empty', pluginPath: join(testDir, 'plugins', 'empty'), kind: 'workflows' })).toEqual([])
  })

  it('filters by extension', () => {
    const yaml = listPluginDefaultFilesWithExtension({ pluginId: 'alpha', pluginPath: alphaRoot, kind: 'workflows' }, ['.yaml', '.yml'])
    expect(yaml.map(f => f.relPath)).toEqual(['a.yml', 'b.yaml', 'nested/c.yaml'])
  })

  it('shippedWorkflowFiles strips the extension for the id and ignores nested files', () => {
    expect(shippedWorkflowFiles('alpha', alphaRoot).map(f => f.id)).toEqual(['a', 'b'])
  })
})

describe('embedded listing', () => {
  it('reads plugin-defaults:<id>/<kind>/ keys when the plugin root is absent', () => {
    const a = seed('embedded/a.yaml', 'id: a\n')
    const skill = seed('embedded/SKILL.md', '# s')
    setEmbeddedAssets(new Map([
      [pluginDefaultsKey('alpha', 'workflows/a.yaml'), a],
      [pluginDefaultsKey('alpha', 'runtime-skills/do-thing/SKILL.md'), skill],
      [pluginDefaultsKey('beta', 'workflows/other.yaml'), a],
      ['/api/plugins/alpha/assets/client.js', a],
    ]))
    const files = listPluginDefaultFiles({ pluginId: 'alpha', pluginPath: '/$bunfs/root', kind: 'workflows' })
    expect(files).toEqual([{ relPath: 'a.yaml', path: a, source: 'embedded' }])
    expect(shippedWorkflowFiles('alpha', '/$bunfs/root')).toEqual([{ id: 'a', path: a, source: 'embedded' }])
    expect(listPluginDefaultFiles({ pluginId: 'alpha', kind: 'runtime-skills' }).map(f => f.relPath)).toEqual(['do-thing/SKILL.md'])
    expect(describePluginDefaults('alpha', '/$bunfs/root')).toEqual({ source: 'embedded', diskDefaultsDir: null, embeddedCount: 2 })
  })

  it('an empty embedded map means an empty result — the honest signal the health check reports on', () => {
    expect(listPluginDefaultFiles({ pluginId: 'alpha', pluginPath: '/$bunfs/root', kind: 'workflows' })).toEqual([])
    expect(describePluginDefaults('alpha', alphaRoot)).toEqual({ source: 'disk', diskDefaultsDir: join(alphaRoot, 'defaults'), embeddedCount: 0 })
  })
})
