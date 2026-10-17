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

export const REMOVE_PLUGIN_STAGES = {
  uninstall: 'uninstall',
  snapshot: 'snapshot',
  deactivate: 'deactivate',
  delete: 'delete',
  record: 'record',
} as const

/** Remove: the plugin's own uninstall hook runs first, so nothing after the start can be undone. */
export const PLUGIN_REMOVE_PLAN: OperationPlan = {
  stages: [
    { id: REMOVE_PLUGIN_STAGES.uninstall, kind: 'cleanup', label: "Run the plugin's uninstall hook" },
    { id: REMOVE_PLUGIN_STAGES.snapshot, kind: 'preparing', label: 'Snapshot its data' },
    { id: REMOVE_PLUGIN_STAGES.deactivate, kind: 'cleanup', label: 'Deactivate it' },
    { id: REMOVE_PLUGIN_STAGES.delete, kind: 'cleanup', label: 'Delete its files, settings and skills' },
    { id: REMOVE_PLUGIN_STAGES.record, kind: 'committing', label: 'Record the removal and sweep binaries' },
  ],
  pointOfNoReturn: 'start',
}

export const RESTORE_STAGES = { extract: 'extract', place: 'place', activate: 'activate' } as const

/** Restore: unpack + checks are cancellable; the first delete (--force) or copy is the point of no return. */
export const PLUGIN_RESTORE_PLAN: OperationPlan = {
  stages: [
    { id: RESTORE_STAGES.extract, kind: 'extracting', label: 'Unpack and check the snapshot' },
    { id: RESTORE_STAGES.place, kind: 'committing', label: 'Restore files, settings and skills' },
    { id: RESTORE_STAGES.activate, kind: 'verifying', label: 'Activate the plugin' },
  ],
  pointOfNoReturn: RESTORE_STAGES.place,
}

export const LINK_STAGES = { check: 'check', link: 'link', activate: 'activate' } as const

/**
 * Link (and `install --dev`): only validation is cancellable — the point of
 * no return comes before --force's unlink of the prior entry, else before the
 * initial build writes into the source tree.
 */
export const PLUGIN_LINK_PLAN: OperationPlan = {
  stages: [
    { id: LINK_STAGES.check, kind: 'verifying', label: 'Check the source' },
    { id: LINK_STAGES.link, kind: 'building', label: 'Build and link the source' },
    { id: LINK_STAGES.activate, kind: 'verifying', label: 'Activate and watch it' },
  ],
  pointOfNoReturn: LINK_STAGES.link,
}
