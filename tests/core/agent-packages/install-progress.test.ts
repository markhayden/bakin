/**
 * Install progress jobs (#895): lifecycle, SSE emission, byte throttling.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-install-progress-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

const broadcasts: Array<Record<string, unknown>> = []
mock.module('../../../src/core/sse', () => ({
  broadcast: (payload: Record<string, unknown>) => { broadcasts.push(payload) },
}))

import { getInstallJob, startInstallJob } from '../../../src/core/agent-packages/install-progress'
import { waitUntil } from '../../helpers/wait'

const eventsNamed = (name: string) => broadcasts.filter((b) => b.event === name)

beforeEach(() => {
  broadcasts.length = 0
})

describe('startInstallJob', () => {
  it('runs the job, stores the terminal result, and emits started/done', async () => {
    const job = startInstallJob({
      kind: 'package',
      title: 'github:x/y#packs/demo',
      run: async (progress) => {
        progress({ stage: 'fetch-source', message: 'Fetching…' })
        return { body: { ok: true, result: { packageId: 'demo' } }, status: 200 }
      },
    })
    expect(job.status).toBe('running')
    expect(eventsNamed('packages.install_started')).toHaveLength(1)

    await waitUntil(() => getInstallJob(job.id)?.status === 'done', { label: 'job done' })
    const finished = getInstallJob(job.id)!
    expect(finished.result).toEqual({ ok: true, result: { packageId: 'demo' } })
    expect(finished.resultStatus).toBe(200)
    expect(eventsNamed('packages.install_done')).toHaveLength(1)
    expect(eventsNamed('packages.install_progress')[0]).toMatchObject({ jobId: job.id, stage: 'fetch-source' })
  })

  it('a throwing run marks the job failed and emits install_failed', async () => {
    const job = startInstallJob({
      kind: 'agent-package',
      title: 'github:x/y#agents/demo',
      run: async () => { throw new Error('source failed validation') },
    })
    await waitUntil(() => getInstallJob(job.id)?.status === 'failed', { label: 'job failed' })
    expect(getInstallJob(job.id)!.error).toContain('source failed validation')
    expect(eventsNamed('packages.install_failed')[0]).toMatchObject({ jobId: job.id, error: 'source failed validation' })
  })

  it('byte-only churn is throttled per item; stage changes always emit; terminal bytes emit', async () => {
    const job = startInstallJob({
      kind: 'package',
      title: 'throttle-test',
      run: async (progress) => {
        // 50 rapid byte updates for one item — throttled to ~1 within the window.
        for (let i = 1; i <= 50; i++) {
          progress({ stage: 'models', message: 'Downloading model m (1/1)…', item: 'm', receivedBytes: i * 1_000, totalBytes: 100_000 })
        }
        // Terminal bytes (received == total) always emit.
        progress({ stage: 'models', message: 'Downloading model m (1/1)…', item: 'm', receivedBytes: 100_000, totalBytes: 100_000 })
        // A different stage emits regardless of the byte throttle.
        progress({ stage: 'finalize', message: 'Recording install…' })
        return { body: { ok: true } }
      },
    })
    await waitUntil(() => getInstallJob(job.id)?.status === 'done', { label: 'job done' })
    const progressEvents = eventsNamed('packages.install_progress')
    const byteEvents = progressEvents.filter((e) => e.item === 'm')
    expect(byteEvents.length).toBeLessThanOrEqual(3) // first + maybe one window + terminal
    expect(byteEvents.at(-1)).toMatchObject({ receivedBytes: 100_000 })
    expect(progressEvents.some((e) => e.stage === 'finalize')).toBe(true)
    // The poll fallback always sees the latest update regardless of throttling.
    expect(getInstallJob(job.id)!.lastUpdate).toMatchObject({ stage: 'finalize' })
  })

  it('carries a non-200 result status (409 collision contract)', async () => {
    const job = startInstallJob({
      kind: 'package',
      title: 'conflict-test',
      run: async () => ({ body: { ok: false, error: 'projection collision' }, status: 409 }),
    })
    await waitUntil(() => getInstallJob(job.id)?.status === 'done', { label: 'job done' })
    expect(getInstallJob(job.id)!.resultStatus).toBe(409)
  })
})
