import { describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PluginContext } from '@bakin/core/plugin-types'
import { checkImages } from '../../../plugins/images'

process.env.BAKIN_HOME = join(tmpdir(), `bakin-test-images-health-${randomUUID()}`)

function imageContext(options?: {
  imageMode?: 'native' | 'shimmed' | 'unavailable'
  canSave?: boolean
}): PluginContext {
  const imageMode = options?.imageMode ?? 'unavailable'
  return {
    assets: options?.canSave === false
      ? {}
      : { createAsset: async () => ({ assetId: 'asset-1', version: 1 }) },
    runtime: {
      capabilities: async () => ({ imageGen: { mode: imageMode } }),
      images: { providers: async () => [] },
    },
  } as unknown as PluginContext
}

function observations(result: Awaited<ReturnType<typeof checkImages>>) {
  if (result.outcome !== 'observed') throw new Error(`Expected observed Images health, got ${result.outcome}`)
  return result.observations
}

describe('Images health check', () => {
  it('reports storage and profile readiness while keeping an unavailable provider advisory', async () => {
    const result = observations(await checkImages(imageContext()))

    expect(result.map(observation => observation.key)).toEqual(['assets', 'profiles', 'providers'])
    expect(result.find(observation => observation.key === 'assets')?.status).toBe('healthy')
    expect(result.find(observation => observation.key === 'profiles')?.status).toBe('healthy')

    const providers = result.find(observation => observation.key === 'providers')
    expect(providers?.status).toBe('warning')
    // Row 193: an observation — the detail points at Integrations & Keys.
    expect(providers?.incident).toBeUndefined()
    expect(providers?.detail).toContain('/settings?tab=integrations')
  })

  it('makes a missing Assets save API actionable', async () => {
    const result = observations(await checkImages(imageContext({ canSave: false })))
    const assets = result.find(observation => observation.key === 'assets')

    expect(assets?.status).toBe('error')
    expect(assets?.incident?.disposition).toBe('action_required')
    // Row 191: a symptom of the assets plugin — folds under it; the fallback lane investigates if it survives.
    expect(assets?.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'core.diagnose' })
    expect(assets?.incident?.dependsOn).toEqual({ subject: { kind: 'plugin', id: 'assets', label: 'Assets' }, resolvedBy: 'health.plugin-upgrade' })
  })
})
