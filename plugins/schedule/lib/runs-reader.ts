/**
 * Reads cron run history from OpenClaw JSONL files.
 * Files stored at ~/.openclaw/cron/runs/<jobId>.jsonl
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../../../src/core/logger'
import type { RunEntry } from '../types'

const log = createLogger('schedule:runs')

const OPENCLAW_RUNS_DIR = join(
  process.env.HOME || '~',
  '.openclaw',
  'cron',
  'runs'
)

/** Read run history for a specific job. Returns newest-first. */
export function readRuns(jobId: string, limit = 50, runsDir?: string): RunEntry[] {
  const dir = runsDir ?? OPENCLAW_RUNS_DIR
  const path = join(dir, `${jobId}.jsonl`)

  if (!existsSync(path)) {
    return []
  }

  try {
    const raw = readFileSync(path, 'utf-8')
    const lines = raw.trim().split('\n').filter(Boolean)
    const entries: RunEntry[] = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as RunEntry
        // Ensure required fields
        if (entry.runId && entry.jobId && entry.timestamp) {
          entries.push(entry)
        }
      } catch {
        // Skip malformed lines
        log.debug('Skipping malformed run entry', { jobId, line: line.slice(0, 100) })
      }
    }

    // Sort newest-first and apply limit
    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    return entries.slice(0, limit)
  } catch (err) {
    log.warn('Failed to read run history', err, { jobId })
    return []
  }
}

/** Get the most recent run for a job. */
export function getLastRun(jobId: string, runsDir?: string): RunEntry | null {
  const runs = readRuns(jobId, 1, runsDir)
  return runs[0] ?? null
}
