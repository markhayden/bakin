/**
 * consolidateAssets (#203 PR4): absorb variant assets as versions of a winner,
 * promote the winner's original version, soft-trash the losers. Idempotent via
 * consolidatedFrom provenance — re-runs are no-ops, partial re-runs absorb
 * only what's missing and never re-promote. Isolated to a temp BAKIN_HOME.
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-asset-consolidate-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import sharp from 'sharp'
import { createAsset, getAsset, promoteVersion } from '../../../plugins/assets/lib/asset-service'
import { consolidateAssets } from '../../../plugins/assets/lib/asset-consolidate'
import { listTrashedAssets } from '../../../plugins/assets/lib/asset-trash'

const srcDir = join(testDir, 'src')
const png = (name: string, r: number) =>
  sharp({ create: { width: 6, height: 6, channels: 3, background: { r, g: 0, b: 0 } } }).png().toFile(join(srcDir, name))

async function variant(slug: string, file: string) {
  return createAsset({
    sourceFilePath: join(srcDir, file),
    type: 'images',
    agent: 'pixel',
    taskId: 'task-consolidate',
    slug,
    op: 'generate',
    description: `variant ${slug}`,
    generation: { provider: 'openai', model: 'gpt-image-1-mini', surface: 'square', routeSource: 'recommended' },
  })
}

beforeAll(async () => {
  mkdirSync(srcDir, { recursive: true })
  await png('v0.png', 10)
  await png('v1.png', 120)
  await png('v2.png', 230)
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('consolidateAssets', () => {
  it('absorbs losers as versions, promotes the winner, and trashes the losers', async () => {
    const winner = await variant('win-a', 'v0.png')
    const loser1 = await variant('lose-a1', 'v1.png')
    const loser2 = await variant('lose-a2', 'v2.png')

    const result = await consolidateAssets({
      winnerAssetId: winner.assetId,
      loserAssetIds: [loser1.assetId, loser2.assetId],
      taskId: 'task-consolidate',
    })
    expect(result.absorbed).toEqual([loser1.assetId, loser2.assetId])
    expect(result.failed).toEqual([])

    const m = getAsset(winner.assetId)!
    expect(m.versions.map((v) => v.version)).toEqual([1, 2, 3])
    // Input order → version order; provenance names each absorbed loser.
    expect(m.versions[1].consolidatedFrom).toEqual({ assetId: loser1.assetId, version: 1 })
    expect(m.versions[2].consolidatedFrom).toEqual({ assetId: loser2.assetId, version: 1 })
    // The absorbed generation record travels with the version.
    expect(m.versions[1].generation?.model).toBe('gpt-image-1-mini')
    // Winner's ORIGINAL version stays current (addVersion advanced it; consolidate promotes back).
    expect(m.currentVersion).toBe(1)

    // Losers left the live list for the trash.
    expect(getAsset(loser1.assetId)).toBeNull()
    expect(getAsset(loser2.assetId)).toBeNull()
    const trashed = listTrashedAssets()
    expect(trashed.some((t) => t.assetId === loser1.assetId)).toBe(true)
  })

  it('is a no-op on full re-run (retry-safe), preserving a manual re-promote', async () => {
    const winner = await variant('win-b', 'v0.png')
    const loser = await variant('lose-b', 'v1.png')
    await consolidateAssets({ winnerAssetId: winner.assetId, loserAssetIds: [loser.assetId], taskId: 't' })

    // Operator re-promotes the absorbed variant manually...
    await promoteVersion(winner.assetId, 2)
    // ...then a retry of the same consolidate call arrives (e.g. mcporter timeout).
    const rerun = await consolidateAssets({ winnerAssetId: winner.assetId, loserAssetIds: [loser.assetId], taskId: 't' })
    expect(rerun.absorbed).toEqual([])
    expect(rerun.skipped).toEqual([loser.assetId])

    const m = getAsset(winner.assetId)!
    expect(m.versions).toHaveLength(2)
    // The manual promote survives — re-runs never touch the pointer.
    expect(m.currentVersion).toBe(2)
  })

  it('partial re-run absorbs only the missing loser and does not re-promote', async () => {
    const winner = await variant('win-c', 'v0.png')
    const loser1 = await variant('lose-c1', 'v1.png')
    const loser2 = await variant('lose-c2', 'v2.png')
    await consolidateAssets({ winnerAssetId: winner.assetId, loserAssetIds: [loser1.assetId], taskId: 't' })
    await promoteVersion(winner.assetId, 2)

    const result = await consolidateAssets({
      winnerAssetId: winner.assetId,
      loserAssetIds: [loser1.assetId, loser2.assetId],
      taskId: 't',
    })
    expect(result.skipped).toEqual([loser1.assetId])
    expect(result.absorbed).toEqual([loser2.assetId])

    const m = getAsset(winner.assetId)!
    expect(m.versions).toHaveLength(3)
    expect(m.currentVersion).toBe(2) // untouched on any re-run
  })

  it('reports a typed per-loser failure for missing assets instead of throwing', async () => {
    const winner = await variant('win-d', 'v0.png')
    const loser = await variant('lose-d', 'v1.png')
    const result = await consolidateAssets({
      winnerAssetId: winner.assetId,
      loserAssetIds: ['20260101-ghost-00000000', loser.assetId],
      taskId: 't',
    })
    expect(result.failed).toEqual([{ assetId: '20260101-ghost-00000000', code: 'loser_not_found' }])
    expect(result.absorbed).toEqual([loser.assetId])
    // The real loser still consolidated fine.
    expect(getAsset(winner.assetId)!.versions).toHaveLength(2)
  })

  it('rejects consolidating an asset into itself', async () => {
    const winner = await variant('win-e', 'v0.png')
    const result = await consolidateAssets({
      winnerAssetId: winner.assetId,
      loserAssetIds: [winner.assetId],
      taskId: 't',
    })
    expect(result.failed).toEqual([{ assetId: winner.assetId, code: 'self_reference' }])
    expect(getAsset(winner.assetId)!.versions).toHaveLength(1)
  })
})
