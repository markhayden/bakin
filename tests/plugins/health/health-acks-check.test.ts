/**
 * Health acks check (#898): acknowledgement records that break the acknowledge
 * rules suppress nothing, and this check names them.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-health-acks-check-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { checkHealthAcks } from '../../../plugins/health/lib/system-checks/health-acks'
import type { HealthObservationInput } from '@makinbakin/sdk'

async function observe(nowMs: number): Promise<HealthObservationInput> {
  const result = await checkHealthAcks(nowMs)
  if (!('observations' in result)) throw new Error('expected observations')
  return result.observations[0]!
}

const NOW = Date.parse('2026-10-18T12:00:00.000Z')
const acksPath = join(testDir, 'health', 'acks.json')

function writeRaw(entries: Record<string, unknown>): void {
  mkdirSync(join(testDir, 'health'), { recursive: true })
  writeFileSync(acksPath, JSON.stringify(entries))
}

const ack = (incidentId: string, overrides: Record<string, unknown> = {}) => ({
  incidentId, mode: 'ack', at: new Date(NOW - 60_000).toISOString(), tierAtAck: 'watch', resourceFingerprint: 'agent:relay', ...overrides,
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('acks check', () => {
  it('is healthy with no file and with only valid records', async () => {
    expect((await observe(NOW)).status).toBe('healthy')
    writeRaw({ good: ack('good') })
    const observation = await observe(NOW)
    expect(observation.status).toBe('healthy')
    expect(observation.summary).toContain('1 acknowledgement, all valid')
  })

  it('names each ignored record with its reason and how to clear it', async () => {
    writeRaw({
      good: ack('good'),
      forged: ack('forged', { tierAtAck: 'action_required' }),
      future: ack('future', { at: new Date(NOW + 60_000).toISOString() }),
    })
    const observation = await observe(NOW)
    expect(observation.status).toBe('warning')
    expect(observation.incident?.class).toBe('evidence_gap')
    expect(observation.evidence).toEqual({ invalid: [
      { key: 'forged', reason: 'action_required incidents cannot be permanently acknowledged — snooze only' },
      { key: 'future', reason: 'at is in the future' },
    ] })
    // The prune repair removes exactly these records (self-healing 1.3c); the evidence still names them.
    expect(observation.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'health-acks-prune' })
  })

  it('an unreadable file is a warning, never a crash', async () => {
    mkdirSync(join(testDir, 'health'), { recursive: true })
    writeFileSync(acksPath, '{ nope')
    const observation = await observe(NOW)
    expect(observation.status).toBe('warning')
    expect(observation.incident?.key).toBe('store-unreadable')
    expect(observation.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'health-acks-reset' })
  })
})
