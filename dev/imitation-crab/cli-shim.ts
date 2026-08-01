/**
 * CLI shim — handles `openclaw cron|message|gateway` commands.
 * Reads/writes to $OPENCLAW_HOME for cron operations.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'

import { IMITATION_CRAB_MODELS } from './model-catalog'

/** 1x1 transparent PNG — enough for the mock to return a real image file. */
const ONE_PX_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

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

function parseTools(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const tools = value.split(/[,\s]+/).map(tool => tool.trim()).filter(Boolean)
  return tools.length > 0 ? Array.from(new Set(tools)) : undefined
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
        const toolsAllow = parseTools(getFlag('tools'))
        const job: Record<string, unknown> = {
          id,
          name,
          enabled: !hasFlag('disabled'),
          createdAt: new Date().toISOString(),
        }

        if (getFlag('cron')) job.schedule = { kind: 'cron', expr: getFlag('cron'), tz: getFlag('tz') }
        else if (getFlag('every')) job.schedule = { kind: 'every', expr: getFlag('every') }
        else if (getFlag('at')) job.schedule = { kind: 'at', expr: getFlag('at') }

        if (getFlag('session')) {
          job.sessionTarget = getFlag('session')
          job.delivery = { mode: getFlag('session') === 'main' ? 'announce' : 'none' }
        }
        if (getFlag('system-event')) {
          job.payload = { kind: 'systemEvent', text: getFlag('system-event') }
        } else if (getFlag('message')) {
          job.payload = {
            kind: 'agentTurn',
            message: getFlag('message'),
            ...(toolsAllow ? { toolsAllow } : {}),
          }
        }
        if (getFlag('wake')) job.wakeMode = getFlag('wake')

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

      case 'show': {
        const jobId = args[2]
        const data = readJobs()
        const job = data.jobs.find(j => j.id === jobId || j.name === jobId)
        if (!job) {
          console.error(`Job ${jobId} not found`)
          process.exit(1)
        }
        if (hasFlag('json')) {
          process.stdout.write(JSON.stringify(job))
        } else {
          console.log(`${job.id}\t${job.name}\t${job.enabled ? 'enabled' : 'disabled'}`)
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
        if (getFlag('session')) job.sessionTarget = getFlag('session')
        if (getFlag('wake')) job.wakeMode = getFlag('wake')
        if (getFlag('system-event')) {
          job.payload = { kind: 'systemEvent', text: getFlag('system-event') }
        } else if (getFlag('message')) {
          const existingPayload = typeof job.payload === 'object' && job.payload !== null ? job.payload as Record<string, unknown> : {}
          const toolsAllow = parseTools(getFlag('tools'))
          job.payload = {
            ...existingPayload,
            kind: 'agentTurn',
            message: getFlag('message'),
            ...(toolsAllow ? { toolsAllow } : {}),
          }
        } else if (getFlag('tools')) {
          const existingPayload = typeof job.payload === 'object' && job.payload !== null ? job.payload as Record<string, unknown> : {}
          job.payload = { ...existingPayload, toolsAllow: parseTools(getFlag('tools')) }
        }
        if (hasFlag('clear-tools') && typeof job.payload === 'object' && job.payload !== null) {
          delete (job.payload as Record<string, unknown>).toolsAllow
        }

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

      case 'runs': {
        const jobId = getFlag('id') || args[2]
        const limit = Number.parseInt(getFlag('limit') || '50', 10)
        const runsPath = join(OPENCLAW_HOME, 'cron', 'runs', `${jobId}.jsonl`)
        if (!existsSync(runsPath)) break
        const lines = readFileSync(runsPath, 'utf-8').split('\n').filter(Boolean)
        process.stdout.write(lines.slice(-limit).join('\n'))
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
  } else if (command === 'models' && subcommand === 'list') {
    process.stdout.write(JSON.stringify({ models: IMITATION_CRAB_MODELS }))
  } else if (command === 'infer' && subcommand === 'image') {
    const action = args[2]
    if (action === 'providers') {
      process.stdout.write(JSON.stringify([
        {
          id: 'openai', label: 'OpenAI', available: true, configured: true, selected: true,
          defaultModel: 'gpt-image-2', models: ['gpt-image-2', 'gpt-image-1.5'],
          capabilities: { generate: { maxCount: 4, supportsSize: true }, output: { formats: ['png', 'jpeg', 'webp'] } },
        },
        {
          id: 'google', label: 'Google Gemini', available: true, configured: true,
          defaultModel: 'gemini-3.1-flash-image-preview', models: ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'],
          capabilities: { generate: { maxCount: 4 } },
        },
      ]))
    } else if (action === 'generate' || action === 'edit') {
      const output = getFlag('output') || join(OPENCLAW_HOME, `mock-image-${randomUUID()}.png`)
      mkdirSync(dirname(output), { recursive: true })
      writeFileSync(output, Buffer.from(ONE_PX_PNG_BASE64, 'base64'))
      const model = getFlag('model')
      process.stdout.write(JSON.stringify({
        images: [{ filePath: output, mimeType: 'image/png', width: 1024, height: 1024, provider: model?.split('/')[0] ?? 'openai', model: model ?? 'gpt-image-2' }],
      }))
    } else {
      console.error(`Unknown infer image action: ${action || ''}`)
      process.exit(1)
    }
  } else {
    console.error(`Unknown command: ${command} ${subcommand || ''}`)
    console.error('Supported: cron (list|add|edit|rm|run), message send, gateway restart, models list, infer image (providers|generate|edit)')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
