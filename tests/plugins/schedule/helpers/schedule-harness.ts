/**
 * Shared harness for the schedule plugin route/exec-tool/activation tests (FW7).
 *
 * The former tests/plugins/schedule/routes.test.ts godfile carried one big
 * runtime-mocking scaffold: deterministic merged-job state, an in-memory
 * runtime cron adapter, a jobs-reader overlay, and a fake cron parser. The
 * split files (routes-jobs, exec-tools, activation-and-search) all need the
 * same scaffold, so the pure parts live here once.
 *
 * IMPORTANT: bun's `mock.module(...)` calls MUST stay in each test file —
 * module mocks are per-file under `--isolate`, and hoisting them into a
 * shared helper would silently change what gets mocked. This helper only
 * exports fixture builders and the mutable mock-state factory; each test
 * file wires the factory's implementations into its own mock.module calls.
 */
import { mock, type Mock } from 'bun:test'
import { join } from 'path'
import type { BakinJobMeta, MergedJob, RunEntry } from '@bakin/schedule/types'
import type { CreateCronJobInput, CronJob, CronRun, UpdateCronJobInput } from '@bakin/core/adapters/runtime'

// ---------------------------------------------------------------------------
// Pure fixture builders
// ---------------------------------------------------------------------------

export function makeMeta(overrides: Partial<BakinJobMeta> = {}): BakinJobMeta {
  return {
    jobId: 'job-123',
    isBakinJob: true,
    source: 'bakin',
    displayName: 'Daily Report',
    agentId: 'chef',
    owner: 'main',
    taskPrompt: 'Generate daily report',
    taskTitle: 'Report: {date}',
    allowOverlap: false,
    maxFailures: 3,
    consecutiveFailures: 0,
    createdAt: '2026-03-30T00:00:00Z',
    updatedAt: '2026-03-30T00:00:00Z',
    ...overrides,
  }
}

export function makeMergedJob(overrides: Partial<MergedJob> = {}): MergedJob {
  return {
    id: 'job-123',
    name: 'Daily Report',
    schedule: { type: 'cron', value: '0 9 * * *' },
    enabled: true,
    completed: false,
    source: 'bakin',
    canAdopt: false,
    canRestoreNative: false,
    isBakinJob: true,
    displayName: 'Daily Report',
    agentId: 'chef',
    owner: 'main',
    requireTriage: false,
    paused: false,
    allowOverlap: false,
    maxFailures: 3,
    consecutiveFailures: 0,
    humanSchedule: 'Daily at 9am',
    ...overrides,
  }
}

/**
 * Full-shape getBakinPaths for the dual content-dir mocks. The routes tests
 * exercise the REAL execution ledger, which resolves its SQLite path via
 * getBakinPaths().db — the `db` key is mandatory (see CLAUDE.md testing rules).
 */
export function makeBakinPaths(testDir: string) {
  const assets = join(testDir, 'assets')
  return {
    home: testDir,
    memoryLog: join(testDir, 'MEMORY-LOG.md'),
    audit: join(testDir, 'audit.jsonl'),
    assets,
    'assets.store': join(assets, 'store'),
    'assets.inbox': join(assets, 'inbox'),
    'assets.trash': join(assets, '.trash'),
    agents: join(testDir, 'agents'),
    personas: join(testDir, 'team', 'personas'),
    team: join(testDir, 'team'),
    heartbeats: join(testDir, 'heartbeats'),
    inbox: join(testDir, 'inbox'),
    tasks: join(testDir, 'tasks'),
    workflows: join(testDir, 'workflows'),
    settings: join(testDir, 'settings.json'),
    logs: join(testDir, 'logs'),
    antfly: join(testDir, 'antfly'),
    db: join(testDir, 'bakin.db'),
  }
}

// ---------------------------------------------------------------------------
// Runtime-cron mock state factory
// ---------------------------------------------------------------------------

function mergedJobToCronJob(job: MergedJob): CronJob {
  return {
    id: job.id,
    name: job.displayName || job.name || job.id,
    schedule: job.schedule.value,
    command: job.taskPrompt || job.taskTitle || `bakin:schedule:${job.displayName || job.name || job.id}`,
    enabled: job.enabled,
    toolsAllow: job.toolsAllow,
    metadata: { tz: job.tz, createdAt: job.createdAt },
  }
}

