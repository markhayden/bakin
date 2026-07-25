/**
 * Health ack store + re-fire rules (health trust overhaul, 2026-07-24).
 *
 * The "I know" verb: ack = silent until material change; snooze = silent
 * for a window. Tiered: action_required is snooze-only (max 7d) and
 * re-fires on ANY evidence change; acks re-fire on tier escalation or
 * resource-set change only — counts drifting within a tier stay silent.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-health-acks-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import {
  HealthAckStoreError,
  readAckRecords,
  removeAckRecord,
  resolveAckState,
  resourceFingerprint,
  writeAckRecord,
  type HealthAckRecord,
} from '../../src/core/health-acks'

const NOW = Date.parse('2026-07-24T12:00:00.000Z')
const acksPath = join(testDir, 'health', 'acks.json')

function ackRecord(overrides: Partial<HealthAckRecord> = {}): HealthAckRecord {
  return {
    incidentId: 'models:routing:premium-on-cheap-relay',
    mode: 'ack',
    at: new Date(NOW - 60_000).toISOString(),
    tierAtAck: 'watch',
    resourceFingerprint: 'agent:relay',
    ...overrides,
  }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('ack store', () => {
  it('round-trips records; missing file reads as empty', () => {
    expect(readAckRecords()).toEqual({})
    const record = ackRecord()
    writeAckRecord(record)
    expect(readAckRecords()[record.incidentId]).toEqual(record)
    expect(removeAckRecord(record.incidentId)).toBe(true)
    expect(readAckRecords()).toEqual({})
    expect(removeAckRecord('never-existed')).toBe(false)
  })

  it('REFUSES a permanent ack on an action_required incident — snooze only', () => {
    expect(() => writeAckRecord(ackRecord({ tierAtAck: 'action_required', mode: 'ack' })))
      .toThrow(HealthAckStoreError)
    // Snooze on action_required is allowed but capped at 7 days.
    const eightDays = new Date(NOW + 8 * 24 * 60 * 60 * 1000).toISOString()
    expect(() => writeAckRecord(ackRecord({
      tierAtAck: 'action_required',
      mode: 'snooze',
      at: new Date(NOW).toISOString(),
      until: eightDays,
      evidenceSha: 'abc',
    }))).toThrow(HealthAckStoreError)
  })

  it('snooze records require until', () => {
    expect(() => writeAckRecord(ackRecord({ mode: 'snooze' }))).toThrow(HealthAckStoreError)
  })

  it('a corrupt file surfaces as a typed error, never a crash or silent reset', () => {
    mkdirSync(join(testDir, 'health'), { recursive: true })
    writeFileSync(acksPath, '{ not json')
    expect(() => readAckRecords()).toThrow(HealthAckStoreError)
  })
})

describe('resourceFingerprint', () => {
  it('is order-independent and kind-scoped', () => {
    const a = resourceFingerprint([
      { kind: 'agent', id: 'relay' },
      { kind: 'task', id: 't1' },
    ])
    const b = resourceFingerprint([
      { kind: 'task', id: 't1' },
      { kind: 'agent', id: 'relay' },
    ])
    expect(a).toBe(b)
    expect(a).not.toBe(resourceFingerprint([{ kind: 'agent', id: 'relay' }]))
  })
})

describe('resolveAckState — the ONE re-fire comparison', () => {
  const base = {
    effectiveDisposition: 'watch' as const,
    resourceFingerprint: 'agent:relay',
    evidenceSha: 'sha-1',
    nowMs: NOW,
  }

  it('ack holds while tier and resources are unchanged (count drift stays silent)', () => {
    expect(resolveAckState({ ...base, record: ackRecord() })).toBe('acked')
    // Evidence changing (counts drifting) does NOT re-fire an ack.
    expect(resolveAckState({ ...base, evidenceSha: 'sha-2', record: ackRecord() })).toBe('acked')
  })

  it('ack re-fires on tier ESCALATION, holds on de-escalation', () => {
    expect(resolveAckState({
      ...base,
      effectiveDisposition: 'action_required',
      record: ackRecord({ tierAtAck: 'watch' }),
    })).toBeNull()
    expect(resolveAckState({
      ...base,
      effectiveDisposition: 'advisory',
      record: ackRecord({ tierAtAck: 'watch' }),
    })).toBe('acked')
  })

  it('ack re-fires when the resource set changes', () => {
    expect(resolveAckState({
      ...base,
      resourceFingerprint: 'agent:relay|task:t9',
      record: ackRecord(),
    })).toBeNull()
  })

  it('snooze holds until expiry, then re-fires', () => {
    const record = ackRecord({
      mode: 'snooze',
      until: new Date(NOW + 60_000).toISOString(),
    })
    expect(resolveAckState({ ...base, record })).toBe('snoozed')
    expect(resolveAckState({ ...base, nowMs: NOW + 120_000, record })).toBeNull()
  })

  it('action_required snooze re-fires on ANY evidence change', () => {
    const record = ackRecord({
      mode: 'snooze',
      tierAtAck: 'action_required',
      until: new Date(NOW + 60_000).toISOString(),
      evidenceSha: 'sha-1',
    })
    const arBase = { ...base, effectiveDisposition: 'action_required' as const }
    expect(resolveAckState({ ...arBase, record })).toBe('snoozed')
    expect(resolveAckState({ ...arBase, evidenceSha: 'sha-2', record })).toBeNull()
  })
})

describe('review findings — re-fire hardening', () => {
  it('SNOOZED incidents also re-fire on tier escalation (never-quietly-silenceable)', () => {
    const record = ackRecord({
      mode: 'snooze',
      tierAtAck: 'watch',
      until: new Date(NOW + 6 * 24 * 60 * 60 * 1000).toISOString(),
    })
    expect(resolveAckState({
      record,
      effectiveDisposition: 'action_required',
      resourceFingerprint: 'agent:relay',
      evidenceSha: 'sha-1',
      nowMs: NOW,
    })).toBeNull()
    // Same tier stays snoozed.
    expect(resolveAckState({
      record,
      effectiveDisposition: 'watch',
      resourceFingerprint: 'agent:relay',
      evidenceSha: 'sha-1',
      nowMs: NOW,
    })).toBe('snoozed')
  })

  it('a snooze record without an expiry is invalid at read and never applies at resolve', () => {
    mkdirSync(join(testDir, 'health'), { recursive: true })
    writeFileSync(acksPath, JSON.stringify({
      broken: { incidentId: 'broken', mode: 'snooze', at: new Date(NOW).toISOString(), tierAtAck: 'watch', resourceFingerprint: 'x' },
    }))
    expect(readAckRecords()).toEqual({})
    expect(resolveAckState({
      record: ackRecord({ mode: 'snooze', until: undefined }),
      effectiveDisposition: 'watch',
      resourceFingerprint: 'agent:relay',
      evidenceSha: 'sha-1',
      nowMs: NOW,
    })).toBeNull()
  })
})
