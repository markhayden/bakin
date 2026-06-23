/**
 * OpenClaw cron store — the `runtime.cron` capability's persistence + parsing.
 *
 * Reads/writes ~/.openclaw/cron/jobs.json and runs/<id>.jsonl, builds the
 * `cron add|edit` CLI argv, and normalizes the loose JSON the OpenClaw CLI
 * returns into typed CronJob / CronRun shapes. The class's cron methods own
 * the exec calls and import these helpers; nothing here touches adapter
 * instance state, so it's a pure store/parse module.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type {
  CronJob,
  CronRun,
  CreateCronJobInput,
  UpdateCronJobInput,
  RuntimeMetadata,
} from '@bakin/core/adapters/runtime'
import { getOpenClawPath } from './home'
import {
  firstString,
  getJsonPath,
  isPlainObject,
  metadataValue,
  parseJsonLines,
  parseJsonValue,
} from './runtime-utils'

/** CLI `--timeout` budget (ms) for cron add/edit/list/rm invocations. */
export const OPENCLAW_CRON_TIMEOUT_MS = 30000

export interface OpenClawCronStore {
  version?: number
  jobs?: OpenClawCronStoreJob[]
}

export interface OpenClawCronStoreJob {
  id: string
  agentId?: string
  sessionKey?: string
  name?: string
  description?: string
  enabled?: boolean
  deleteAfterRun?: boolean
  schedule?: string | { kind?: string; type?: string; expr?: string; value?: string; tz?: string }
  sessionTarget?: string
  wakeMode?: string
  delivery?: { mode?: string; url?: string; to?: string; token?: string; channel?: string; threadId?: string; accountId?: string; bestEffort?: boolean; failureDestination?: unknown }
  payload?: { kind?: string; message?: string; text?: string; toolsAllow?: string[] } & Record<string, unknown>
  failureAlert?: unknown
  state?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
  createdAtMs?: number
  updatedAtMs?: number
  metadata?: RuntimeMetadata
}

export interface OpenClawCronRunEntry {
  runId?: string
  id?: string
  jobId?: string
  timestamp?: string
  startedAt?: string
  endedAt?: string
  status?: string
  output?: string
  error?: string
}

export function readCronStore(): OpenClawCronStore {
  try {
    const path = getOpenClawPath('cron', 'jobs.json')
    if (!existsSync(path)) return { version: 1, jobs: [] }
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as OpenClawCronStore
    return { version: parsed.version ?? 1, jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] }
  } catch {
    return { version: 1, jobs: [] }
  }
}

