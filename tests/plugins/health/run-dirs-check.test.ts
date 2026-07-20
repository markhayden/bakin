/**
 * dispatch.run-dirs system check (same-agent-concurrency D5): evidence from
 * the sweep aggregate only — Unknown before the first sweep, healthy under
 * budget, action_required over budget. Never walks the tree.
 */
import { describe, it, expect, mock, afterAll } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-run-dirs-check-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

let statsValue: { count: number; sizeBytes: number; sweptLastTick: number; updatedAt: number } | null = null
mock.module('../../../src/core/run-workspace', () => ({
  getRunWorkspaceStats: () => statsValue,
  sweepRunWorkspaces: mock(() => statsValue),
}))
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    dispatch: { runDirMaxTotalGb: 1000 / (1024 * 1024 * 1024), runDirRetentionDays: 7 },
    watchdog: { intervalMs: 60_000 },
  }),
}))
mock.module('../../../src/core/dispatch-registry', () => ({ getInFlightTurn: () => undefined }))
mock.module('../../../src/core/task-store', () => ({ getTask: () => null }))

import { checkRunDirs } from '../../../plugins/health/lib/system-checks/run-dirs'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('dispatch.run-dirs check', () => {
  it('reports Unknown (never healthy) before the first sweep of the boot', async () => {
    statsValue = null
    const result = await checkRunDirs()
    if (!('observations' in result)) throw new Error('expected observations')
    expect(result.observations[0].status).toBe('unknown')
  })

  it('healthy under budget with the aggregate summary', async () => {
    statsValue = { count: 3, sizeBytes: 500, sweptLastTick: 1, updatedAt: Date.now() }
    const result = await checkRunDirs()
    if (!('observations' in result)) throw new Error('expected observations')
    expect(result.observations[0].status).toBe('healthy')
    expect(result.observations[0].summary).toContain('3 run dir(s)')
  })

  it('over budget escalates action_required with the sweep repair resolution', async () => {
    statsValue = { count: 9, sizeBytes: 5000, sweptLastTick: 0, updatedAt: Date.now() }
    const result = await checkRunDirs()
    if (!('observations' in result)) throw new Error('expected observations')
    const obs = result.observations[0] as { status: string; incident?: { disposition?: string; class?: string; resolution?: { actionId?: string } } }
    expect(obs.status).toBe('warning')
    expect(obs.incident?.disposition).toBe('action_required')
    expect(obs.incident?.class).toBe('cleanup_backlog')
    expect(obs.incident?.resolution?.actionId).toBe('sweep-run-dirs')
  })
})
