import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { HealthReportStatus } from '@makinbakin/sdk/types'
// Warm Ink before exercising the CLI's lazy TUI import under Bun's module-isolated runner.
import 'ink'
import { setStdoutIsTTY, setupTtyCliHarness } from './helpers/tty-cli-harness'
import { actionableHealthReport, advisoryHealthReport, makeHealthReport } from './doctor-fixtures'
import { healthReportSchema } from '../../plugins/health/lib/route-schemas'

function onboardingComponent(name: string) {
  return {
    name,
    check: async () => ({ name, status: 'ok' as const, message: `${name} is ready.` }),
    install: async () => ({ name, status: 'noop' as const, message: `${name} is ready.`, durationMs: 0 }),
  }
}

mock.module('../../src/core/onboarding/mkdir', () => ({ mkdirComponent: onboardingComponent('mkdir') }))
mock.module('../../src/core/onboarding/settings', () => ({ settingsComponent: onboardingComponent('settings') }))
mock.module('../../src/core/onboarding/search', () => ({ searchComponent: onboardingComponent('search') }))
mock.module('../../src/core/onboarding/search-models', () => ({ searchModelsComponent: onboardingComponent('search-models') }))
mock.module('../../src/core/onboarding/agent-sync', () => ({ agentSyncComponent: onboardingComponent('agent-sync') }))
mock.module('../../src/core/onboarding/recommended-plugins', () => ({ recommendedPluginsComponent: onboardingComponent('recommended-plugins') }))

const harness = setupTtyCliHarness({ exitMode: 'always-throws', defaultIsTTY: false })
const { fetchMock } = harness

describe('doctor CLI canonical report', () => {
  beforeEach(() => {
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--full', '--json']
  })

  it('prints the raw canonical report in JSON mode', async () => {
    fetchMock.mockResolvedValueOnce(harness.jsonResponse(advisoryHealthReport))

    const { main } = await import('../../cli/bakin')
    await main()

    expect(fetchMock.mock.calls[0][0]).toContain('/api/plugins/health/doctor/run')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(JSON.parse(String(harness.log.mock.calls[0][0]))).toEqual(advisoryHealthReport)
    expect(harness.output()).not.toContain('"command": "doctor"')
  })

  it.each([
    ['degraded', 2],
    ['needs_attention', 1],
    ['unknown_stale', 1],
  ] as Array<[HealthReportStatus, 1 | 2]>)('maps %s to exit %d', async (status, exitCode) => {
    fetchMock.mockResolvedValueOnce(harness.jsonResponse(makeHealthReport(status)))

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow(`exit:${exitCode}`)

    expect(JSON.parse(String(harness.log.mock.calls[0][0])).overallStatus).toBe(status)
  })

  it('represents server-only offline sources as canonical Unknown evidence', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--json']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(fetchMock).not.toHaveBeenCalled()
    const report = JSON.parse(String(harness.log.mock.calls[0][0]))
    expect(() => healthReportSchema.parse(report)).not.toThrow()
    expect(report.overallStatus).toBe('unknown_stale')
    expect(report.observations.filter((row: { status: string }) => row.status === 'unknown')).toHaveLength(3)
    expect(report.observations.some((row: { status: string }) => row.status === 'warning')).toBe(false)
    expect(report.incidents.every((incident: { disposition: string }) => incident.disposition === 'watch')).toBe(true)
    expect(report.incidents.map((incident: { id: string }) => incident.id)).toEqual([
      'core:offline:runtime:unverified',
      'core:offline:plugin-assets:unverified',
      'core:offline:server-checks:unverified',
    ])
  })
})

describe('doctor --delegate refusals (#896 repair_in_flight)', () => {
  const refusal = {
    status: 'repair_in_flight',
    incidents: [],
    overlapping: ['health:search:unavailable'],
    heldBy: 'repair:plan-1:search.restart:restart',
  }
  const refusedResponse = () => new Response(JSON.stringify(refusal), { status: 409, headers: { 'content-type': 'application/json' } })

  it('JSON mode: the decoded 409 is the data, error REPAIR_IN_FLIGHT, exit 1', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--delegate', '--yes', '--json']
    fetchMock.mockResolvedValueOnce(harness.jsonResponse(actionableHealthReport))
    fetchMock.mockResolvedValueOnce(refusedResponse())
    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')
    const printed = JSON.parse(String(harness.log.mock.calls.at(-1)![0]))
    expect(printed).toMatchObject({ ok: false, exitCode: 1, data: { status: 'repair_in_flight', heldBy: 'repair:plan-1:search.restart:restart' }, error: { code: 'REPAIR_IN_FLIGHT' } })
    expect(fetchMock.mock.calls[1][0]).toContain('/api/plugins/health/doctor/delegate')
  })

  it('plain mode: names the holder and the held incidents, exit 1', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--delegate', '--yes']
    fetchMock.mockResolvedValueOnce(harness.jsonResponse(actionableHealthReport))
    fetchMock.mockResolvedValueOnce(refusedResponse())
    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')
    expect(harness.output()).toContain('Not delegated: a repair is already working these incidents (held by repair:plan-1:search.restart:restart)')
    expect(harness.output()).toContain('health:search:unavailable')
  })

  it('TTY mode: renders the refusal screen and exits 1 (no "board task was created")', async () => {
    setStdoutIsTTY(true)
    try {
      process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--delegate', '--yes']
      fetchMock.mockResolvedValueOnce(harness.jsonResponse(actionableHealthReport))
      fetchMock.mockResolvedValueOnce(refusedResponse())
      const { main } = await import('../../cli/bakin')
      await expect(main()).rejects.toThrow('exit:1')
      expect(harness.output()).not.toContain('A board task was created')
    } finally {
      setStdoutIsTTY(false)
    }
  })
})
