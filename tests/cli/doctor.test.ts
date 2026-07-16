import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { HealthReportStatus } from '@makinbakin/sdk/types'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'
import { advisoryHealthReport, makeHealthReport } from './doctor-fixtures'
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
      body: JSON.stringify({ notifyAgent: false }),
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
