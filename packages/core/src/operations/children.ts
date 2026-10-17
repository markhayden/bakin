/**
 * Parent outcome precedence (#895 D10, D21, D22). A parent with children (a
 * repair apply) settles from its children's outcomes and its own
 * verification — first match wins, and the per-child rows are always kept
 * by the caller:
 *
 *   1. cancelled and no child applied anything          → cancelled / cancelled
 *   2. some children applied, others failed or cancelled → failed / partially_applied
 *   3. nothing applied, some child failed or was cancelled → failed / apply_failed
 *   4. every child skipped (nothing needed)             → succeeded / nothing_applied
 *   5. applied, verification failed                     → failed / verification_failed
 *   6. applied, verified                                → succeeded / ok
 *
 * A child that found nothing to do finishes `succeeded` with the code
 * `CHILD_SKIPPED_CODE`; any other success counts as applied. A child that
 * failed with `CHILD_PARTIAL_CODE` changed something before it failed, so it
 * counts as both applied and failed.
 */
import type { OperationView } from '@makinbakin/sdk/types'

export const CHILD_SKIPPED_CODE = 'skipped'
export const CHILD_PARTIAL_CODE = 'partially_applied'

export type ParentOutcomeCode = 'cancelled' | 'partially_applied' | 'apply_failed' | 'nothing_applied' | 'verification_failed' | 'ok'

export interface ParentOutcome {
  status: 'succeeded' | 'failed' | 'cancelled'
  code: ParentOutcomeCode
}

export interface ChildTally {
  applied: number
  skipped: number
  failed: number
  cancelled: number
}

/** Counts settled children by how they ended. Unsettled children count as neither. */
export function tallyChildren(children: ReadonlyArray<Pick<OperationView, 'status' | 'outcome'>>): ChildTally {
  const tally: ChildTally = { applied: 0, skipped: 0, failed: 0, cancelled: 0 }
  for (const child of children) {
    if (child.status === 'succeeded') {
      if (child.outcome?.code === CHILD_SKIPPED_CODE) tally.skipped++
      else tally.applied++
    } else if (child.status === 'failed') {
      tally.failed++
      if (child.outcome?.code === CHILD_PARTIAL_CODE) tally.applied++
    }
    else if (child.status === 'cancelled') tally.cancelled++
  }
  return tally
}

/**
 * `cancelled`: the parent itself was cancelled. `verified`: the parent's own
 * verification result, or null when it did not run (treated as passing).
 */
export function parentOutcome(tally: ChildTally, opts: { cancelled: boolean; verified: boolean | null }): ParentOutcome {
  if (opts.cancelled && tally.applied === 0) return { status: 'cancelled', code: 'cancelled' }
  if (tally.applied > 0 && (tally.failed > 0 || tally.cancelled > 0)) return { status: 'failed', code: 'partially_applied' }
  if (tally.applied === 0 && (tally.failed > 0 || tally.cancelled > 0)) return { status: 'failed', code: 'apply_failed' }
  if (tally.applied === 0) return { status: 'succeeded', code: 'nothing_applied' }
  if (opts.verified === false) return { status: 'failed', code: 'verification_failed' }
  return { status: 'succeeded', code: 'ok' }
}
