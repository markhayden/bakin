/** Canonical Schedule health checks and explicit repair actions. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

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

const log = createLogger('schedule:health')
type RuntimeCronReader = Pick<NonNullable<AgentRuntimeAdapter['cron']>, 'list'>

interface RuntimeJob {
  id: string
  name: string
}

interface ScheduleSidecar {
  version: number
  jobs: Record<string, unknown>
}

function stablePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'unknown'
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function readScheduleSidecar(contentDir: string): ScheduleSidecar {
  const path = join(contentDir, 'schedule', 'sidecar.json')
  if (!existsSync(path)) return { version: 1, jobs: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ScheduleSidecar>
    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      jobs: parsed.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {},
    }
  } catch {
    return { version: 1, jobs: {} }
  }
}

async function orphanRuntimeJobs(contentDir: string, cron: RuntimeCronReader): Promise<{ jobs: RuntimeJob[]; orphans: RuntimeJob[] }> {
  const jobs = (await cron.list()).map(job => ({ id: job.id, name: job.name || job.id }))
  const sidecar = readScheduleSidecar(contentDir)
  return { jobs, orphans: jobs.filter(job => !sidecar.jobs[job.id]) }
}

/** Detect runtime cron jobs that are visible to Bakin but absent from its sidecar. */
export async function checkScheduleSync(
  contentDir: string,
  cron: RuntimeCronReader | undefined,
): Promise<HealthCheckRunInput> {
  if (!cron) return healthNotApplicable('The active runtime has no native cron surface to synchronize.')

  let scan: Awaited<ReturnType<typeof orphanRuntimeJobs>>
  try {
    scan = await orphanRuntimeJobs(contentDir, cron)
  } catch (error) {
    return healthObserved([healthUnknown({
      key: 'runtime-cron',
      summary: `Runtime cron jobs could not be read: ${error instanceof Error ? error.message : String(error)}`,
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
  if (scan.orphans.length === 0) {
    return healthObserved([healthHealthy({
      key: 'runtime-cron',
      summary: `${scan.jobs.length} runtime cron job(s) are tracked in the Bakin sidecar.`,
      evidence: { count: scan.jobs.length },
    })])
  }

  const observations = scan.orphans.map(orphan => healthWarning({
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
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
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
      summary: `Runtime cron could not be read: ${error instanceof Error ? error.message : String(error)}`,
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
  contentDir: string,
  cron: RuntimeCronReader,
  resolveDefaultOwner: () => Promise<string>,
): HealthRepairActionDefinition {
  return {
    id: 'track-runtime-cron',
    name: 'Track runtime cron jobs for triage',
    async plan() {
      let orphans: RuntimeJob[]
      try { orphans = (await orphanRuntimeJobs(contentDir, cron)).orphans } catch { return [] }
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
          target: join(contentDir, 'schedule', 'sidecar.json'),
          action: 'update',
          description: 'Add orphan runtime cron jobs to the sidecar with manual-triage flags and no guessed agent.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      try {
        const { orphans } = await orphanRuntimeJobs(contentDir, cron)
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
        const sidecar = readScheduleSidecar(contentDir)
        const now = new Date().toISOString()
        for (const orphan of orphans) {
          sidecar.jobs[orphan.id] = {
            jobId: orphan.id,
            isBakinJob: false,
            source: 'runtime',
            displayName: orphan.name,
            owner: defaultOwner,
            requireTriage: true,
            createdAt: now,
            updatedAt: now,
          }
          log.info('Tracked orphan cron job', { jobId: orphan.id, name: orphan.name })
        }
        const sidecarPath = join(contentDir, 'schedule', 'sidecar.json')
        mkdirSync(dirname(sidecarPath), { recursive: true })
        writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf-8')
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
