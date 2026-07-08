/**
 * budget-notify — one SSE plugin-event + one main-agent relay per FRESH
 * incident open; resolution emits SSE only; every failure is swallowed
 * (the gate that opened the incident must never fail on notify).
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const dir = join(tmpdir(), 'bakin-test-budget-notify')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ home: dir, db: join(dir, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ home: dir, db: join(dir, 'bakin.db') }) }))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

const broadcasts: Array<Record<string, unknown>> = []
mock.module('../../src/core/sse', () => ({ broadcast: (d: Record<string, unknown>) => { broadcasts.push(d) } }))

let sendImpl = async (_args: Record<string, unknown>) => ({ id: 'm1' })
const sends: Array<Record<string, unknown>> = []
mock.module('../../src/core/app-services', () => ({
  getAppServices: () => ({
    runtime: {
      messaging: { send: async (args: Record<string, unknown>) => { sends.push(args); return sendImpl(args) } },
      agents: { list: async () => [{ id: 'main' }] },
    },
  }),
}))
mock.module('@bakin/core/adapters/runtime', () => ({ getRuntimeMainAgentId: async () => 'main' }))

const metered: Array<Record<string, unknown>> = []
mock.module('../../src/core/agent-cost', () => ({ meterAgentTurn: async (o: Record<string, unknown>) => { metered.push(o) } }))

import { notifyBudgetIncidentOpened, emitBudgetIncidentResolved, describeBudgetIncident } from '../../src/core/budget-notify'

const INCIDENT = {
  incidentId: 7,
  kind: 'cap' as const,
  scope: 'provider',
  scopeId: 'google',
  lane: 'metered' as const,
  window: 'daily' as const,
  unit: 'usd_micros' as const,
  capValue: 5_000_000,
  spentValue: 5_500_000,
  atCap: 'defer' as const,
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10))
}

beforeEach(() => {
  broadcasts.length = 0
  sends.length = 0
  metered.length = 0
  sendImpl = async () => ({ id: 'm1' })
})

describe('notifyBudgetIncidentOpened', () => {
  it('broadcasts one plugin-event and sends one metered main-agent message', async () => {
    notifyBudgetIncidentOpened(INCIDENT)
    await settle()
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0]).toMatchObject({ type: 'plugin-event', event: 'budget.incident_opened', incidentId: 7, scope: 'provider', scopeId: 'google' })
    expect(String(broadcasts[0].message)).toContain("provider 'google'")
    expect(sends).toHaveLength(1)
    expect(sends[0].agentId).toBe('main')
    expect(String(sends[0].content)).toContain('Budget alert')
    expect(metered).toHaveLength(1)
    expect(metered[0]).toMatchObject({ agent: 'main', name: 'budget-alert' })
  })

  it('a relay failure is swallowed (never throws into the gate)', async () => {
    sendImpl = async () => { throw new Error('runtime down') }
    expect(() => notifyBudgetIncidentOpened(INCIDENT)).not.toThrow()
    await settle()
    expect(broadcasts).toHaveLength(1) // SSE still went out
    expect(metered).toHaveLength(0)
  })
})

describe('emitBudgetIncidentResolved', () => {
  it('broadcasts the resolution with no agent message', async () => {
    emitBudgetIncidentResolved({ incidentId: 7, resolution: 'raised' })
    await settle()
    expect(broadcasts[0]).toMatchObject({ type: 'plugin-event', event: 'budget.incident_resolved', incidentId: 7, resolution: 'raised' })
    expect(sends).toHaveLength(0)
  })
})

describe('describeBudgetIncident', () => {
  it('formats units per lane (dollars vs tokens) and pause state', () => {
    expect(describeBudgetIncident(INCIDENT)).toContain('$5.50 of $5.00')
    const sub = describeBudgetIncident({ ...INCIDENT, lane: 'subscription', unit: 'tokens', capValue: 1000, spentValue: 1200, atCap: 'pause' })
    expect(sub).toContain('1,200 tokens of 1,000 tokens')
    expect(sub).toContain('PAUSED')
  })
})
