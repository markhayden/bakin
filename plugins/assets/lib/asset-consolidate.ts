/**
 * Asset consolidation (#203): absorb variant assets as versions of a winner.
 *
 * Built for select-best flows (e.g. the image-multi-select workflow): N
 * variants are generated as separate assets (concurrent children cannot share
 * a versionOf target), then the winner absorbs the losers' current files as
 * new versions, the winner's ORIGINAL version is promoted back to current,
 * and the losers are soft-trashed. End state: one asset in the live list,
 * every variant preserved as version history, current = winner.
 *
 * Idempotency & crash safety:
 * - Each absorbed version carries `consolidatedFrom` provenance; a re-run
 *   (client timeout retry, double-click) skips already-absorbed losers.
 * - Pointer semantics: consolidation NEVER changes which version is current.
 *   Each absorb captures the pointer immediately before its addVersion and
 *   restores it immediately after — so the pre-existing pointer always
 *   survives, whether that's the winner's original (normal flow) or a
 *   deliberately re-promoted absorbed variant (the selection-gate re-select
 *   flow). Under per-winner serialization the wrong-pointer crash window is
 *   the single addVersion→promote gap.
 * - Concurrent invocations for the same winner are serialized in-process
 *   (single-server box) so the check-then-act absorb loop cannot double-add
 *   a loser when a client-side timeout triggers an overlapping retry.
 * - Failures are typed per-loser, never thrown; only a winner-side failure
 *   (winner_not_found) is fatal to the operation as a whole.
 */
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { assetDirAbs } from './asset-id'
import { readManifest } from './manifest'
import { addVersion } from './asset-mutations'
import { promoteVersion } from './asset-mutations'
import { deleteAsset } from './asset-trash'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('asset-service')

export interface ConsolidateInput {
  winnerAssetId: string
  loserAssetIds: string[]
  taskId: string
}

export type ConsolidateFailureCode = 'winner_not_found' | 'loser_not_found' | 'self_reference'

export interface ConsolidateResult {
  winnerAssetId: string
  /** Losers absorbed as new versions on this run, in input order. */
  absorbed: string[]
  /** Losers already absorbed by a prior run (no-op, still ensured trashed). */
  skipped: string[]
  failed: Array<{ assetId: string; code: ConsolidateFailureCode }>
  /** The currentVersion after this run. */
  currentVersion?: number
}

// Per-winner in-process serialization (see header). Entries are removed once
// the chain drains so the map cannot grow unbounded.
const consolidateChains = new Map<string, Promise<unknown>>()

export async function consolidateAssets(input: ConsolidateInput): Promise<ConsolidateResult> {
  const prior = consolidateChains.get(input.winnerAssetId) ?? Promise.resolve()
  const run = prior.then(() => consolidateSerialized(input), () => consolidateSerialized(input))
  consolidateChains.set(input.winnerAssetId, run)
  try {
    return await run
  } finally {
    if (consolidateChains.get(input.winnerAssetId) === run) consolidateChains.delete(input.winnerAssetId)
  }
}

async function consolidateSerialized(input: ConsolidateInput): Promise<ConsolidateResult> {
  const { winnerAssetId, loserAssetIds, taskId } = input
  const result: ConsolidateResult = { winnerAssetId, absorbed: [], skipped: [], failed: [] }

  const winnerDir = assetDirAbs(winnerAssetId)
  const winner = winnerDir ? readManifest(winnerDir) : null
  if (!winnerDir || !winner) {
    result.failed.push({ assetId: winnerAssetId, code: 'winner_not_found' })
    return result
  }

  for (const loserId of loserAssetIds) {
    if (loserId === winnerAssetId) {
      result.failed.push({ assetId: loserId, code: 'self_reference' })
      continue
    }

    const currentWinner = readManifest(winnerDir)
    const alreadyAbsorbed = currentWinner?.versions.some((v) => v.consolidatedFrom?.assetId === loserId)

    const loserDir = assetDirAbs(loserId)
    const loser = loserDir && existsSync(loserDir) ? readManifest(loserDir) : null

    if (alreadyAbsorbed) {
      result.skipped.push(loserId)
      // Still ensure the loser leaves the live list (a prior run may have
      // died between absorb and trash).
      if (loser) await trashQuietly(loserId, taskId)
      continue
    }

    if (!loser || !loserDir) {
      result.failed.push({ assetId: loserId, code: 'loser_not_found' })
      continue
    }

    const loserCurrent = loser.versions.find((v) => v.version === loser.currentVersion)
    if (!loserCurrent) {
      result.failed.push({ assetId: loserId, code: 'loser_not_found' })
      continue
    }

    // Capture the pointer THIS absorb is about to move, restore it right
    // after — the pre-existing pointer (original or a deliberate re-select)
    // always survives consolidation.
    const pointerBeforeAbsorb = currentWinner?.currentVersion ?? winner.currentVersion
    await addVersion(winnerAssetId, {
      sourceFilePath: join(loserDir, loserCurrent.file),
      op: 'import',
      tool: 'consolidate',
      description: loserCurrent.description,
      prompt: loserCurrent.prompt,
      promptHash: loserCurrent.promptHash,
      generation: loserCurrent.generation,
      consolidatedFrom: { assetId: loserId, version: loserCurrent.version },
    })
    await promoteVersion(winnerAssetId, pointerBeforeAbsorb)
    result.absorbed.push(loserId)
    await trashQuietly(loserId, taskId)
  }

  result.currentVersion = readManifest(winnerDir)?.currentVersion
  return result
}

async function trashQuietly(assetId: string, taskId: string): Promise<void> {
  try {
    await deleteAsset(assetId)
  } catch (err) {
    log.warn('Consolidate could not trash loser asset', err, { assetId, taskId })
  }
}
