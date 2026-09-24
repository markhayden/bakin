/**
 * `workflows.shipped-defaults` health check — turns "this build cannot see
 * its own shipped workflows" into an action-required incident with resolver
 * evidence, instead of a silently empty Workflows page.
 */
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-shipped-defaults-${Date.now()}-${Math.random().toString(16).slice(2)}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}))

import { setEmbeddedAssets } from '../../../packages/host/src/api/_embedded-assets'
import { pluginDefaultsKey } from '../../../src/core/plugin-resources'
import {
  checkShippedDefaults,
  getShippedDefaultsReceipt,
  recordShippedDefaults,
  resetShippedDefaults,
} from '../../../plugins/workflows/lib/shipped-defaults'

afterEach(() => {
  resetShippedDefaults()
  setEmbeddedAssets(new Map())
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

type Observed = { observations: Array<{ key: string; status: string; summary: string; evidence?: Record<string, unknown>; incident?: { disposition?: string; impact?: string; title?: string } }> }

describe('workflows.shipped-defaults', () => {
  it('is unknown (never healthy) before the plugin has activated', () => {
    const result = checkShippedDefaults() as unknown as Observed
    expect(result.observations).toHaveLength(1)
    expect(result.observations[0]?.status).toBe('unknown')
    expect(getShippedDefaultsReceipt()).toBeNull()
  })

  it('raises action_required when the build cannot locate any shipped workflow (the compiled-binary regression)', () => {
    recordShippedDefaults({ files: [], registered: [], skipped: [], pluginPath: '/$bunfs/root' })
    const result = checkShippedDefaults() as unknown as Observed
    const [obs] = result.observations
    expect(obs?.status).toBe('warning')
    expect(obs?.incident?.disposition).toBe('action_required')
    expect(obs?.incident?.title).toBe('Shipped workflow defaults are unavailable')
    expect(obs?.incident?.impact).toContain('no embedded copy')
    expect(obs?.evidence).toMatchObject({ source: 'embedded', embeddedEntries: 0, filesFound: 0, registered: 0 })
  })

  it('names disk as the source when a checkout plugin dir exists but ships nothing', () => {
    recordShippedDefaults({ files: [], registered: [], skipped: [], pluginPath: process.cwd() })
    const [obs] = (checkShippedDefaults() as unknown as Observed).observations
    expect(obs?.evidence).toMatchObject({ source: 'disk' })
    expect(obs?.incident?.impact).toContain('defaults/workflows/')
  })

  it('is healthy when every located shipped workflow registered, and says where they came from', () => {
    setEmbeddedAssets(new Map([[pluginDefaultsKey('workflows', 'workflows/a.yaml'), '/$bunfs/root/a.yaml']]))
    recordShippedDefaults({
      files: [{ id: 'a', path: '/$bunfs/root/a.yaml', source: 'embedded' }],
      registered: ['a'],
      skipped: [],
      pluginPath: '/$bunfs/root',
    })
    const [obs] = (checkShippedDefaults() as unknown as Observed).observations
    expect(obs?.status).toBe('healthy')
    expect(obs?.summary).toBe('1 shipped workflow(s) registered from the embedded copies.')
    expect(obs?.evidence).toMatchObject({ source: 'embedded', embeddedEntries: 1, filesFound: 1, registered: 1, skipped: 0 })
  })

  it('reports each shipped workflow that failed validation as a watch item', () => {
    recordShippedDefaults({
      files: [
        { id: 'good', path: '/x/good.yaml', source: 'disk' },
        { id: 'bad', path: '/x/bad.yaml', source: 'disk' },
      ],
      registered: ['good'],
      skipped: [{ id: 'bad', errors: ['steps: required'] }],
      pluginPath: process.cwd(),
    })
    const result = checkShippedDefaults() as unknown as Observed
    expect(result.observations).toHaveLength(1)
    expect(result.observations[0]?.key).toBe('shipped-default-bad')
    expect(result.observations[0]?.incident?.disposition).toBe('watch')
    expect(result.observations[0]?.summary).toContain('steps: required')
  })
})
