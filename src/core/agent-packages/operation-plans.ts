/**
 * The package flows' operation plans (#895, PLAN 4.2). Each plan's point of
 * no return is the flow's first live write (SPEC "Converted routes"): an
 * install's first projection, a removal's first deletion, a sync's first
 * requirement install or managed-block write. Everything before it — fetches,
 * manifest checks, conflict checks — is cancellable and leaves no trace.
 */
import type { OperationPlan } from '@makinbakin/sdk/types'

export const INSTALL_STAGES = {
  fetch: 'fetch',
  dependencies: 'dependencies',
  check: 'check',
  install: 'install',
  agent: 'agent',
  record: 'record',
} as const

/** Install: one item per package (dependencies first) plus every requirement leg, all in the `install` stage. */
export const PACKAGE_INSTALL_PLAN: OperationPlan = {
  stages: [
    { id: INSTALL_STAGES.fetch, kind: 'downloading', label: 'Fetch the package' },
    { id: INSTALL_STAGES.dependencies, kind: 'downloading', label: 'Fetch its dependencies' },
    { id: INSTALL_STAGES.check, kind: 'verifying', label: 'Check for conflicts' },
    { id: INSTALL_STAGES.install, kind: 'committing', label: 'Install files and requirements' },
    { id: INSTALL_STAGES.agent, kind: 'installing', label: 'Create the runtime agent' },
    { id: INSTALL_STAGES.record, kind: 'committing', label: 'Record the install' },
  ],
  pointOfNoReturn: INSTALL_STAGES.install,
}

export const REMOVE_STAGES = { check: 'check', remove: 'remove', record: 'record', agent: 'agent' } as const

/** Remove: the lockfile is written before the optional runtime-agent deletion (existing order). */
export const PACKAGE_REMOVE_PLAN: OperationPlan = {
  stages: [
    { id: REMOVE_STAGES.check, kind: 'preparing', label: 'Check what depends on it' },
    { id: REMOVE_STAGES.remove, kind: 'committing', label: 'Remove its files' },
    { id: REMOVE_STAGES.record, kind: 'committing', label: 'Record the removal' },
    { id: REMOVE_STAGES.agent, kind: 'cleanup', label: 'Delete the runtime agent' },
  ],
  pointOfNoReturn: REMOVE_STAGES.remove,
}

export const SYNC_STAGES = { fetch: 'fetch', install: 'install', verify: 'verify', check: 'check' } as const

/** Sync (agent or pack): fetch upstream → apply (requirements, projections, managed blocks) → verify. */
export const PACKAGE_SYNC_PLAN: OperationPlan = {
  stages: [
    { id: SYNC_STAGES.fetch, kind: 'downloading', label: 'Fetch upstream' },
    { id: SYNC_STAGES.install, kind: 'installing', label: 'Apply the package' },
    { id: SYNC_STAGES.verify, kind: 'verifying', label: 'Verify the result' },
  ],
  pointOfNoReturn: SYNC_STAGES.install,
}

/** `check: true` — report only, zero writes, cancellable throughout. */
export const PACKAGE_SYNC_CHECK_PLAN: OperationPlan = {
  stages: [
    { id: SYNC_STAGES.check, kind: 'verifying', label: 'Check upstream' },
    { id: SYNC_STAGES.verify, kind: 'verifying', label: 'Scan for drift' },
  ],
  pointOfNoReturn: null,
}

export const TEAM_SYNC_STAGE = 'sync'

/** Team-wide sync: one item per member. */
export function teamSyncPlan(check: boolean): OperationPlan {
  return {
    stages: [{ id: TEAM_SYNC_STAGE, kind: check ? 'verifying' : 'installing', label: check ? 'Check each member' : 'Sync each member' }],
    pointOfNoReturn: check ? null : TEAM_SYNC_STAGE,
  }
}

export const MIGRATION_STAGES = { scan: 'scan', backup: 'backup', migrate: 'migrate' } as const

/** Managed-block migration: nothing is written before `migrate` (the backup lands under `~/.bakin/.backups`). */
export const MIGRATION_PLAN: OperationPlan = {
  stages: [
    { id: MIGRATION_STAGES.scan, kind: 'preparing', label: 'Find legacy workspaces' },
    { id: MIGRATION_STAGES.backup, kind: 'preparing', label: 'Back up the workspaces' },
    { id: MIGRATION_STAGES.migrate, kind: 'committing', label: 'Migrate each agent' },
  ],
  pointOfNoReturn: MIGRATION_STAGES.migrate,
}

export const SKILL_STAGES = { fetch: 'fetch', verify: 'verify', map: 'map' } as const

const skillTrustStages = [
  { id: SKILL_STAGES.fetch, kind: 'downloading' as const, label: 'Fetch the skill and its hub verdict' },
  { id: SKILL_STAGES.verify, kind: 'verifying' as const, label: 'Check the manifest and scan the instructions' },
]

/** Hub-skill preview: the whole trust assessment, holding nothing, cancellable throughout. */
export const SKILL_PREVIEW_PLAN: OperationPlan = {
  stages: skillTrustStages,
  pointOfNoReturn: null,
}

/**
 * Hub-skill install: the trust gate (fails closed) re-runs inside the
 * operation BEFORE any mutation; placement is the point of no return.
 */
export const SKILL_INSTALL_PLAN: OperationPlan = {
  stages: [
    ...skillTrustStages,
    ...PACKAGE_INSTALL_PLAN.stages.filter((stage) => stage.id !== INSTALL_STAGES.fetch),
  ],
  pointOfNoReturn: INSTALL_STAGES.install,
}

/** Skill-map preview: one agent turn — slower than a download, so its stuck threshold is stretched. */
export const SKILL_MAP_PLAN: OperationPlan = {
  stages: [{ id: SKILL_STAGES.map, kind: 'verifying', label: 'Map the requirements', quiet: { quietMs: 30_000, stuckMs: 180_000 } }],
  pointOfNoReturn: null,
}
