/**
 * CLI helpers for `beacon schedule` commands.
 * Each function calls the Beacon schedule API and formats output.
 */

const BASE_URL = `http://localhost:${process.env.PORT || 3737}`

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/plugins/schedule${path}`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
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
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function apiPut<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/plugins/schedule${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
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
    isBeaconJob: boolean
    enabled: boolean
  }>
}

export async function cmdScheduleList(opts: {
  all?: boolean
  agent?: string
  json?: boolean
}): Promise<void> {
  const data = await apiGet<ListResult>('/jobs')
  let jobs = data.jobs

  if (!opts.all) jobs = jobs.filter(j => j.isBeaconJob)
  if (opts.agent) jobs = jobs.filter(j => j.agentId === opts.agent)

  if (opts.json) {
    console.log(JSON.stringify(jobs, null, 2))
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
  const data = await apiPost<{ ok: boolean; jobId: string; cron: string; human: string }>('/jobs', {
    name: opts.name,
    schedule: opts.schedule,
    agentId: opts.agent,
    workflowId: opts.workflow,
    taskPrompt: opts.prompt,
  })
  console.log(`Created schedule "${opts.name}" (${data.human}) — job ID: ${data.jobId}`)
}

export async function cmdSchedulePause(jobId: string, opts: {
  until?: string
  skip?: number
}): Promise<void> {
  if (opts.skip) {
    await apiPost('/jobs/pause', { jobId, action: 'skip', skipN: opts.skip })
    console.log(`Skipping next ${opts.skip} runs for ${jobId}`)
  } else {
    await apiPost('/jobs/pause', { jobId, action: 'pause', pauseUntil: opts.until })
    console.log(`Paused ${jobId}${opts.until ? ` until ${opts.until}` : ''}`)
  }
}

export async function cmdScheduleResume(jobId: string): Promise<void> {
  await apiPost('/jobs/pause', { jobId, action: 'resume' })
  console.log(`Resumed ${jobId}`)
}

export async function cmdScheduleRemove(jobId: string): Promise<void> {
  await apiPost('/jobs/delete', { jobId })
  console.log(`Removed ${jobId}`)
}

export async function cmdScheduleRun(jobId: string): Promise<void> {
  await apiPost('/jobs/run-now', { jobId })
  console.log(`Triggered immediate run for ${jobId}`)
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

export async function cmdScheduleRuns(jobId: string, opts: {
  limit?: number
}): Promise<void> {
  const data = await apiGet<RunsResult>(`/runs?jobId=${jobId}&limit=${opts.limit ?? 20}`)

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
