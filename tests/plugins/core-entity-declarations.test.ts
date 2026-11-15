/**
 * The linkable kinds the core plugins declare. Every link and conversation
 * card for these is built from the manifest declaration, so this table is the
 * contract: an href change here is a deep-link change.
 *
 * Pure scanner over the tracked manifests — imports no app module that
 * touches storage.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-core-entities-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { readPluginManifestJson } from '../../packages/core/src/plugins/manifest'

const EXPECTED: Record<string, string> = {
  'tasks:task': '/tasks?taskId={id}',
  'assets:asset': '/assets/{id}',
  'schedule:job': '/schedule?jobId={id}',
  'workflows:workflow': '/workflows/{id}',
  'brands:brand': '/brands/{id}',
  'brands:doc': '/brands/{brandId}/docs/{kind}/{name}',
  'chat:chat': '/chat/{id}',
  'team:agent': '/team/{id}',
}

describe('core plugin entity declarations', () => {
  const declared = new Map<string, { href: string; label: string; icon: string; handoff?: boolean }>()
  for (const pluginId of new Set(Object.keys(EXPECTED).map((id) => id.split(':')[0]!))) {
    const manifest = readPluginManifestJson(readFileSync(join(import.meta.dir, '../../plugins', pluginId, 'bakin-plugin.json'), 'utf8'))
    for (const entity of manifest.contributes?.entities ?? []) declared.set(`${pluginId}:${entity.kind}`, entity)
  }

  test('the core kinds and their page templates', () => {
    expect(Object.fromEntries([...declared].map(([id, entity]) => [id, entity.href]))).toEqual(EXPECTED)
  })

  test('no core kind accepts a hand-off (core only declares the mechanism)', () => {
    expect([...declared.values()].filter((entity) => entity.handoff)).toEqual([])
  })
})
