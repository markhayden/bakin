/** Canonical Schedule health checks and explicit repair actions. */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { repairTargetSelection } from '@bakin/core/health/repair-support'

import { createLogger } from '../../../src/core/logger'
import type {
  HealthCheckRunInput,
  HealthObservationInput,
  HealthRepairActionDefinition,
} from '../../../packages/core/src/plugin-types'
import {
  healthError,
  healthHealthy,
  healthNotApplicable,
  healthObserved,
  healthUnknown,
  healthWarning,
} from '@makinbakin/sdk/utils'
import type { BakinJobMeta } from '../types'
import { isTaskPrompt, NOT_A_PROMPT_REASON } from './prompt-guard'
import { getJob, getSidecarPath, readSidecar, removeJob, upsertJob } from './sidecar'

const log = createLogger('schedule:health')
type RuntimeCronReader = Pick<NonNullable<AgentRuntimeAdapter['cron']>, 'list'>

interface RuntimeJob {
  id: string
  name: string
  command: string
}

function stablePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'unknown'
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/**
 * Runtime crons absent from the sidecar split by what they are (spec D5):
 * `orphans` carry a task prompt and deserve triage; `runtimeInternal` are the
 * runtime's own markers (no prompt) — they stay native, nothing to track.
 */
async function orphanRuntimeJobs(cron: RuntimeCronReader): Promise<{ jobs: RuntimeJob[]; orphans: RuntimeJob[]; runtimeInternal: RuntimeJob[] }> {
  const jobs = (await cron.list()).map(job => ({ id: job.id, name: job.name || job.id, command: job.command ?? '' }))
  const sidecar = readSidecar()
  const untracked = jobs.filter(job => !sidecar.jobs[job.id])
  return {
    jobs,
    orphans: untracked.filter(job => isTaskPrompt(job.command)),
    runtimeInternal: untracked.filter(job => !isTaskPrompt(job.command)),
  }
}

