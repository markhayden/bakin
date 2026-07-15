/**
 * Schedule plugin — server entry point.
 * Registers API routes, exec tools, and the cron→task bridge.
 */
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'
import { readMergedJobs } from './lib/jobs-reader'
import { readSidecar, resumeDuePauses } from './lib/sidecar'
import { runStartupCatchUp } from './lib/scheduler'
import { checkScheduleCutover, scheduleCutoverRepair, checkScheduleSync, scheduleSyncRepair } from './lib/health-checks'
import { setPluginCtx, getPluginCtx } from './lib/plugin-context'
import {
  MISSED_WINDOW_REASON,
  healPendingCronClaims,
  fireScheduledRunFromPayload,
} from './lib/fire-engine'

// Re-exported so the `@bakin/schedule/index` test surface stays stable
// (cron-dedup.test.ts / blocked-fire-routing.test.ts import it from here).
export { MISSED_WINDOW_REASON }
import {
  schedulerDeps,
  runScheduleCutover,
  startScheduler,
  stopScheduler,
  catchUpWindowMs,
} from './lib/scheduler-loop'
import {
  ensureBakinJob,
  readMergedRuntimeJobs,
  jobToSearchDoc,
} from './lib/job-service'
import { adoptCronJobs, type AdoptCronJobsInput } from './lib/cron-adoption'
import { registerScheduleExecTools } from './lib/exec-tools'
import { scheduleRoutes } from './lib/routes/jobs'
import { createLogger } from '../../src/core/logger'
import { getContentDir } from '../../src/core/content-dir'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'

const log = createLogger('schedule')


// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

// ─── Routes (declarative) ────────────────────────────────────────────────


