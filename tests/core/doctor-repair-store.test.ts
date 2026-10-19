import { describe, expect, it, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const warn = mock((..._args: unknown[]) => {})
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn, error: mock() }),
}))

// Imported after the logger mock so the store's module-level logger is the mock.
const {
  DoctorRepairRequestNotFoundError,
  createDoctorRepairRequest,
  getDoctorRepairRequest,
  legacyRepairRequestArchiveRoot,
  listDoctorRepairRequests,
  openRepairWorkByIncident,
  repairRequestV2Root,
  updateDoctorRepairRequest,
} = await import('../../src/core/doctor-repair-store')

function plan() {
  return {
    planId: 'repair-plan-1', basedOnReportId: 'health-report-1',
    target: { type: 'all_actionable' as const, reportId: 'health-report-1' },
    createdAt: '2026-07-13T12:00:00.000Z', expiresAt: '2026-07-13T12:10:00.000Z', items: [],
  }
}

describe('versioned doctor repair request records', () => {
  it('never reads or rewrites the immutable v1 archive', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-repair-store-'))
    try {
      const legacyRoot = join(legacyRepairRequestArchiveRoot(dir), '2026-07')
      mkdirSync(legacyRoot, { recursive: true })
      const legacyPath = join(legacyRoot, 'legacy.json')
      const bytes = '{"legacy":"opaque bytes that v2 must never parse"}'
      writeFileSync(legacyPath, bytes)

      expect(listDoctorRepairRequests(dir)).toEqual([])
      expect(getDoctorRepairRequest(dir, 'legacy')).toBeNull()
      createDoctorRepairRequest(dir, { plan: plan(), incidentIds: ['health:search:down'], observationIds: ['health.search:engine'] })
      expect(readFileSync(legacyPath, 'utf8')).toBe(bytes)
      expect(repairRequestV2Root(dir)).not.toBe(legacyRepairRequestArchiveRoot(dir))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('round-trips only structured v2 identity', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-repair-store-'))
    try {
      const created = createDoctorRepairRequest(dir, {
        plan: plan(),
        incidentIds: ['health:search:down'],
        observationIds: ['health.search:engine'],
      })
      expect(created.version).toBe(2)
      expect(getDoctorRepairRequest(dir, created.id)).toEqual(created)
      expect(listDoctorRepairRequests(dir)).toEqual([created])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('request files are validated on read (#898)', () => {
  function withDir(run: (dir: string, shard: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-repair-store-'))
    try {
      const shard = join(repairRequestV2Root(dir), '2026-10')
      mkdirSync(shard, { recursive: true })
      run(dir, shard)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('one malformed file is skipped and logged; the others still list', () => {
    withDir((dir, shard) => {
      const good = createDoctorRepairRequest(dir, { plan: plan(), incidentIds: ['health:search:down'], observationIds: ['health.search:engine'] })
      writeFileSync(join(shard, 'not-json.json'), '{ nope')
      writeFileSync(join(shard, 'bad-date.json'), JSON.stringify({ ...good, id: 'bad-date', createdAt: 'yesterday' }))
      writeFileSync(join(shard, 'bad-ids.json'), JSON.stringify({ ...good, id: 'bad-ids', incidentIds: 'health:search:down' }))
      writeFileSync(join(shard, 'bad-status.json'), JSON.stringify({ ...good, id: 'bad-status', status: 'silenced' }))
      warn.mockClear()
      expect(listDoctorRepairRequests(dir).map((request) => request.id)).toEqual([good.id])
      expect(warn).toHaveBeenCalledTimes(4)
      expect(getDoctorRepairRequest(dir, 'bad-date')).toBeNull()
      expect(() => updateDoctorRepairRequest(dir, 'bad-date', (request) => request)).toThrow(DoctorRepairRequestNotFoundError)
    })
  })

  it('a pre-approvals request without kind or checkIds still reads with the legacy defaults', () => {
    withDir((dir, shard) => {
      const legacy = {
        version: 2, id: 'repair-legacy', status: 'sent',
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
        plan: plan(), incidentIds: ['health:search:down'], observationIds: [], taskId: 'task-1', events: [],
      }
      writeFileSync(join(shard, 'repair-legacy.json'), JSON.stringify(legacy))
      expect(getDoctorRepairRequest(dir, 'repair-legacy')).toEqual({ ...legacy, kind: 'delegate', checkIds: [] } as never)
    })
  })
})

describe('openRepairWorkByIncident', () => {
  it('indexes open requests with a task, newest first, and refreshes on every write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-repair-index-'))
    try {
      const a = createDoctorRepairRequest(dir, { incidentIds: ['i1'], observationIds: [] })
      expect(openRepairWorkByIncident(dir).size).toBe(0) // no task yet
      updateDoctorRepairRequest(dir, a.id, (r) => ({ ...r, taskId: 't1', status: 'sent' }))
      expect(openRepairWorkByIncident(dir).get('i1')).toEqual({ requestId: a.id, taskId: 't1' })
      updateDoctorRepairRequest(dir, a.id, (r) => ({ ...r, status: 'verified' }))
      expect(openRepairWorkByIncident(dir).has('i1')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a future-dated request works nothing until it comes due — the memo expires on its own', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-repair-index-'))
    try {
      const now = Date.now()
      const a = createDoctorRepairRequest(dir, { incidentIds: ['i1'], observationIds: [] })
      updateDoctorRepairRequest(dir, a.id, (r) => ({ ...r, taskId: 't1', status: 'sent', createdAt: new Date(now + 60_000).toISOString() }))
      expect(openRepairWorkByIncident(dir, now).has('i1')).toBe(false)
      expect(openRepairWorkByIncident(dir, now + 120_000).get('i1')?.taskId).toBe('t1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