/** Detect runtime cron jobs that are visible to Bakin but absent from its sidecar. */
export async function checkScheduleSync(
  cron: RuntimeCronReader | undefined,
): Promise<HealthCheckRunInput> {
  if (!cron) return healthNotApplicable('The active runtime has no native cron surface to synchronize.')

  let scan: Awaited<ReturnType<typeof orphanRuntimeJobs>>
  try {
    scan = await orphanRuntimeJobs(cron)
  } catch (error) {
    // Static summary, error in detail: a long runtime error interpolated
    // into summary blew the 500-char contract bound and invalidated the
    // whole run (2026-07-22 field diagnosis). Builders clamp now, but the
    // error belongs in detail regardless.
    return healthObserved([healthUnknown({
      key: 'runtime-cron',
      summary: 'Runtime cron jobs could not be read.',
      detail: (error instanceof Error ? error.message : String(error)) || undefined,
      incident: {
        key: 'runtime-cron',
        title: 'Schedule synchronization could not be verified',
        impact: 'Bakin cannot determine whether runtime cron jobs are tracked in its schedule sidecar.',
        disposition: 'watch',
        resources: [{ kind: 'runtime', id: 'cron', label: 'Runtime cron' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun check' },
      },
    })])
  }

  if (scan.jobs.length === 0) {
    return healthObserved([healthHealthy({ key: 'runtime-cron', summary: 'No runtime cron jobs require synchronization.' })])
  }
  // Runtime-internal markers are honest, healthy evidence — never an orphan,
  // never something the Track repair would copy into Bakin.
  const internal: HealthObservationInput[] = scan.runtimeInternal.length > 0
    ? [healthHealthy({
        key: 'runtime-internal',
        summary: `${scan.runtimeInternal.length} runtime-internal cron job(s) stay native — their commands are not task prompts.`,
        detail: bounded(scan.runtimeInternal.map(job => `${job.name} (${job.id})`).join('; '), 1_000),
        evidence: { jobs: scan.runtimeInternal.slice(0, 50).map(job => ({ id: job.id, name: job.name })) },
      })]
    : []
  if (scan.orphans.length === 0) {
    return healthObserved([healthHealthy({
      key: 'runtime-cron',
      summary: `${scan.jobs.length - scan.runtimeInternal.length} runtime cron job(s) are tracked in the Bakin sidecar.`,
      evidence: { count: scan.jobs.length, runtimeInternal: scan.runtimeInternal.length },
    }), ...internal] as [HealthObservationInput, ...HealthObservationInput[]])
  }

  const observations: HealthObservationInput[] = scan.orphans.map(orphan => healthWarning({
    key: `orphan-${stablePart(orphan.id)}`,
    summary: bounded(`Runtime cron job ${orphan.name} (${orphan.id}) is not tracked in the Bakin sidecar.`, 500),
    evidence: { jobId: orphan.id, name: orphan.name },
    incident: {
      key: `orphan-${stablePart(orphan.id)}`,
      title: bounded(`Runtime cron job ${orphan.name} needs triage`, 120),
      impact: 'The job is not visible in Bakin schedule ownership and may run without operator context.',
      disposition: 'action_required' as const,
      resources: [{ kind: 'schedule' as const, id: stablePart(orphan.id), label: bounded(orphan.name, 120) }],
      resolution: { key: 'track-runtime-cron', type: 'repair' as const, label: 'Track for triage', actionId: 'track-runtime-cron' },
    },
  }))
  return healthObserved([...observations, ...internal] as [HealthObservationInput, ...HealthObservationInput[]])
}

/** Detect Bakin-owned schedules that still have a backing runtime cron job. */
export async function checkScheduleCutover(
  cron: RuntimeCronReader | undefined,
  bakinJobIds: () => string[],
  runtimeName?: string,
): Promise<HealthCheckRunInput> {
  if (!cron) return healthNotApplicable('The active runtime has no native cron surface; Bakin schedules are cut over by construction.')

  let runtimeIds: Set<string>
  try {
    runtimeIds = new Set((await cron.list()).map(job => job.id))
  } catch (error) {
    return healthObserved([healthUnknown({
      key: 'cutover-verification',
      summary: 'Runtime cron could not be read.',
      detail: (error instanceof Error ? error.message : String(error)) || undefined,
      incident: {
        key: 'cutover-verification',
        title: 'Schedule cutover could not be verified',
        impact: 'Bakin cannot confirm that duplicate runtime cron fire paths are absent.',
        disposition: 'watch',
        resources: [{ kind: 'runtime', id: 'cron', label: `${runtimeName ?? 'Runtime'} cron` }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun check' },
      },
    })])
  }

  const lingering = bakinJobIds().filter(id => runtimeIds.has(id))
  if (lingering.length === 0) {
    return healthObserved([healthHealthy({
      key: 'cutover',
      summary: `All Bakin schedules are cut over from ${runtimeName ?? 'runtime'} cron.`,
    })])
  }
  return healthObserved(lingering.map(id => healthError({
    key: `lingering-${stablePart(id)}`,
    summary: bounded(`Bakin schedule ${id} still has a ${runtimeName ?? 'runtime'} cron job.`, 500),
    evidence: { jobId: id, runtime: runtimeName ?? 'runtime' },
    incident: {
      key: `lingering-${stablePart(id)}`,
      title: bounded(`Schedule ${id} has two possible fire paths`, 120),
      impact: 'The lingering runtime cron can rogue-fire and execute the schedule twice.',
      disposition: 'action_required',
      resources: [{ kind: 'schedule', id: stablePart(id), label: bounded(id, 120) }],
      resolution: { key: 'complete-cutover', type: 'repair', label: 'Complete cutover', actionId: 'complete-cutover' },
    },
  })) as [HealthObservationInput, ...HealthObservationInput[]])
}

/** Complete the existing migration that imports schedule expressions and removes backing runtime cron jobs. */
export function scheduleCutoverRepair(
  runMigration: () => Promise<{ migrated: number; failed: number }>,
): HealthRepairActionDefinition {
  return {
    id: 'complete-cutover',
    name: 'Complete schedule cutover',
    async plan() {
      return [{
        id: 'complete-cutover',
        actionId: 'complete-cutover',
        title: 'Complete schedule cutover from runtime cron',
        reason: 'One or more Bakin schedules still have a backing runtime cron job.',
        safety: 'destructive',
        incidentIds: [],
        observationIds: [],
        preconditions: [],
        changes: [{
          kind: 'runtime',
          target: 'runtime cron jobs',
          action: 'delete',
          description: 'Import each schedule expression into Bakin and remove its backing runtime cron job.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      try {
        const summary = await runMigration()
        return items.map(item => ({
          itemId: item.id,
          actionId: item.actionId,
          status: summary.failed > 0 ? 'failed' as const : 'applied' as const,
          message: `Migrated ${summary.migrated} schedule(s) off runtime cron${summary.failed > 0 ? `; ${summary.failed} failed` : ''}.`,
          affectedCheckIds: ['schedule.schedule-cutover'],
          changes: summary.migrated > 0 ? item.changes : [],
        }))
      } catch (error) {
        return items.map(item => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: error instanceof Error ? error.message : String(error),
          affectedCheckIds: ['schedule.schedule-cutover'],
          changes: [],
        }))
      }
    },
  }
}

/** Add unowned runtime cron jobs to the sidecar without guessing an agent assignment. */
export function scheduleSyncRepair(
  cron: RuntimeCronReader,
  resolveDefaultOwner: () => Promise<string>,
): HealthRepairActionDefinition {
  return {
    id: 'track-runtime-cron',
    name: 'Track runtime cron jobs for triage',
    async plan() {
      let orphans: RuntimeJob[]
      try { orphans = (await orphanRuntimeJobs(cron)).orphans } catch { return [] }
      if (orphans.length === 0) return []
      return [{
        id: 'track-runtime-cron',
        actionId: 'track-runtime-cron',
        title: 'Track orphan runtime cron jobs',
        reason: `${orphans.length} runtime cron job(s) are absent from the schedule sidecar.`,
        safety: 'safe',
        incidentIds: [],
        observationIds: [],
        preconditions: [],
        changes: [{
          kind: 'file',
          target: getSidecarPath(),
          action: 'update',
          description: 'Add orphan runtime cron jobs to the sidecar with manual-triage flags and no guessed agent.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      try {
        const { orphans } = await orphanRuntimeJobs(cron)
        if (orphans.length === 0) {
          return items.map(item => ({
            itemId: item.id,
            actionId: item.actionId,
            status: 'skipped' as const,
            message: 'All runtime cron jobs are already tracked.',
            affectedCheckIds: ['schedule.schedule-sync'],
            changes: [],
          }))
        }
        const defaultOwner = await resolveDefaultOwner()
        const now = new Date().toISOString()
        for (const orphan of orphans) {
          upsertJob({
            jobId: orphan.id,
            isBakinJob: false,
            source: 'runtime',
            displayName: orphan.name,
            owner: defaultOwner,
            requireTriage: true,
            createdAt: now,
            updatedAt: now,
          })
          log.info('Tracked orphan cron job', { jobId: orphan.id, name: orphan.name })
        }
        return items.map(item => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'applied' as const,
          message: `Tracked ${orphans.length} runtime cron job(s) for manual triage.`,
          affectedCheckIds: ['schedule.schedule-sync'],
          changes: item.changes,
        }))
      } catch (error) {
        return items.map(item => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: error instanceof Error ? error.message : String(error),
          affectedCheckIds: ['schedule.schedule-sync'],
          changes: [],
        }))
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Bakin schedules that can never run (spec D5) + the scoped Remove-job repair
// ---------------------------------------------------------------------------

/** Bakin-owned schedules whose prompt is not a task prompt — they fail on every fire. */
export function unrunnableBakinJobs(): BakinJobMeta[] {
  return Object.values(readSidecar().jobs).filter(job => job.isBakinJob && !isTaskPrompt(job.taskPrompt))
}

function promptPreview(job: BakinJobMeta): string {
  return bounded((job.taskPrompt ?? '').replace(/\s+/g, ' ').trim() || '(empty)', 80)
}

export async function checkSchedulePrompts(): Promise<HealthCheckRunInput> {
  const bakinJobs = Object.values(readSidecar().jobs).filter(job => job.isBakinJob)
  if (bakinJobs.length === 0) {
    return healthObserved([healthHealthy({ key: 'prompts', summary: 'No Bakin schedules to verify.' })])
  }
  const unrunnable = unrunnableBakinJobs()
  if (unrunnable.length === 0) {
    return healthObserved([healthHealthy({
      key: 'prompts',
      summary: `${bakinJobs.length} Bakin schedule(s) carry a runnable task prompt.`,
      evidence: { count: bakinJobs.length },
    })])
  }
  return healthObserved(unrunnable.map(job => healthError({
    key: `unrunnable-${stablePart(job.jobId)}`,
    summary: bounded(`Bakin schedule ${job.displayName ?? job.jobId} (${job.jobId}) has no runnable task prompt.`, 500),
    detail: `Prompt: ${promptPreview(job)} — ${NOT_A_PROMPT_REASON}`,
    evidence: { jobId: job.jobId, name: job.displayName ?? job.jobId, prompt: promptPreview(job), source: job.source ?? 'bakin' },
    incident: {
      key: `unrunnable-${stablePart(job.jobId)}`,
      title: bounded(`Schedule ${job.displayName ?? job.jobId} can never run`, 120),
      impact: 'Every fire creates a task with no actionable prompt; the task fails or blocks and the schedule keeps firing.',
      disposition: 'action_required' as const,
      class: 'cleanup_backlog' as const,
      resources: [{ kind: 'schedule' as const, id: stablePart(job.jobId), label: bounded(job.displayName ?? job.jobId, 120) }],
      resolution: { key: 'remove-unrunnable-jobs', type: 'repair' as const, label: 'Remove job', actionId: 'remove-unrunnable-jobs' },
    },
  })) as [HealthObservationInput, ...HealthObservationInput[]])
}

/**
 * Remove the Bakin schedules that can never run. The plan freezes the EXACT
 * job ids (one change per job — plan review R2) and apply deletes only ids
 * present in the items it receives that are still Bakin jobs failing the
 * predicate; anything else is reported `skipped`, never touched.
 */
export function scheduleUnrunnableJobsRepair(onRemoved: (jobId: string) => void): HealthRepairActionDefinition {
  return {
    id: 'remove-unrunnable-jobs',
    name: 'Remove Bakin schedules that can never run',
    async plan(target) {
      const jobs = unrunnableBakinJobs()
      if (jobs.length === 0) return []
      return [{
        id: 'remove-unrunnable-jobs',
        actionId: 'remove-unrunnable-jobs',
        title: `Remove ${jobs.length} Bakin schedule(s) without a runnable prompt`,
        reason: 'A schedule whose prompt is not a task prompt fails on every fire and keeps firing.',
        safety: 'destructive',
        ...repairTargetSelection(target),
        changes: jobs.map(job => ({
          kind: 'file' as const,
          target: job.jobId,
          action: 'delete' as const,
          description: `Remove schedule "${job.displayName ?? job.jobId}" (${job.jobId}) — prompt ${promptPreview(job)} is not a task prompt.`,
        })),
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const targets = [...new Set(items.flatMap(item => item.changes.map(change => change.target)))]
      const removed: string[] = []
      const skipped: string[] = []
      for (const jobId of targets) {
        const job = getJob(jobId)
        if (!job || !job.isBakinJob || isTaskPrompt(job.taskPrompt)) {
          skipped.push(jobId)
          continue
        }
        removeJob(jobId)
        onRemoved(jobId)
        removed.push(jobId)
        log.info('Removed unrunnable Bakin schedule', { jobId, name: job.displayName })
      }
      const message = [
        removed.length > 0 ? `Removed ${removed.length} schedule(s): ${removed.join(', ')}.` : 'Nothing removed.',
        skipped.length > 0 ? `Skipped ${skipped.length} (already gone, not a Bakin job, or now runnable): ${skipped.join(', ')}.` : '',
      ].filter(Boolean).join(' ')
      return items.map(item => ({
        itemId: item.id,
        actionId: item.actionId,
        status: removed.length > 0 ? 'applied' as const : 'skipped' as const,
        message,
        affectedCheckIds: ['schedule.schedule-prompts'],
        changes: item.changes.filter(change => removed.includes(change.target)),
      }))
    },
  }
}
