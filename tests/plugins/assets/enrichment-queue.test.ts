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

import { createAsset, getAsset, getAssetSummary } from '@bakin/assets/lib/asset-core'
import { addVersion } from '@bakin/assets/lib/asset-mutations'
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

  it('asset deleted mid-enrichment records a benign skip, not a failure', async () => {
    const { assetDirAbs } = await import('@bakin/assets/lib/asset-id')
    const assetId = await makeImageAsset()
    // Simulate the delete race: the asset vanishes while the billed call runs,
    // so the manifest write finds nothing.
    visionCall.mockImplementation(async () => {
      rmSync(assetDirAbs(assetId)!, { recursive: true, force: true })
      return { caption: 'gone', suggestedTags: [] }
    })
    const failedBefore = enrichmentQueueStats().failed
    const skippedBefore = enrichmentQueueStats().skipped
    enqueueEnrichment(assetId)
    await drainEnrichmentQueue()
    expect(enrichmentQueueStats().failed).toBe(failedBefore)
    expect(enrichmentQueueStats().skipped).toBe(skippedBefore + 1)
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

describe('enrichment activity notifications', () => {
  type Notified = { event: string; agent: string; detail: Record<string, unknown> }

  function captureActivity(settings: () => Record<string, unknown>, getRuntime?: () => any): Notified[] {
    const events: Notified[] = []
    initEnrichmentQueue(settings as never, {
      ...(getRuntime ? { getRuntime } : {}),
      onActivity: (event, agent, detail) => events.push({ event, agent, detail }),
    })
    return events
  }

  it('direct engine: started + enriched fire as system work with readable per-asset messages', async () => {
    const events = captureActivity(() => ({}))
    const assetId = await makeImageAsset()
    enqueueEnrichment(assetId)
    await drainEnrichmentQueue()

    const started = events.find((e) => e.event === 'asset.enrich_started')
    const enriched = events.find((e) => e.event === 'asset.enriched')
    expect(started?.agent).toBe('system')
    expect(String(started?.detail.message)).toContain(assetId)
    expect(enriched?.agent).toBe('system')
    expect(String(enriched?.detail.message)).toContain(assetId)
    expect(String(enriched?.detail.message)).toContain('a red square')
    expect(enriched?.detail.caption).toBe('a red square')
  })

  it('runtime engine: events are attributed to the enrich AGENT, not system', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const runtime = {
      capabilities: async () => ({
        toolCalling: { mode: 'native' as const, access: { style: 'cli-shim' as const } },
        delivery: { mode: 'native' as const },
        imageGen: { mode: 'unavailable' as const },
        memory: { mode: 'native' as const },
        sessions: { mode: 'native' as const },
        workspaceFiles: { mode: 'native' as const },
        concurrency: { sameAgentTurns: 'serialized' as const },
        input: { imageInput: true, audioInput: false },
      }),
      messaging: {
        send: async () => ({ id: 'm1', content: '{"caption":"a blue door","ocrText":"","suggestedTags":["blue-door"]}' }),
      },
    }
    const events = captureActivity(() => ({}), () => runtime)
    const assetId = await makeImageAsset()
    enqueueEnrichment(assetId)
    await drainEnrichmentQueue()

    const enriched = events.find((e) => e.event === 'asset.enriched')
    expect(enriched?.agent).toBe('enrich')
    expect(String(enriched?.detail.message)).toContain('a blue door')
  })

  it('summary.enrichment tracks the lifecycle: none → done → stale after a new version', async () => {
    initEnrichmentQueue(() => ({}))
    const assetId = await makeImageAsset()
    expect(getAssetSummary(assetId)?.enrichment).toBe('none')

    enqueueEnrichment(assetId)
    await drainEnrichmentQueue()
    expect(getAssetSummary(assetId)?.enrichment).toBe('done')

    const src = join(testDir, `pic-v2-${Date.now()}.png`)
    writeFileSync(src, 'png-bytes-v2')
    await addVersion(assetId, { sourceFilePath: src, op: 'upload' })
    expect(getAssetSummary(assetId)?.enrichment).toBe('stale')
  })

  it('failure notifies with the error in the message', async () => {
    visionCall.mockImplementation(async () => { throw new Error('provider down') })
    const events = captureActivity(() => ({}))
    const assetId = await makeImageAsset()
    enqueueEnrichment(assetId)
    await drainEnrichmentQueue()

    const failed = events.find((e) => e.event === 'asset.enrich_failed')
    expect(failed?.agent).toBe('system')
    expect(String(failed?.detail.message)).toContain(assetId)
    expect(String(failed?.detail.message)).toContain('provider down')
  })
})
