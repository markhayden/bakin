/**
 * Enrichment manifest writes (D8/T6): the manifest is the durable
 * enrichment record — done+forVersion is the skip guard, userEdited locks
 * fields against machine overwrites, old manifests parse unchanged.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-enrich-apply-${Date.now()}`)

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

import { createAsset, getAsset } from '@bakin/assets/lib/asset-core'
import { AssetManifestSchema } from '@bakin/assets/lib/manifest'
import {
  applyEnrichmentResult,
  applyUserEnrichmentEdit,
  markEnrichmentFailed,
  markEnrichmentPending,
  markEnrichmentSkipped,
} from '@bakin/assets/lib/enrichment/apply'

let assetId: string

beforeEach(async () => {
  mkdirSync(join(testDir, 'assets'), { recursive: true })
  const src = join(testDir, 'pic.png')
  writeFileSync(src, 'not-really-a-png')
  const created = await createAsset({ sourceFilePath: src, type: 'images', agent: 'user', op: 'upload', taskId: null, description: 'test pic' })
  assetId = created.assetId
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('enrichment apply', () => {
  it('machine result round-trips through the manifest with status/forVersion/model', async () => {
    await markEnrichmentPending(assetId)
    const updated = await applyEnrichmentResult(assetId, 1, 'anthropic/claude-haiku-4-5', {
      caption: 'a red square',
      ocrText: 'TOTAL $42',
      suggestedTags: ['red', 'square'],
    })
    expect(updated.enrichment?.status).toBe('done')
    expect(updated.enrichment?.forVersion).toBe(1)
    expect(updated.enrichment?.model).toBe('anthropic/claude-haiku-4-5')
    expect(getAsset(assetId)?.enrichment?.caption).toBe('a red square')
  })

  it('userEdited fields survive a machine re-run; machine fills only untouched fields', async () => {
    await applyEnrichmentResult(assetId, 1, 'm1', { caption: 'machine caption' })
    await applyUserEnrichmentEdit(assetId, { caption: 'MY caption' })

    const rerun = await applyEnrichmentResult(assetId, 1, 'm2', { caption: 'machine again', ocrText: 'found text' })
    expect(rerun.enrichment?.caption).toBe('MY caption')      // user wins
    expect(rerun.enrichment?.ocrText).toBe('found text')       // machine fills gaps
    expect(rerun.enrichment?.userEdited).toBe(true)            // lock persists
  })

  it('failed and skipped record the reason; pending clears the error', async () => {
    await markEnrichmentFailed(assetId, 'provider exploded')
    expect(getAsset(assetId)?.enrichment?.status).toBe('failed')
    expect(getAsset(assetId)?.enrichment?.error).toBe('provider exploded')

    await markEnrichmentSkipped(assetId, 'no audio-capable model configured')
    expect(getAsset(assetId)?.enrichment?.status).toBe('skipped')

    await markEnrichmentPending(assetId)
    expect(getAsset(assetId)?.enrichment?.status).toBe('pending')
    expect(getAsset(assetId)?.enrichment?.error).toBeUndefined()
  })

  it('manifests without enrichment parse unchanged (additive schema)', () => {
    const manifest = getAsset(assetId)!
    const { enrichment: _e, ...withoutEnrichment } = manifest
    expect(AssetManifestSchema.safeParse(withoutEnrichment).success).toBe(true)
  })
})