export function writeCronStore(store: OpenClawCronStore): void {
  const path = getOpenClawPath('cron', 'jobs.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ version: store.version ?? 1, jobs: store.jobs ?? [] }, null, 2), 'utf-8')
}

export function readCronJobs(): OpenClawCronStoreJob[] {
  return readCronStore().jobs ?? []
}

export function cronStoreJobToRuntime(job: OpenClawCronStoreJob): CronJob {
  const scheduleTz = typeof job.schedule === 'object' && typeof job.schedule.tz === 'string' && job.schedule.tz.length > 0
    ? job.schedule.tz
    : undefined
  const metadata = scheduleTz && !metadataValue(job.metadata, 'tz')
    ? { ...(job.metadata ?? {}), tz: scheduleTz }
    : job.metadata
  const command = typeof job.payload?.message === 'string'
    ? job.payload.message
    : typeof job.payload?.text === 'string'
      ? job.payload.text
      : ''
  return {
    id: job.id,
    name: job.name ?? job.id,
    schedule: cronScheduleToString(job.schedule),
    command,
    enabled: job.enabled ?? true,
    toolsAllow: normalizeCronToolsAllow(job.payload?.toolsAllow),
    metadata,
  }
}

export function cronCreateArgs(input: CreateCronJobInput): string[] {
  const args = [
    'cron',
    'add',
    '--name',
    input.name,
    '--cron',
    input.schedule,
    '--wake',
    'now',
    '--json',
    '--timeout',
    String(OPENCLAW_CRON_TIMEOUT_MS),
  ]
  const tz = metadataValue(input.metadata, 'tz')
  if (tz) args.push('--tz', tz)
  if (input.enabled === false) args.push('--disabled')
  appendCronPayloadArgs(args, input.command, input.metadata, input.toolsAllow, { allowClearTools: false })
  return args
}

export function cronUpdateArgs(id: string, current: CronJob, patch: UpdateCronJobInput): string[] {
  const args = ['cron', 'edit', id, '--timeout', String(OPENCLAW_CRON_TIMEOUT_MS)]
  if (patch.name !== undefined) args.push('--name', patch.name)
  if (patch.schedule !== undefined) args.push('--cron', patch.schedule)
  if (patch.enabled === true) args.push('--enable')
  if (patch.enabled === false) args.push('--disable')

  const metadata = patch.metadata ?? current.metadata
  const tz = metadataValue(metadata, 'tz')
  if (patch.metadata !== undefined && tz) args.push('--tz', tz)

  if (patch.command !== undefined || patch.metadata !== undefined || patch.toolsAllow !== undefined) {
    appendCronPayloadArgs(args, patch.command ?? current.command, metadata, patch.toolsAllow)
  }

  return args
}

export function appendCronPayloadArgs(
  args: string[],
  command: string,
  _metadata: RuntimeMetadata | undefined,
  toolsAllow: string[] | null | undefined,
  opts: { allowClearTools?: boolean } = {},
): void {
  args.push('--session', 'isolated', '--message', command)
  if (toolsAllow === undefined) return

  const normalized = normalizeCronToolsAllow(toolsAllow)
  if (normalized) {
    args.push('--tools', normalized.join(','))
  } else if (opts.allowClearTools !== false) {
    args.push('--clear-tools')
  }
}

export function cronJobFromInput(id: string, input: CreateCronJobInput): CronJob {
  return {
    id,
    name: input.name,
    schedule: input.schedule,
    command: input.command,
    enabled: input.enabled ?? true,
    toolsAllow: normalizeCronToolsAllow(input.toolsAllow),
    metadata: input.metadata,
  }
}

export function cronJobFromUpdatePatch(id: string, current: CronJob, patch: UpdateCronJobInput): CronJob {
  const command = patch.command ?? current.command
  const metadata = patch.metadata ?? current.metadata
  const toolsAllow = patch.toolsAllow === null
    ? undefined
    : patch.toolsAllow !== undefined
      ? normalizeCronToolsAllow(patch.toolsAllow)
      : current.toolsAllow

  return {
    id,
    name: patch.name ?? current.name,
    schedule: patch.schedule ?? current.schedule,
    command,
    enabled: patch.enabled ?? current.enabled,
    toolsAllow,
    metadata,
  }
}

export function withCronInputFallbacks(raw: OpenClawCronStoreJob, id: string, input: CreateCronJobInput): OpenClawCronStoreJob {
  return {
    ...raw,
    id,
    name: raw.name ?? input.name,
    enabled: raw.enabled ?? input.enabled ?? true,
    schedule: raw.schedule ?? { kind: 'cron', expr: input.schedule },
    payload: raw.payload ?? cronPayloadForCommand(input.command, undefined),
    metadata: raw.metadata ?? input.metadata,
  }
}

export function cronPayloadForCommand(
  command: string,
  current: OpenClawCronStoreJob['payload'],
): OpenClawCronStoreJob['payload'] {
  if (current?.kind === 'systemEvent') {
    return { kind: 'systemEvent', text: command }
  }
  return { ...(current ?? {}), kind: 'agentTurn', message: command }
}

export function normalizeCronToolsAllow(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const tools: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const tool = entry.trim()
    if (!tool || seen.has(tool)) continue
    seen.add(tool)
    tools.push(tool)
  }
  return tools.length > 0 ? tools : undefined
}

export function cronScheduleToString(schedule: OpenClawCronStoreJob['schedule']): string {
  if (typeof schedule === 'string') return schedule
  return schedule?.expr ?? schedule?.value ?? '* * * * *'
}

export function extractCronStoreJobs(raw: string | unknown): OpenClawCronStoreJob[] {
  const parsed = typeof raw === 'string' ? parseJsonValue(raw) : raw
  const candidates = cronJobCandidates(parsed)
  return candidates
    .map(normalizeOpenClawCronStoreJob)
    .filter((job): job is OpenClawCronStoreJob => job !== null)
}

export function extractCronStoreJob(raw: unknown): OpenClawCronStoreJob | null {
  return extractCronStoreJobs(raw)[0] ?? null
}

export function cronJobCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!isPlainObject(value)) return []

  for (const key of ['jobs', 'items', 'results', 'data']) {
    const candidate = value[key]
    if (Array.isArray(candidate)) return candidate
  }

  for (const key of ['job', 'cronJob', 'result', 'payload']) {
    const candidate = value[key]
    if (Array.isArray(candidate)) return candidate
    if (isPlainObject(candidate)) {
      const nested = cronJobCandidates(candidate)
      if (nested.length > 0) return nested
      if (typeof candidate.id === 'string') return [candidate]
    }
  }

  return typeof value.id === 'string' ? [value] : []
}

