/**
 * The conversation card an image tool attaches to its result.
 *
 * Pure helpers: no filesystem, no app services.
 */
import { describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-images-asset-card-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { imageCardTitle, withAssetCard } from '../../../plugins/images/lib/asset-card'
import { readPluginManifestJson } from '../../../packages/core/src/plugins/manifest'
import { readFileSync } from 'fs'

describe('withAssetCard', () => {
  test('a first version is a created asset', () => {
    expect(withAssetCard({ ok: true, assetId: 'a-1', version: 1 }, 'A red kite').entities)
      .toEqual([{ kind: 'assets:asset', id: 'a-1', title: 'A red kite', action: 'created' }])
  })

  test('a later version is an updated asset', () => {
    expect(withAssetCard({ ok: true, assetId: 'a-1', version: 3 }, 'Add a tail').entities?.[0]?.action).toBe('updated')
  })

  test('a failure, or a result naming no asset, passes through untouched', () => {
    const failed = { ok: false, error: 'budget' }
    expect(withAssetCard(failed, 'x')).toBe(failed)
    const routeOnly = { ok: true, provider: 'openai' }
    expect(withAssetCard(routeOnly, 'x')).toBe(routeOnly)
  })
})

describe('imageCardTitle', () => {
  test('uses the first line of the prompt, clipped', () => {
    expect(imageCardTitle('A red kite over a harbour\nwatercolour, soft light')).toBe('A red kite over a harbour')
    expect(imageCardTitle('x'.repeat(200))).toHaveLength(80)
  })

  test('falls back when there is no prompt text', () => {
    expect(imageCardTitle(undefined)).toBe('Image')
    expect(imageCardTitle('  ', 'logo.png')).toBe('logo.png')
  })
})

describe('images manifest', () => {
  test('the asset-producing tools declare assets:asset, through the assets dependency', () => {
    const manifest = readPluginManifestJson(readFileSync(join(import.meta.dir, '../../../plugins/images/bakin-plugin.json'), 'utf8'))
    const reports = Object.fromEntries((manifest.contributes?.execTools ?? []).map((tool) => [tool.name, tool.reports]))
    expect(manifest.dependencies).toContain('assets')
    for (const name of ['bakin_exec_images_generate', 'bakin_exec_images_edit', 'bakin_exec_images_import']) {
      expect(reports[name]).toEqual(['assets:asset'])
    }
  })
})
