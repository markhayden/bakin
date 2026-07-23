/**
 * runHealthCheck contract-failure surfacing (2026-07-22): when a check's
 * output fails validation, the FIELD PATHS must reach the verification
 * card, the execution record, and the log — the bare generic message
 * dead-ended a field diagnosis with nothing to act on.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-doctor-checks-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const logWarn = mock()
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: logWarn, error: mock(), debug: mock() }),
}))
mock.module('../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: mock(), warn: logWarn, error: mock(), debug: mock() }),
}))

import type { HealthCheckDef } from '../../packages/core/src/plugin-types'

function defWith(run: () => Promise<unknown>): HealthCheckDef {
  return {
    id: 'git.worktrees',
    localId: 'worktrees',
    name: 'Git worktree registry',
    description: 'test',
    owner: { kind: 'plugin', id: 'git', label: 'Git' },
    group: { key: 'git', label: 'Git' },
    run,
  } as unknown as HealthCheckDef
}

describe('runHealthCheck surfaces contract-validation issues', () => {
  it('names the failing field path on the card, in the execution record, and in the log', async () => {
    // Raw literal bypasses the clamping builders — a 600-char summary is
    // exactly the class that produced the useless generic Verify card.
    const def = defWith(async () => ({
      outcome: 'observed',
      observations: [{ key: 'registry', status: 'healthy', summary: 'x'.repeat(600) }],
    }))

    // Dynamic import: doctor-checks binds its logger at module scope, so
    // it must load AFTER the mock.module overlays (static imports hoist).
    const { runHealthCheck } = await import('../../src/core/doctor-checks')
    const result = await runHealthCheck(def)

    expect(result.execution.outcome).toBe('invalid')
    if (result.execution.outcome !== 'invalid') throw new Error('expected invalid outcome')
    expect(result.execution.error?.message).toContain('observations.0.summary')

    const observation = result.observations[0]!
    expect(observation.status).toBe('unknown')
    expect(observation.detail).toContain('observations.0.summary')
    expect(observation.incident?.impact).toContain('observations.0.summary')

    expect(logWarn).toHaveBeenCalledWith(
      'health check output failed contract validation',
      expect.objectContaining({ checkId: 'git.worktrees' }),
    )
  })
})
