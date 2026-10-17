/**
 * Onboarding's recommended plugins over the converted install route (#895,
 * PLAN 4.3): the preview operation asks for consent, onboarding's approval
 * answers with the token, and the commit operation is awaited to its
 * terminal outcome before the component reports the plugin installed.
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-rec-plugins-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
const paths = () => ({ root: testDir, home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') })
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))
mock.module('../../../packages/host/src/plugin-host/user-plugin-builder', () => ({ buildUserPlugin: async () => {} }))

const source = join(testDir, 'catalog-src', 'notes')
const catalog = {
  version: 2,
  updatedAt: '2026-10-01',
  entries: [{
    id: 'notes', kind: 'plugin', name: 'Notes', description: 'Notes', category: 'productivity',
    tags: [], useCases: [], dependencies: [], screenshots: [], trust: 'official', builtin: false,
    defaultSelected: true, ref: null, runtimes: ['*'], source,
  }],
}
mock.module('../../../src/core/curated-catalog/load', () => ({
  loadUnifiedCatalog: async () => catalog,
  staticCuratedCatalog: () => catalog,
}))

import { recommendedPluginsComponent } from '../../../src/core/onboarding/recommended-plugins'
import { readPluginLockfile } from '../../../packages/core/src/plugins/lockfile'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../../src/core/operations'

afterAll(() => {
  _resetOperationRegistryForTests()
  rmSync(testDir, { recursive: true, force: true })
})
beforeEach(() => {
  _resetOperationRegistryForTests()
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'bakin-plugin.json'), JSON.stringify({
    id: 'notes', name: 'Notes', version: '1.0.0', bakin: '*', description: 'needs consent', permissions: ['storage.read'],
  }))
  writeFileSync(join(source, 'index.ts'), "export default { id: 'notes', activate() {} }")
})

describe('recommended plugins over operations', () => {
  it('preview asks for consent → approval commits with the token → installed once the commit settles', async () => {
    const result = await recommendedPluginsComponent.install({
      interactive: false, autoApprove: true, json: false, checkOnly: false, force: false,
    })

    expect(result.status).toBe('installed')
    expect(result.message).toContain('notes')
    expect(readPluginLockfile().plugins.notes?.permissions).toEqual(['storage.read'])
    expect(existsSync(join(testDir, 'plugins', 'notes', 'bakin-plugin.json'))).toBe(true)
    const ops = getOperationRegistry().list()
    const preview = ops.find((v) => v.kind === 'fetch')
    const commit = ops.find((v) => v.kind === 'install')
    expect(preview?.outcome?.code).toBe('awaiting_consent')
    expect(commit?.status).toBe('succeeded')
    expect(commit?.resources).toEqual(['install-state'])
  })
})
