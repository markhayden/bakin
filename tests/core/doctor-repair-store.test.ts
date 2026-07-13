import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createDoctorRepairRequest,
  getDoctorRepairRequest,
  legacyRepairRequestArchiveRoot,
  listDoctorRepairRequests,
  repairRequestV2Root,
} from '../../src/core/doctor-repair-store'

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