function fallbackMergeJob(job: { id: string; name: string; schedule: { value?: string; expr?: string }; enabled: boolean; payload?: Record<string, unknown> }, sidecar?: BakinJobMeta): MergedJob {
  return {
    id: job.id,
    name: job.name,
    schedule: { type: 'cron', value: job.schedule.value ?? job.schedule.expr ?? '* * * * *' },
    enabled: job.enabled,
    completed: false,
    source: sidecar?.source ?? (sidecar?.isBakinJob ? 'bakin' : 'runtime'),
    canAdopt: !sidecar?.isBakinJob,
    canRestoreNative: Boolean(sidecar?.isBakinJob && sidecar.originalRuntimeCron),
    isBakinJob: sidecar?.isBakinJob ?? false,
    displayName: sidecar?.displayName ?? job.name,
    description: sidecar?.description,
    agentId: sidecar?.agentId,
    owner: sidecar?.owner ?? 'main',
    requireTriage: sidecar?.requireTriage ?? !sidecar,
    workflowId: sidecar?.workflowId,
    taskPrompt: sidecar?.taskPrompt ?? (typeof job.payload?.message === 'string' ? job.payload.message : undefined),
    taskTitle: sidecar?.taskTitle,
    paused: sidecar?.paused ?? false,
    pauseUntil: sidecar?.pauseUntil,
    pauseReason: sidecar?.pauseReason,
    skipNextN: sidecar?.skipNextN,
    skippedCount: sidecar?.skippedCount,
    allowOverlap: sidecar?.allowOverlap ?? false,
    maxFailures: sidecar?.maxFailures ?? 3,
    consecutiveFailures: sidecar?.consecutiveFailures ?? 0,
    lastTaskId: sidecar?.lastTaskId,
    tz: sidecar?.tz,
    createdAt: sidecar?.createdAt,
    humanSchedule: `Human: ${job.schedule.value ?? job.schedule.expr ?? '* * * * *'}`,
  }
}

function runEntryToCronRun(run: RunEntry): CronRun {
  return {
    id: run.runId,
    jobId: run.jobId,
    startedAt: run.timestamp,
    status: run.status === 'failure' ? 'failed' : run.status === 'skipped' ? 'cancelled' : 'succeeded',
    error: run.error,
  }
}

export interface ScheduleCronHarness {
  mockMergedJobs: MergedJob[]
  mockRuntimeCronJobs: CronJob[]
  mockRuns: RunEntry[]
  setLastRunOverride: (run: RunEntry | null) => void
  setCronRemoveError: (error: Error | null) => void
  mockCronCreate: Mock<(input: CreateCronJobInput) => Promise<CronJob>>
  mockCronUpdate: Mock<(id: string, patch: UpdateCronJobInput) => Promise<CronJob>>
  mockCronRemove: Mock<(id: string) => Promise<void>>
  mockCronRunNow: Mock<(jobId: string) => Promise<CronRun>>
  mockCronListRuns: Mock<(jobId: string) => Promise<CronRun[]>>
  mockCronGetRaw: Mock<(id: string) => Promise<unknown | null>>
  mockCronRestoreRaw: Mock<(id: string, snapshot: unknown) => Promise<CronJob>>
  mockCronList: Mock<() => Promise<CronJob[]>>
  /** Adapter object for the '@bakin/core/adapters/runtime/testing' mock.module. */
  createMockRuntimeAdapter: () => Record<string, unknown>
  /** Module shape for the '@bakin/schedule/lib/jobs-reader' mock.module. */
  jobsReaderModule: () => Record<string, unknown>
  /** Module shape for the '@bakin/schedule/lib/cron-parser' mock.module. */
  cronParserModule: () => Record<string, unknown>
  /** Clears merged jobs, runtime crons, runs, and per-test overrides. */
  reset: () => void
}