const schedulePlugin: BakinPlugin = definePlugin({
  id: 'schedule',
  name: 'Schedule',
  version: '2.0.0',
  routes: scheduleRoutes,

  settingsSchema: {
    fields: [
      { key: 'maxFailures', type: 'number', label: 'Max consecutive failures', description: 'Pause job after this many consecutive failures', default: 3 },
      { key: 'tickIntervalSeconds', type: 'number', label: 'Scheduler tick interval (seconds)', description: 'How often the scheduler checks for due schedules. Floor-clamped to 5s.', default: 30 },
      { key: 'catchUpWindowMinutes', type: 'number', label: 'Missed-fire safety window (minutes)', description: 'After downtime, a missed run fires normally if within this window; older runs land in Blocked for you to triage. Larger = more tolerant.', default: 60 },
    ],
  },

  navItems: [],
  contentFiles: [],

  async activate(ctx: PluginContext) {
    setPluginCtx(ctx)

    ctx.hooks.register('schedule.ensureBakinJob', (data: Record<string, unknown>) => ensureBakinJob(ctx, data), {
      hookKind: 'rpc',
      label: 'Ensure Bakin schedule',
      summary: 'Create or update a Bakin-managed runtime cron job and return the provider job id.',
    })

    ctx.hooks.register('schedule.adoptCronJobs', (data: unknown) => adoptCronJobs(ctx, data as AdoptCronJobsInput), {
      hookKind: 'rpc',
      label: 'Adopt runtime cron jobs',
      summary: 'Adopt snapshotted runtime cron jobs into Bakin schedules during a runtime switch (opt-in, idempotent per job id).',
    })

    // ─── Search Content Type Registration ─────────────────────────────

    ctx.search.registerContentType({
      table: 'schedule',
      schemaVersion: 1,
      schema: {
        name: { type: 'text' },
        schedule: { type: 'keyword' },
        command: { type: 'text' },
        agent: { type: 'keyword' },
        enabled: { type: 'keyword' },
        updated_at: { type: 'datetime' },
      },
      searchableFields: ['name', 'command'],
      rerankField: 'command',
      embeddingTemplate: '{{name}} {{command}}',
      facets: ['agent', 'enabled'],
      reindex: async function* () {
        for (const job of await readMergedRuntimeJobs()) {
          yield { key: job.id, doc: jobToSearchDoc(job) }
        }
      },
      verifyExists: async () => true, // Jobs are ephemeral, managed by the runtime adapter.
    })

    /** Runtime jobs live in the cron adapter + sidecar, so sync them into search on plugin activation. */
    async function syncRuntimeJobsToSearch(): Promise<void> {
      const jobs = await readMergedRuntimeJobs()
      for (const job of jobs) {
        ctx.search.index(job.id, jobToSearchDoc(job)).catch((err) => {
          log.warn('Failed to index runtime job', { jobId: job.id, error: err instanceof Error ? err.message : String(err) })
        })
      }
    }

    await syncRuntimeJobsToSearch()

    // ── API Routes are declarative on plugin.routes (see module scope). ──

    // ── Exec Tools (agent-facing) ──────────────────────────────────────

    registerScheduleExecTools(ctx)

    // ─── Health check (migrated out of core/doctor.ts per #139 C4) ──────
    // Cut any Bakin schedules off OpenClaw cron (import expr → store, remove the
    // runtime cron) so the scheduler is the sole fire path. Idempotent; runs
    // every activate to close the upgrade gap and recover from a prior partial.
    try {
      await runScheduleCutover()
    } catch (err) {
      log.error('Schedule cutover failed', err)
    }

    // Doctor check + repair surfacing any schedule whose cutover didn't complete
    // (e.g. the runtime unreachable at boot) — the end-user migration command.
    ctx.registerHealthCheck({
      id: 'schedule-cutover',
      name: 'Bakin schedules cut over from runtime cron',
      run: async () => checkScheduleCutover(
        ctx.runtime.cron,
        () => Object.values(readSidecar().jobs).filter(j => j.isBakinJob).map(j => j.jobId),
        ctx.runtime.name,
      ),
      repair: scheduleCutoverRepair(runScheduleCutover),
    })

    // Orphan native crons: runtime cron jobs invisible to Bakin's sidecar
    // (e.g. created by an agent directly in the runtime). Detection is
    // read-only and the repair only records requireTriage sidecar entries —
    // it NEVER writes runtime cron state, so it cannot reintroduce the
    // pre-#473 double-fire the legacy sync check was removed for.
    const syncCron = ctx.runtime.cron
    ctx.registerHealthCheck({
      id: 'schedule-sync',
      name: 'Runtime cron jobs tracked in Bakin sidecar',
      run: async () => checkScheduleSync(
        getContentDir(),
        syncCron,
        syncCron ? await getRuntimeMainAgentId(ctx.runtime) : 'main',
      ),
      ...(syncCron
        ? { repair: scheduleSyncRepair(getContentDir(), syncCron, () => getRuntimeMainAgentId(ctx.runtime)) }
        : {}),
    })

    // Fire (or block) anything missed while the server was down, then start the
    // steady tick. Catch-up first so a just-missed occurrence isn't double-handled.
    // Re-enable any timed pause that lapsed during downtime so its missed run is
    // caught up rather than left dormant by the enabled-gate.
    try {
      resumeDuePauses()
      await runStartupCatchUp(schedulerDeps(), catchUpWindowMs())
    } catch (err) {
      log.error('Schedule startup catch-up failed', err)
    }

    startScheduler()
    log.info('Schedule plugin activated')
  },

  async onReady() {
    const runtime = getPluginCtx()?.runtime
    if (!runtime) return
    const jobs = await readMergedJobs(runtime.cron, await getRuntimeMainAgentId(runtime))
    const bakin = jobs.filter(j => j.isBakinJob)
    const paused = bakin.filter(j => j.paused)
    log.info(`Ready — ${bakin.length} bakin jobs (${paused.length} paused), ${jobs.length} total`)
  },

  onShutdown() {
    stopScheduler()
    log.info('Schedule plugin shutting down')
  },
})

export default schedulePlugin

/**
 * Test-only internals. The plugin loader reads only the default export; these
 * let exactly-once / heal tests drive the claim→fire path directly without a
 * full scheduler tick.
 */
export const __scheduleTestInternals = {
  fireScheduledRunFromPayload,
  healPendingCronClaims,
  setPluginCtxForTests: (ctx: unknown) => {
    setPluginCtx(ctx as PluginContext | null)
  },
}
