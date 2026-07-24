/**
 * Health plugin — POST /doctor/ack + GET /doctor/acks (health trust
 * overhaul). One endpoint, three actions; server-side tier rules with
 * honest HTTP errors; writes republish the report immediately.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-health-ack-route-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = `${testDir}-openclaw`

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, home: testDir, db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => `${testDir}/.openclaw`,
  getOpenClawPath: (p = '') => `${testDir}/.openclaw/${p}`,
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { healthError, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import healthPlugin from '../../../plugins/health/index'
import { runHealthCheck } from '../../../src/core/doctor-checks'
import { applyHealthCheckRun, getHealthReport, resetHealthReportCache } from '../../../src/core/doctor-report-cache'
import { getHealthCheck, registerPluginHealthCheck, unregisterPluginHealthChecks } from '../../../src/core/health-check-registry'
import { activatePlugin, findRoute, callRoute } from '../test-helpers'
import type { ActivatedPlugin } from '../test-helpers'

let plugin: ActivatedPlugin

async function seedIncident(disposition: 'watch' | 'action_required', localId: string): Promise<string> {
  const observation = disposition === 'action_required'
    ? healthError({
        key: localId, summary: 'Cap breached.',
        incident: {
          key: localId, title: 'Spending cap reached', impact: 'Dispatch defers.', disposition: 'action_required',
          resolution: { key: 'rerun', type: 'rerun', label: 'Check again' },
        },
      })
    : healthWarning({
        key: localId, summary: 'Slow.',
        incident: {
          key: localId, title: 'Runtime is slow', impact: 'Turns take longer.', disposition: 'watch',
          resolution: { key: 'rerun', type: 'rerun', label: 'Check again' },
        },
      })
  const id = registerPluginHealthCheck('ack-route-test', {
    id: localId,
    name: `Probe ${localId}`,
    description: 'ack route probe',
    group: { key: 'runtime', label: 'Runtime' },
    maxAgeMs: 60_000,
    run: async () => healthObserved([observation]),
  }, 'Ack Route Test')
  applyHealthCheckRun(await runHealthCheck(getHealthCheck(id)!))
  const report = getHealthReport()
  const incident = report.incidents.find((candidate) => candidate.id.includes(localId))
  if (!incident) throw new Error('probe incident missing')
  return incident.id
}

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  resetHealthReportCache()
  plugin = await activatePlugin(healthPlugin, testDir)
})

afterAll(() => {
  unregisterPluginHealthChecks('ack-route-test')
  rmSync(testDir, { recursive: true, force: true })
  rmSync(`${testDir}-openclaw`, { force: true, recursive: true })
})

describe('POST /doctor/ack', () => {
  it('acks a watch incident and the report reflects it; clear un-acks', async () => {
    const incidentId = await seedIncident('watch', 'w1')
    const route = findRoute(plugin.routes, 'POST', '/doctor/ack')!
    const { status, body } = await callRoute(route, plugin.ctx, { body: { incidentId, action: 'ack' } })
    expect(status).toBe(200)
    expect((body as { incidentId: string }).incidentId).toBe(incidentId)
    expect(getHealthReport().incidents.find((incident) => incident.id === incidentId)?.ackState).toBe('acked')

    const clear = await callRoute(route, plugin.ctx, { body: { incidentId, action: 'clear' } })
    expect(clear.status).toBe(200)
    expect(getHealthReport().incidents.find((incident) => incident.id === incidentId)?.ackState).toBeUndefined()
  })

  it('refuses permanent ack on action_required with an honest 400; snooze works with capped window', async () => {
    const incidentId = await seedIncident('action_required', 'ar1')
    const route = findRoute(plugin.routes, 'POST', '/doctor/ack')!

    const refused = await callRoute(route, plugin.ctx, { body: { incidentId, action: 'ack' } })
    expect(refused.status).toBe(400)
    expect(JSON.stringify(refused.body)).toContain('snooze')

    const snoozed = await callRoute(route, plugin.ctx, { body: { incidentId, action: 'snooze', for: '7d' } })
    expect(snoozed.status).toBe(200)
    expect(getHealthReport().incidents.find((incident) => incident.id === incidentId)?.ackState).toBe('snoozed')
  })

  it('404s an unknown incident id', async () => {
    const route = findRoute(plugin.routes, 'POST', '/doctor/ack')!
    const { status } = await callRoute(route, plugin.ctx, { body: { incidentId: 'nope:missing', action: 'ack' } })
    expect(status).toBe(404)
  })
})

describe('GET /doctor/acks', () => {
  it('lists current records', async () => {
    const incidentId = await seedIncident('watch', 'w2')
    const ackRoute = findRoute(plugin.routes, 'POST', '/doctor/ack')!
    await callRoute(ackRoute, plugin.ctx, { body: { incidentId, action: 'ack' } })

    const listRoute = findRoute(plugin.routes, 'GET', '/doctor/acks')!
    const { status, body } = await callRoute(listRoute, plugin.ctx)
    expect(status).toBe(200)
    const records = (body as { records: Array<{ incidentId: string; mode: string }> }).records
    expect(records.some((record) => record.incidentId === incidentId && record.mode === 'ack')).toBe(true)
  })
})
