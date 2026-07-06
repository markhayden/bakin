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
 * Idempotency: each absorbed version carries `consolidatedFrom` provenance.
 * A re-run (mcporter timeout retry, double-click) skips already-absorbed
 * losers and NEVER touches the currentVersion pointer — a manual re-promote
 * between runs survives. Failures are typed per-loser, never thrown.
 *
 * Orchestration is check-then-act; each underlying mutation (addVersion,
 * promoteVersion, deleteAsset) takes the per-asset lock internally, and the
 * provenance check makes re-entry safe on this single-operator box.
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

export async function consolidateAssets(input: ConsolidateInput): Promise<ConsolidateResult> {
  const { winnerAssetId, loserAssetIds, taskId } = input
  const result: ConsolidateResult = { winnerAssetId, absorbed: [], skipped: [], failed: [] }

  const winnerDir = assetDirAbs(winnerAssetId)
  const winner = winnerDir ? readManifest(winnerDir) : null
  if (!winnerDir || !winner) {
    result.failed.push({ assetId: winnerAssetId, code: 'winner_not_found' })
    return result
  }

  // addVersion advances the pointer per absorb; the pre-run pointer is
  // restored afterwards. First run: that's the winner's original version.
  // Re-run: that's whatever the user promoted since — never clobbered.
  const pointerBefore = winner.currentVersion

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
    result.absorbed.push(loserId)
    await trashQuietly(loserId, taskId)
  }

  if (result.absorbed.length > 0) {
    await promoteVersion(winnerAssetId, pointerBefore)
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
