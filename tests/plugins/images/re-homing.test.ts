/**
 * Re-homing table rows 191–193 (images.readiness): the Assets API gap folds
 * under the assets plugin, missing built-in profiles go to the fallback
 * lane, unconfigured providers are an observation.
 */
import { describe, expect, it, mock } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PluginContext } from '@bakin/core/plugin-types'

const testDir = join(tmpdir(), `bakin-test-images-rehoming-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { IMAGES_READINESS_INCIDENTS, checkImages } from '../../../plugins/images'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'

function ctx(canSave: boolean): PluginContext {
  return {
    assets: canSave ? { createAsset: async () => ({ assetId: 'a', version: 1 }) } : {},
    runtime: { capabilities: async () => ({ imageGen: { mode: 'unavailable' } }), images: { providers: async () => [] } },
  } as unknown as PluginContext
}
async function rows(canSave: boolean) {
  const parsed = parseHealthCheckRunInput(await checkImages(ctx(canSave)))
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

describe('images re-homing', () => {
  it('catalog: 191 and 192 are core.diagnose families; 193 is not a family', () => {
    expect(IMAGES_READINESS_INCIDENTS).toEqual([
      { id: 'assets-unavailable', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
      { id: 'profiles-missing', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
    ])
  })
  it('row 191 folds under plugin:assets; row 193 is an observation pointing at Integrations & Keys', async () => {
    const all = await rows(false)
    expect(all.find((r) => r.key === 'assets')!.incident).toMatchObject({
      declarationId: 'assets-unavailable',
      subject: { kind: 'plugin', id: 'images' },
      dependsOn: { subject: { kind: 'plugin', id: 'assets' }, resolvedBy: 'health.plugin-upgrade' },
      resolution: { type: 'repair', actionId: 'core.diagnose' },
    })
    const providers = all.find((r) => r.key === 'providers')!
    expect(providers.status).toBe('warning')
    expect(providers.incident).toBeUndefined()
    expect(providers.detail).toContain('/settings?tab=integrations')
    // Row 192 cannot be reached: the built-in profiles always register in-process.
    expect(all.find((r) => r.key === 'profiles')!.status).toBe('healthy')
  })
})