export function normalizeOpenClawCronStoreJob(value: unknown): OpenClawCronStoreJob | null {
  if (!isPlainObject(value)) return null
  const id = firstString(value.id, value.jobId, value.key)
  if (!id) return null

  const rawSchedule = value.schedule
  const schedule = typeof rawSchedule === 'string' || isPlainObject(rawSchedule)
    ? rawSchedule as OpenClawCronStoreJob['schedule']
    : firstString(value.cron, value.expr)
      ? { kind: 'cron', expr: firstString(value.cron, value.expr), tz: firstString(value.tz, value.timezone) }
      : undefined

  const rawPayload = isPlainObject(value.payload) ? value.payload : undefined
  const systemEvent = firstString(value.systemEvent)
  const message = firstString(value.message, value.command)
  const rawTools = rawPayload?.toolsAllow ?? value.toolsAllow ?? value.tools
  const toolsAllow = normalizeCronToolsAllow(Array.isArray(rawTools) ? rawTools : typeof rawTools === 'string' ? rawTools.split(/[,\s]+/) : undefined)
  const payload = rawPayload
    ? {
        ...rawPayload,
        ...(toolsAllow ? { toolsAllow } : {}),
      } as OpenClawCronStoreJob['payload']
    : systemEvent
      ? { kind: 'systemEvent', text: systemEvent }
      : message
        ? {
            kind: 'agentTurn',
            message,
            ...(toolsAllow ? { toolsAllow } : {}),
          }
        : undefined

  return {
    id,
    ...(typeof value.agentId === 'string' ? { agentId: value.agentId } : {}),
    ...(typeof value.sessionKey === 'string' ? { sessionKey: value.sessionKey } : {}),
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(typeof value.deleteAfterRun === 'boolean' ? { deleteAfterRun: value.deleteAfterRun } : {}),
    ...(schedule ? { schedule } : {}),
    ...(typeof value.sessionTarget === 'string' ? { sessionTarget: value.sessionTarget } : {}),
    ...(typeof value.wakeMode === 'string' ? { wakeMode: value.wakeMode } : {}),
    ...(isPlainObject(value.delivery) ? { delivery: value.delivery as OpenClawCronStoreJob['delivery'] } : {}),
    ...(payload ? { payload } : {}),
    ...(value.failureAlert !== undefined ? { failureAlert: value.failureAlert } : {}),
    ...(isPlainObject(value.state) ? { state: value.state } : {}),
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
    ...(typeof value.createdAtMs === 'number' ? { createdAtMs: value.createdAtMs } : {}),
    ...(typeof value.updatedAtMs === 'number' ? { updatedAtMs: value.updatedAtMs } : {}),
    ...(isPlainObject(value.metadata) ? { metadata: value.metadata as RuntimeMetadata } : {}),
  }
}

export function cronJobIdFromCliResult(value: unknown): string | undefined {
  return firstString(
    getJsonPath(value, ['id']),
    getJsonPath(value, ['jobId']),
    getJsonPath(value, ['job', 'id']),
    getJsonPath(value, ['cronJob', 'id']),
    getJsonPath(value, ['payload', 'id']),
    getJsonPath(value, ['payload', 'job', 'id']),
    getJsonPath(value, ['result', 'id']),
    getJsonPath(value, ['result', 'job', 'id']),
  )
}

export function extractCronRuns(raw: string, jobId: string): CronRun[] {
  const parsed = parseJsonValue(raw)
  const candidates = cronRunCandidates(parsed)
  const source = candidates.length > 0 ? candidates : parseJsonLines(raw)
  const runs = source
    .map((entry) => normalizeOpenClawCronRun(entry, jobId))
    .filter((run): run is CronRun => run !== null)
  runs.sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? ''))
  return runs
}

export function cronRunCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!isPlainObject(value)) return []
  for (const key of ['runs', 'items', 'results', 'data']) {
    const candidate = value[key]
    if (Array.isArray(candidate)) return candidate
  }
  const payload = value.payload
  if (Array.isArray(payload)) return payload
  if (isPlainObject(payload)) return cronRunCandidates(payload)
  return typeof value.runId === 'string' || typeof value.id === 'string' ? [value] : []
}

export function normalizeOpenClawCronRun(value: unknown, requestedJobId: string): CronRun | null {
  if (!isPlainObject(value)) return null
  const runJobId = firstString(value.jobId, value.cronJobId) ?? requestedJobId
  if (runJobId !== requestedJobId) return null
  return {
    id: firstString(value.runId, value.id) ?? `run-${Date.now()}`,
    jobId: requestedJobId,
    status: normalizeCronRunStatus(firstString(value.status)),
    startedAt: firstString(value.startedAt, value.timestamp, value.createdAt),
    endedAt: firstString(value.endedAt, value.finishedAt),
    output: firstString(value.output, value.stdout),
    error: firstString(value.error, value.stderr),
  }
}

export function readCronRuns(jobId: string, limit = 50): CronRun[] {
  const path = getOpenClawPath('cron', 'runs', `${jobId}.jsonl`)
  if (!existsSync(path)) return []
  const entries: CronRun[] = []
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as OpenClawCronRunEntry
      if (!entry.jobId || entry.jobId !== jobId) continue
      entries.push({
        id: entry.runId ?? entry.id ?? `run-${entries.length + 1}`,
        jobId,
        status: normalizeCronRunStatus(entry.status),
        startedAt: entry.startedAt ?? entry.timestamp,
        endedAt: entry.endedAt,
        output: entry.output,
        error: entry.error,
      })
    } catch {
      // skip malformed run rows
    }
  }
  entries.sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? ''))
  return entries.slice(0, limit)
}

export function normalizeCronRunStatus(status: string | undefined): CronRun['status'] {
  switch (status) {
    case 'queued':
    case 'running':
    case 'succeeded':
    case 'failed':
    case 'cancelled':
      return status
    case 'success':
      return 'succeeded'
    case 'failure':
      return 'failed'
    default:
      return 'succeeded'
  }
}
