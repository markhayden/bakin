/**
 * Plugin install and upgrade operation plans (#895, PLAN 4.3).
 *
 * Every plugin install or upgrade is preview → commit. A preview (no
 * `accepted`) fetches and checks only — it holds nothing, never writes outside
 * staging, and is cancellable throughout; it ends `awaiting_consent` or
 * `ready`. A commit (`accepted: true`) re-stages under install-state and runs
 * the replace transaction, whose journal-first rename is the point of no
 * return; placement and the build follow it in place.
 */
import type { OperationPlan } from '@makinbakin/sdk/types'
import { REPLACE_STAGES, replacePlanStages } from './replace-transaction'

export const PLUGIN_STAGES = { fetch: 'fetch', check: 'check', activate: 'activate' } as const

const fetchAndCheck = [
  { id: PLUGIN_STAGES.fetch, kind: 'downloading' as const, label: 'Fetch the plugin' },
  { id: PLUGIN_STAGES.check, kind: 'verifying' as const, label: 'Check permissions and binaries' },
]

export const PLUGIN_PREVIEW_PLAN: OperationPlan = {
  stages: fetchAndCheck,
  pointOfNoReturn: null,
}

export const PLUGIN_COMMIT_PLAN: OperationPlan = {
  stages: [
    ...fetchAndCheck,
    ...replacePlanStages(),
    { id: PLUGIN_STAGES.activate, kind: 'verifying', label: 'Activate the plugin' },
  ],
  pointOfNoReturn: REPLACE_STAGES.replace,
}

/** Outcome codes a preview ends with. */
export const PREVIEW_CODES = { awaitingConsent: 'awaiting_consent', ready: 'ready' } as const