export function createScheduleCronHarness(): ScheduleCronHarness {
  const mockMergedJobs: MergedJob[] = []
  const mockRuntimeCronJobs: CronJob[] = []
  const mockRuns: RunEntry[] = []
  let lastRunOverride: RunEntry | null = null
  let mockCronRemoveError: Error | null = null

  const mockCronCreate = mock(async (input: CreateCronJobInput): Promise<CronJob> => {
    const job = {
      id: input.id === 'plugin-nightly-sync' ? 'runtime-plugin-nightly-sync' : input.id ?? 'new-job-id',
      name: input.name,
      schedule: input.schedule,
      command: input.command,
      enabled: input.enabled ?? true,
      metadata: input.metadata,
    }
    mockRuntimeCronJobs.push(job)
    return job
  })
  const mockCronUpdate = mock(async (id: string, patch: UpdateCronJobInput): Promise<CronJob> => {
    const index = mockRuntimeCronJobs.findIndex(job => job.id === id)
    const current = index === -1
      ? { id, name: id, schedule: '* * * * *', command: '', enabled: true }
      : mockRuntimeCronJobs[index]
    const next = {
      ...current,
      ...patch,
      toolsAllow: patch.toolsAllow === null ? undefined : patch.toolsAllow ?? current.toolsAllow,
    }
    if (index === -1) mockRuntimeCronJobs.push(next)
    else mockRuntimeCronJobs[index] = next
    return next
  })
  const mockCronRemove = mock(async (id: string) => {
    if (mockCronRemoveError) throw mockCronRemoveError
    const index = mockRuntimeCronJobs.findIndex(job => job.id === id)
    if (index !== -1) mockRuntimeCronJobs.splice(index, 1)
  })
  const mockCronRunNow = mock(async (jobId: string): Promise<CronRun> => ({
    id: 'run-now',
    jobId,
    status: 'succeeded',
    startedAt: '2026-03-31T09:00:00Z',
  }))
  const mockCronListRuns = mock(async (jobId: string): Promise<CronRun[]> => {
    if (lastRunOverride && lastRunOverride.jobId === jobId) return [runEntryToCronRun(lastRunOverride)]
    return mockRuns.filter(run => run.jobId === jobId).map(runEntryToCronRun)
  })
  const mockCronGetRaw = mock(async (id: string): Promise<unknown | null> => {
    return mockRuntimeCronJobs.find(job => job.id === id) ?? null
  })
  const mockCronRestoreRaw = mock(async (id: string, snapshot: unknown): Promise<CronJob> => {
    const raw = snapshot as Partial<CronJob>
    const restored: CronJob = {
      id,
      name: raw.name ?? id,
      schedule: raw.schedule ?? '* * * * *',
      command: raw.command ?? '',
      enabled: raw.enabled ?? true,
      toolsAllow: raw.toolsAllow,
      metadata: raw.metadata,
    }
    const index = mockRuntimeCronJobs.findIndex(job => job.id === id)
    if (index === -1) mockRuntimeCronJobs.push(restored)
    else mockRuntimeCronJobs[index] = restored
    return restored
  })
  const mockCronList = mock(async (): Promise<CronJob[]> => {
    const jobs = new Map<string, CronJob>()
    for (const job of mockMergedJobs.map(mergedJobToCronJob)) jobs.set(job.id, job)
    for (const job of mockRuntimeCronJobs) jobs.set(job.id, job)
    return Array.from(jobs.values())
  })

  return {
    mockMergedJobs,
    mockRuntimeCronJobs,
    mockRuns,
    setLastRunOverride: (run) => { lastRunOverride = run },
    setCronRemoveError: (error) => { mockCronRemoveError = error },
    mockCronCreate,
    mockCronUpdate,
    mockCronRemove,
    mockCronRunNow,
    mockCronListRuns,
    mockCronGetRaw,
    mockCronRestoreRaw,
    mockCronList,
    createMockRuntimeAdapter: () => ({
      agents: {
        list: async () => [{ id: 'main', name: 'Main', role: 'Orchestrator' }],
      },
      cron: {
        list: mockCronList,
        get: async (id: string) => (await mockCronList()).find(job => job.id === id) ?? null,
        create: mockCronCreate,
        update: mockCronUpdate,
        remove: mockCronRemove,
        runNow: mockCronRunNow,
        listRuns: mockCronListRuns,
        getRaw: mockCronGetRaw,
        restoreRaw: mockCronRestoreRaw,
      },
    }),
    jobsReaderModule: () => ({
      readMergedJobs: () => mockMergedJobs,
      mergeJob: (job: { id: string; name: string; schedule: { value?: string; expr?: string }; enabled: boolean; payload?: Record<string, unknown> }, sidecar?: BakinJobMeta) => (
        mockMergedJobs.find(merged => merged.id === job.id) ?? fallbackMergeJob(job, sidecar)
      ),
    }),
    cronParserModule: () => ({
      parseSchedule: (input: string) => {
        if (input === 'bad-expr') return null
        // Raw cron passes through
        if (/^[\d*,\-/]+\s/.test(input)) {
          return { cron: input, human: `Cron: ${input}`, confidence: 'high', source: 'raw', nextRuns: [] }
        }
        // NL → fake cron
        return { cron: '0 9 * * *', human: `Every day at 9am`, confidence: 'high', source: 'deterministic', nextRuns: [] }
      },
      cronToHuman: (cron: string) => `Human: ${cron}`,
    }),
    reset: () => {
      mockMergedJobs.length = 0
      mockRuntimeCronJobs.length = 0
      mockRuns.length = 0
      lastRunOverride = null
      mockCronRemoveError = null
    },
  }
}
