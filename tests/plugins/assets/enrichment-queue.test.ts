/**
 * Enrichment queue (D8/T9): asset writes enqueue, the manifest's
 * done+forVersion is the durable skip guard, retries are bounded (billed),
 * missing capability records `skipped`, and nothing ever blocks a write.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-enrich-queue-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: () => () => {},
  registerUnlinkHook: () => () => {},
}))

// Partial-mock the media barrel: real registry/schemas, fake billed call.
const visionCall = mock(async () => ({ caption: 'a red square', suggestedTags: ['red'] }))
mock.module('@bakin/core/media', () => ({
  ...require('../../../packages/core/src/media/index'),
  callDirectVisionProvider: visionCall,
}))

import { createAsset } from '@bakin/assets/lib/asset-core'
import { getAsset } from '@bakin/assets/lib/asset-core'
import {
  drainEnrichmentQueue,
  enqueueEnrichment,
  enrichmentQueueStats,
  initEnrichmentQueue,
  stopEnrichmentQueue,
} from '@bakin/assets/lib/enrichment/queue'

const SAVED_KEY = process.env.ANTHROPIC_API_KEY

async function makeImageAsset(): Promise<string> {
  const src = join(testDir, `pic-${Date.now()}-${Math.random().toString(36).slice(2)}.png`)
  writeFileSync(src, 'png-bytes')
  const created = await createAsset({ sourceFilePath: src, type: 'images', agent: 'user', op: 'upload', taskId: null, description: 'a picture' })
  return created.assetId
}

beforeEach(() => {
  mkdirSync(join(testDir, 'assets'), { recursive: true })
  process.env.ANTHROPIC_API_KEY = 'sk-test'
  visionCall.mockClear()
  visionCall.mockImplementation(async () => ({ caption: 'a red square', suggestedTags: ['red'] }))
  initEnrichmentQueue(() => ({}))
})

afterEach(() => {
  stopEnrichmentQueue()
  if (SAVED_KEY === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = SAVED_KEY
  rmSync(testDir, { recursive: true, force: true })
})

describe('enrichment queue', () => {
  it('asset creation auto-enqueues via onAssetWritten; drain writes the manifest record', async () => {
    // createAsset emits the event; the plugin's activate() subscribes in prod.
    // Here we subscribe manually to keep the test at lib level.
    const { onAssetWritten } = await import('@bakin/assets/lib/asset-events')
    const unsubscribe = onAssetWritten(({ assetId }) => enqueueEnrichment(assetId))
    try {
      const assetId = await makeImageAsset()
      await drainEnrichmentQueue()
      const manifest = getAsset(assetId)
      expect(manifest?.enrichment?.status).toBe('done')
      expect(manifest?.enrichment?.caption).toBe('a red square')
      expect(manifest?.enrichment?.forVersion).toBe(1)
      expect(visionCall).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  it('done+forVersion is the durable skip guard; --force re-runs', async () => {
    const assetId = await makeImageAsset()
    enqueueEnrichment(assetId)
    await drainEnrichmentQueue()
    expect(visionCall).toHaveBeenCalledTimes(1)

    enqueueEnrichment(assetId)
    await drainEnrichmentQueue()
    expect(visionCall).toHaveBeenCalledTimes(1) // skipped — no second bill

    enqueueEnrichment(assetId, { force: true })
    await drainEnrichmentQueue()
    expect(visionCall).toHaveBeenCalledTimes(2)
  })

  it('bounded retries then failed (billed calls never retry forever)', async () => {
    visionCall.mockImplementation(async () => { throw new Error('provider down') })
    const assetId = await makeImageAsset()
    enqueueEnrichment(assetId)
    await drainEnrichmentQueue()
    expect(visionCall).toHaveBeenCalledTimes(2) // MAX_ATTEMPTS
    expect(getAsset(assetId)?.enrichment?.status).toBe('failed')
    expect(getAsset(assetId)?.enrichment?.error).toContain('provider down')
    expect(enrichmentQueueStats().failed).toBeGreaterThanOrEqual(1)
  })

  it('no configured vision model → skipped with reason, no call, no throw', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const assetId = await makeImageAsset()
    enqueueEnrichment(assetId)
    await drainEnrichmentQueue()
    expect(visionCall).not.toHaveBeenCalled()
    expect(getAsset(assetId)?.enrichment?.status).toBe('skipped')
    expect(getAsset(assetId)?.enrichment?.error).toContain('no vision-capable')
  })

  it('enrichmentEnabled:false short-circuits without touching the manifest', async () => {
    initEnrichmentQueue(() => ({ enrichmentEnabled: false }))
    const assetId = await makeImageAsset()
    enqueueEnrichment(assetId)
    await drainEnrichmentQueue()
    expect(visionCall).not.toHaveBeenCalled()
    expect(getAsset(assetId)?.enrichment).toBeUndefined()
  })
})
