/**
 * CLI shim — handles `openclaw cron|message|gateway` commands.
 * Reads/writes to $OPENCLAW_HOME for cron operations.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || join(require('os').homedir(), '.openclaw')

function getJobsPath(): string {
  return join(OPENCLAW_HOME, 'cron', 'jobs.json')
}

function readJobs(): { version: number; jobs: Array<Record<string, unknown>> } {
  const path = getJobsPath()
  if (!existsSync(path)) return { version: 1, jobs: [] }
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function writeJobs(data: { version: number; jobs: Array<Record<string, unknown>> }): void {
  const path = getJobsPath()
  mkdirSync(join(OPENCLAW_HOME, 'cron'), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
}

// Parse CLI args
const args = process.argv.slice(2)
const command = args[0]
const subcommand = args[1]

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return args[idx + 1]
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`)
}

async function main(): Promise<void> {
  if (command === 'cron') {
    switch (subcommand) {
      case 'list': {
        const data = readJobs()
        if (hasFlag('json')) {
          process.stdout.write(JSON.stringify(data.jobs))
        } else {
          for (const job of data.jobs) {
            console.log(`${job.id}\t${job.name}\t${job.enabled ? 'enabled' : 'disabled'}`)
          }
        }
        break
      }

      case 'add': {
        const name = getFlag('name') || 'unnamed'
        const id = randomUUID().slice(0, 8)
        const job: Record<string, unknown> = {
          id,
          name,
          enabled: true,
          createdAt: new Date().toISOString(),
        }

        if (getFlag('cron')) job.schedule = { kind: 'cron', expr: getFlag('cron'), tz: getFlag('tz') }
        else if (getFlag('every')) job.schedule = { kind: 'every', expr: getFlag('every') }
        else if (getFlag('at')) job.schedule = { kind: 'at', expr: getFlag('at') }

        if (getFlag('session')) job.delivery = { mode: getFlag('session') === 'main' ? 'announce' : 'none' }
        if (getFlag('message')) job.payload = { message: getFlag('message') }

        const data = readJobs()
        data.jobs.push(job)
        writeJobs(data)

        if (hasFlag('json')) {
          process.stdout.write(JSON.stringify({ id }))
        } else {
          console.log(`Created job ${id}`)
        }
        break
      }

      case 'edit': {
        const jobId = args[2]
        const data = readJobs()
        const job = data.jobs.find(j => j.id === jobId)
        if (!job) {
          console.error(`Job ${jobId} not found`)
          process.exit(1)
        }

        if (getFlag('name')) job.name = getFlag('name')
        if (getFlag('cron')) job.schedule = { kind: 'cron', expr: getFlag('cron'), tz: getFlag('tz') }
        if (getFlag('every')) job.schedule = { kind: 'every', expr: getFlag('every') }
        if (getFlag('at')) job.schedule = { kind: 'at', expr: getFlag('at') }
        if (hasFlag('enable')) job.enabled = true
        if (hasFlag('disable')) job.enabled = false
        if (getFlag('tz') && job.schedule) (job.schedule as Record<string, unknown>).tz = getFlag('tz')

        job.updatedAt = new Date().toISOString()
        writeJobs(data)
        console.log(`Updated job ${jobId}`)
        break
      }

      case 'rm': {
        const jobId = args[2]
        const data = readJobs()
        data.jobs = data.jobs.filter(j => j.id !== jobId)
        writeJobs(data)
        console.log(`Removed job ${jobId}`)
        break
      }

      case 'run': {
        const jobId = args[2]
        const runsDir = join(OPENCLAW_HOME, 'cron', 'runs')
        mkdirSync(runsDir, { recursive: true })
        const runEntry = {
          runId: `run-${randomUUID().slice(0, 8)}`,
          jobId,
          timestamp: new Date().toISOString(),
          status: 'success',
          duration: Math.floor(Math.random() * 5000) + 1000,
        }
        appendFileSync(join(runsDir, `${jobId}.jsonl`), JSON.stringify(runEntry) + '\n')
        console.log(`Ran job ${jobId} (mock)`)
        break
      }

      default:
        console.error(`Unknown cron subcommand: ${subcommand}`)
        process.exit(1)
    }
  } else if (command === 'message' && subcommand === 'send') {
    const channel = getFlag('channel') || 'unknown'
    const target = getFlag('target') || 'unknown'
    const message = getFlag('message') || ''
    console.log(`[mock] Message sent to ${channel}:${target}: ${message.slice(0, 100)}`)
  } else if (command === 'gateway' && subcommand === 'restart') {
    console.log('[mock] Gateway restart acknowledged')
  } else {
    console.error(`Unknown command: ${command} ${subcommand || ''}`)
    console.error('Supported: cron (list|add|edit|rm|run), message send, gateway restart')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
