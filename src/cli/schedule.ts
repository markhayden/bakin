/**
 * CLI helpers for `bakin schedule` commands.
 * Each function calls the Bakin schedule API and formats output.
 */
import { formatApiError } from '../core/cli/api-error'

const BASE_URL = `http://localhost:${process.env.PORT || 3737}`

type ScheduleActionData = import('../core/cli/ui/readonly').ScheduleActionData

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/plugins/schedule${path}`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(formatApiError(res.status, text, { prefix: 'API error' }))
  }
  return res.json() as Promise<T>
}

async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/plugins/schedule${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(formatApiError(res.status, text, { prefix: 'API error' }))
  }
  return res.json() as Promise<T>
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/plugins/schedule${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(formatApiError(res.status, text, { prefix: 'API error' }))
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

interface ListResult {
  jobs: Array<{
    id: string
    displayName: string
    agentId?: string
    humanSchedule: string
    paused: boolean
    isBakinJob: boolean
    enabled: boolean
  }>
}

async function printScheduleListTui(jobs: ListResult['jobs']): Promise<void> {
  const [{ ScheduleListReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../core/cli/ui/readonly'),
    import('../core/cli/ui/render-to-string'),
    import('react'),
  ])
  console.log(renderToString(createElement(ScheduleListReport, { jobs })))
}

async function printScheduleActionTui(action: ScheduleActionData): Promise<void> {
  const [{ ScheduleActionReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../core/cli/ui/readonly'),
    import('../core/cli/ui/render-to-string'),
    import('react'),
  ])
  console.log(renderToString(createElement(ScheduleActionReport, { action })))
}

async function printScheduleAction(action: ScheduleActionData, plainText: string): Promise<void> {
  if (process.stdout.isTTY) {
    await printScheduleActionTui(action)
    return
  }
  console.log(plainText)
}

export async function cmdScheduleList(opts: {
  all?: boolean
  agent?: string
  json?: boolean
}): Promise<void> {
  const data = await apiGet<ListResult>('/')
  let jobs = data.jobs

  if (!opts.all) jobs = jobs.filter(j => j.isBakinJob)
  if (opts.agent) jobs = jobs.filter(j => j.agentId === opts.agent)

  if (opts.json) {
    console.log(JSON.stringify(jobs, null, 2))
    return
  }

  if (process.stdout.isTTY) {
    await printScheduleListTui(jobs)
    return
  }

  if (jobs.length === 0) {
    console.log('No scheduled jobs found.')
    return
  }

  console.log(`${'Name'.padEnd(25)} ${'Agent'.padEnd(10)} ${'Schedule'.padEnd(25)} ${'Status'.padEnd(10)}`)
  console.log('-'.repeat(75))
  for (const job of jobs) {
    const status = job.paused ? 'paused' : job.enabled ? 'active' : 'disabled'
    const agent = job.agentId ?? '—'
    console.log(`${job.displayName.padEnd(25)} ${agent.padEnd(10)} ${job.humanSchedule.padEnd(25)} ${status.padEnd(10)}`)
  }
}

export async function cmdScheduleAdd(opts: {
  name: string
  schedule: string
  agent?: string
  workflow?: string
  prompt?: string
}): Promise<void> {
  const data = await apiPost<{ ok: boolean; jobId: string; cron: string; human: string }>('/', {
    name: opts.name,
    schedule: opts.schedule,
    agentId: opts.agent,
    workflowId: opts.workflow,
    taskPrompt: opts.prompt,
  })
  await printScheduleAction({
    action: 'created',
    jobId: data.jobId,
    name: opts.name,
    message: `Created schedule ${opts.name}.`,
    detail: `Runs ${data.human}. Cron: ${data.cron}.`,
  }, `Created schedule "${opts.name}" (${data.human}) — job ID: ${data.jobId}`)
}

export async function cmdSchedulePause(jobId: string, opts: {
  until?: string
  skip?: number
}): Promise<void> {
  if (opts.skip) {
    await apiPost(`/${jobId}/pause`, { action: 'skip', skipN: opts.skip })
    await printScheduleAction({
      action: 'skipped',
      jobId,
      message: `Skipping next ${opts.skip} runs for ${jobId}.`,
    }, `Skipping next ${opts.skip} runs for ${jobId}`)
  } else {
    await apiPost(`/${jobId}/pause`, { action: 'pause', pauseUntil: opts.until })
    await printScheduleAction({
      action: 'paused',
      jobId,
      message: `Paused ${jobId}${opts.until ? ` until ${opts.until}` : ''}.`,
    }, `Paused ${jobId}${opts.until ? ` until ${opts.until}` : ''}`)
  }
}

export async function cmdScheduleResume(jobId: string): Promise<void> {
  await apiPost(`/${jobId}/pause`, { action: 'resume' })
  await printScheduleAction({
    action: 'resumed',
    jobId,
    message: `Resumed ${jobId}.`,
  }, `Resumed ${jobId}`)
}

export async function cmdScheduleRemove(jobId: string): Promise<void> {
  await apiDelete(`/${jobId}`)
  await printScheduleAction({
    action: 'removed',
    jobId,
    message: `Removed ${jobId}.`,
  }, `Removed ${jobId}`)
}

export async function cmdScheduleRun(jobId: string): Promise<void> {
  await apiPost(`/${jobId}/run`, {})
  await printScheduleAction({
    action: 'triggered',
    jobId,
    message: `Triggered immediate run for ${jobId}.`,
  }, `Triggered immediate run for ${jobId}`)
}

interface RunsResult {
  runs: Array<{
    runId: string
    timestamp: string
    status: string
    taskId?: string
    error?: string
  }>
}

async function printScheduleRunsTui(jobId: string, runs: RunsResult['runs']): Promise<void> {
  const [{ ScheduleRunsReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../core/cli/ui/readonly'),
    import('../core/cli/ui/render-to-string'),
    import('react'),
  ])
  console.log(renderToString(createElement(ScheduleRunsReport, { jobId, runs })))
}

export async function cmdScheduleRuns(jobId: string, opts: {
  limit?: number
}): Promise<void> {
  const data = await apiGet<RunsResult>(`/${jobId}/runs?limit=${opts.limit ?? 20}`)

  if (process.stdout.isTTY) {
    await printScheduleRunsTui(jobId, data.runs)
    return
  }

  if (data.runs.length === 0) {
    console.log(`No run history for ${jobId}`)
    return
  }

  console.log(`${'Time'.padEnd(22)} ${'Status'.padEnd(10)} ${'Task'.padEnd(12)} ${'Error'}`)
  console.log('-'.repeat(60))
  for (const run of data.runs) {
    const time = new Date(run.timestamp).toLocaleString()
    const task = run.taskId ?? '—'
    const error = run.error ?? ''
    console.log(`${time.padEnd(22)} ${run.status.padEnd(10)} ${task.padEnd(12)} ${error}`)
  }
}
