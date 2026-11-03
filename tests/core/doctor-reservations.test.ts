/**
 * Incident reservations (#896 D3.1): a synchronous in-process admission map
 * `incidentId → ownerToken` taken BEFORE an operation starts, so two
 * different repairs (or a repair and a delegation) can never work the same
 * incident at once, while identical requests still attach.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
}))

const {
  heldIncidentIds,
  releaseIncidents,
  reserveIncidents,
  resetIncidentReservationsForTests,
  transferIncidents,
} = await import('../../src/core/doctor-reservations')

beforeEach(() => resetIncidentReservationsForTests())

describe('reserveIncidents', () => {
  it('grants free incidents and records the owner', () => {
    expect(reserveIncidents(['a', 'b'], 'repair:p1:x')).toEqual({ status: 'granted' })
    expect([...heldIncidentIds()].sort()).toEqual(['a', 'b'])
  })

  it('attaches when the SAME owner already holds every overlapping incident (identical requests attach)', () => {
    reserveIncidents(['a', 'b'], 'repair:p1:x')
    expect(reserveIncidents(['a', 'b'], 'repair:p1:x')).toEqual({ status: 'attached' })
    // A superset under the same owner is granted for the new ids and attached for the held ones.
    expect(reserveIncidents(['a', 'b', 'c'], 'repair:p1:x')).toEqual({ status: 'attached' })
    expect(heldIncidentIds().has('c')).toBe(true)
  })

  it('refuses any overlap with a DIFFERENT owner and names the overlap', () => {
    reserveIncidents(['a', 'b'], 'repair:p1:x')
    expect(reserveIncidents(['b', 'c'], 'delegation:ui')).toEqual({ status: 'refused', overlapping: ['b'], heldBy: 'repair:p1:x' })
    // A refused request reserves NOTHING — not even the free ids.
    expect(heldIncidentIds().has('c')).toBe(false)
  })

  it('transfers a subset atomically to a new owner and keeps the rest', () => {
    reserveIncidents(['a', 'b', 'c'], 'escalation:1')
    expect(transferIncidents(['a', 'b'], 'escalation:1', 'repair:p2:y')).toBe(true)
    expect(reserveIncidents(['a'], 'repair:p2:y')).toEqual({ status: 'attached' })
    expect(reserveIncidents(['c'], 'repair:p2:y')).toEqual({ status: 'refused', overlapping: ['c'], heldBy: 'escalation:1' })
    // A transfer of ids the source does not hold does nothing and reports it.
    expect(transferIncidents(['c', 'zzz'], 'repair:p2:y', 'other')).toBe(false)
    expect(reserveIncidents(['c'], 'other')).toEqual({ status: 'refused', overlapping: ['c'], heldBy: 'escalation:1' })
  })

  it('releases by owner — a subset, or everything the owner holds', () => {
    reserveIncidents(['a', 'b', 'c'], 'escalation:1')
    releaseIncidents('escalation:1', ['a'])
    expect([...heldIncidentIds()].sort()).toEqual(['b', 'c'])
    // Releasing an id another owner holds is a no-op.
    reserveIncidents(['a'], 'repair:p1:x')
    releaseIncidents('escalation:1', ['a'])
    expect(heldIncidentIds().has('a')).toBe(true)
    releaseIncidents('escalation:1')
    expect([...heldIncidentIds()]).toEqual(['a'])
  })
})
