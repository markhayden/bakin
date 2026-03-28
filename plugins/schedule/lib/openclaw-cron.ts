/**
 * Wrappers around the `openclaw cron` CLI commands.
 * Each function calls execFile and returns structured results.
 */
import { execFile } from 'child_process'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('schedule:openclaw')

interface ExecResult {
  stdout: string
  stderr: string
}

function exec(args: string[]): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile('openclaw', ['cron', ...args], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        log.error('openclaw cron command failed', { args, error: err.message, stderr })
        reject(new Error(`openclaw cron ${args[0]} failed: ${err.message}`))
        return
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

/** Add a new cron job. Returns the job ID from OpenClaw. */
export async function cronAdd(opts: {
  name: string
  cron?: string
  every?: string
  at?: string
  session?: 'main' | 'isolated'
  webhookUrl?: string
  tz?: string
}): Promise<string> {
  const args = ['add', '--name', opts.name, '--json']

  if (opts.cron) args.push('--cron', opts.cron)
  else if (opts.every) args.push('--every', opts.every)
  else if (opts.at) args.push('--at', opts.at)

  if (opts.session) args.push('--session', opts.session)
  if (opts.tz) args.push('--tz', opts.tz)

  // OpenClaw requires a payload — isolated sessions need --message
  args.push('--message', `beacon:schedule:${opts.name}`)
  // Skip announce delivery — the bridge handles notifications
  args.push('--no-deliver')

  const { stdout } = await exec(args)
  try {
    const result = JSON.parse(stdout)
    return result.id ?? result.jobId
  } catch {
    // Try to extract ID from plain text output
    const match = stdout.match(/(?:id|jobId)[:\s]+([a-zA-Z0-9_-]+)/)
    if (match) return match[1]
    throw new Error(`Could not parse job ID from openclaw output: ${stdout}`)
  }
}

/** Update an existing cron job. */
export async function cronEdit(jobId: string, opts: {
  name?: string
  cron?: string
  every?: string
  at?: string
  enabled?: boolean
  tz?: string
}): Promise<void> {
  const args = ['edit', jobId]

  if (opts.name) args.push('--name', opts.name)
  if (opts.cron) args.push('--cron', opts.cron)
  if (opts.every) args.push('--every', opts.every)
  if (opts.at) args.push('--at', opts.at)
  if (opts.enabled === false) args.push('--disable')
  if (opts.enabled === true) args.push('--enable')
  if (opts.tz) args.push('--tz', opts.tz)

  await exec(args)
}

/** Remove a cron job. */
export async function cronRemove(jobId: string): Promise<void> {
  await exec(['rm', jobId])
}

/** Run a cron job immediately. */
export async function cronRun(jobId: string, force = false): Promise<void> {
  const args = ['run', jobId]
  if (force) args.push('--force')
  await exec(args)
}

/** List all cron jobs (JSON output). */
export async function cronList(): Promise<unknown[]> {
  const { stdout } = await exec(['list', '--all', '--json'])
  try {
    const result = JSON.parse(stdout)
    return Array.isArray(result) ? result : result.jobs ?? []
  } catch {
    return []
  }
}
