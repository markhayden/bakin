import { describe, it, expect, mock } from 'bun:test'
import { makeOccurrenceRunId, runSchedulerTick, type SchedulerDeps } from '@bakin/schedule/lib/scheduler'
import type { BakinJobMeta } from '@bakin/schedule/types'

function meta(overrides: Partial<BakinJobMeta> = {}): BakinJobMeta {
  return {
    jobId: 'sch_1',
    isBakinJob: true,
    enabled: true,
    schedule: { kind: 'cron', expr: '0 9 * * *' },
    tz: 'America/Denver',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Build deps with in-memory fakes. `claimed` tracks (jobId,runId) already
 * claimed so getCronFire/claimCronFire behave like the real ledger PK.
 */
function makeDeps(jobs: BakinJobMeta[], now: number, opts: { tickWindowMs?: number } = {}) {
  const claimed = new Set<string>()
  const fired: Array<{ jobId: string; runId: string; occurrence: string }> = []
  const deps: SchedulerDeps = {
    now: () => now,
    tickWindowMs: opts.tickWindowMs ?? 90_000,
    listJobs: () => jobs,
    getCronFire: (jobId, runId) => (claimed.has(`${jobId}:${runId}`) ? { jobId, runId } : null),
    claimCronFire: (jobId, runId) => {
      const key = `${jobId}:${runId}`
      if (claimed.has(key)) return { claimed: false }
      claimed.add(key)
      return { claimed: true }
    },
    fire: mock(async (m: BakinJobMeta, jobId: string, runId: string, occurrence: Date) => {
      fired.push({ jobId, runId, occurrence: occurrence.toISOString() })
    }),
    log: { warn: mock() },
  }
  return { deps, fired, claimed }
}

const NINE_AM_MDT = Date.parse('2026-06-07T15:00:00Z') // 9am America/Denver

describe('schedule/scheduler', () => {
  describe('makeOccurrenceRunId', () => {
    it('is deterministic per (job, occurrence)', () => {
      const occ = new Date('2026-06-07T15:00:00Z')
      expect(makeOccurrenceRunId('sch_1', occ)).toBe(makeOccurrenceRunId('sch_1', occ))
    })
    it('differs across occurrences and jobs', () => {
      const a = new Date('2026-06-07T15:00:00Z')
      const b = new Date('2026-06-08T15:00:00Z')
      expect(makeOccurrenceRunId('sch_1', a)).not.toBe(makeOccurrenceRunId('sch_1', b))
      expect(makeOccurrenceRunId('sch_1', a)).not.toBe(makeOccurrenceRunId('sch_2', a))
    })
  })

  describe('runSchedulerTick', () => {
    it('fires a due occurrence exactly once', async () => {
      const { deps, fired } = makeDeps([meta()], NINE_AM_MDT)
      await runSchedulerTick(deps)
      expect(fired).toHaveLength(1)
      expect(fired[0].occurrence).toBe('2026-06-07T15:00:00.000Z')
      expect(fired[0].runId).toBe(makeOccurrenceRunId('sch_1', new Date(NINE_AM_MDT)))
    })

    it('does not re-fire the same occurrence on a second tick (ledger dedup)', async () => {
      const { deps, fired } = makeDeps([meta()], NINE_AM_MDT)
      await runSchedulerTick(deps)
      await runSchedulerTick(deps)
      expect(fired).toHaveLength(1)
    })

    it('does not fire when the claim is lost despite the pre-filter (race)', async () => {
      const { deps, fired, claimed } = makeDeps([meta()], NINE_AM_MDT)
      // Simulate another worker holding the claim but the cheap pre-filter missing it.
      const runId = makeOccurrenceRunId('sch_1', new Date(NINE_AM_MDT))
      const original = deps.getCronFire
      deps.getCronFire = () => null // pre-filter always misses
      claimed.add(`sch_1:${runId}`) // but the claim already exists
      void original
      await runSchedulerTick(deps)
      expect(fired).toHaveLength(0)
    })

    it('skips disabled jobs', async () => {
      const { deps, fired } = makeDeps([meta({ enabled: false })], NINE_AM_MDT)
      await runSchedulerTick(deps)
      expect(fired).toHaveLength(0)
    })

    it('skips jobs without a schedule definition', async () => {
      const { deps, fired } = makeDeps([meta({ schedule: undefined })], NINE_AM_MDT)
      await runSchedulerTick(deps)
      expect(fired).toHaveLength(0)
    })

    it('skips jobs with an invalid cron expression without throwing', async () => {
      const { deps, fired } = makeDeps([meta({ schedule: { kind: 'cron', expr: 'nonsense' } })], NINE_AM_MDT)
      await runSchedulerTick(deps)
      expect(fired).toHaveLength(0)
    })

    it('fires every occurrence inside the window for a frequent schedule', async () => {
      // every-minute job; a 3-minute window should yield 3 fires.
      const now = Date.parse('2026-06-07T15:03:30Z')
      const { deps, fired } = makeDeps(
        [meta({ schedule: { kind: 'cron', expr: '* * * * *' } })],
        now,
        { tickWindowMs: 3 * 60_000 },
      )
      await runSchedulerTick(deps)
      expect(fired.map(f => f.occurrence)).toEqual([
        '2026-06-07T15:01:00.000Z',
        '2026-06-07T15:02:00.000Z',
        '2026-06-07T15:03:00.000Z',
      ])
    })

    it('fires independently across multiple jobs', async () => {
      const { deps, fired } = makeDeps(
        [meta({ jobId: 'sch_a' }), meta({ jobId: 'sch_b' })],
        NINE_AM_MDT,
      )
      await runSchedulerTick(deps)
      expect(fired.map(f => f.jobId).sort()).toEqual(['sch_a', 'sch_b'])
    })
  })
})
