import { afterEach, describe, expect, it } from 'bun:test'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'
import { checkPluginRegistry } from '../../../plugins/health/lib/system-checks/plugin-registry'
import {
  getMcpSessions,
  getRegistrySnapshot,
  HealthHostProviderUnavailableError,
} from '../../../plugins/health/lib/host-providers'

type HostProviderGlobals = typeof globalThis & {
  __bakinGetRegistrySnapshot?: () => Array<Record<string, unknown>>
  __bakinGetMcpSessions?: () => {
    activeSessions: Array<{ agent: string; sessions: number; connectedAt: string }>
    upSince: string
  }
}

const host = globalThis as HostProviderGlobals
const originalRegistry = host.__bakinGetRegistrySnapshot
const originalMcpSessions = host.__bakinGetMcpSessions

afterEach(() => {
  if (originalRegistry) host.__bakinGetRegistrySnapshot = originalRegistry
  else delete host.__bakinGetRegistrySnapshot
  if (originalMcpSessions) host.__bakinGetMcpSessions = originalMcpSessions
  else delete host.__bakinGetMcpSessions
})

describe('Health host providers', () => {
  it('distinguishes a missing registry provider from an available empty registry', () => {
    delete host.__bakinGetRegistrySnapshot

    expect(() => getRegistrySnapshot()).toThrow(HealthHostProviderUnavailableError)

    host.__bakinGetRegistrySnapshot = () => []
    expect(getRegistrySnapshot()).toEqual([])
  })

  it('never fabricates a current empty MCP snapshot when its provider is missing', () => {
    delete host.__bakinGetMcpSessions

    expect(() => getMcpSessions()).toThrow(HealthHostProviderUnavailableError)
  })
})

describe('plugin registry diagnostic', () => {
  it('reports unknown when the host registry provider is unavailable', async () => {
    delete host.__bakinGetRegistrySnapshot

    const run = parseHealthCheckRunInput(await checkPluginRegistry())
    expect(run.outcome).toBe('observed')
    if (run.outcome !== 'observed') throw new Error(run.reason)
    expect(run.observations).toEqual([
      expect.objectContaining({
        key: 'availability',
        status: 'unknown',
        summary: 'Plugin activation could not be verified.',
      }),
    ])
  })

  it('can report healthy for a genuinely available empty registry', async () => {
    host.__bakinGetRegistrySnapshot = () => []

    const run = parseHealthCheckRunInput(await checkPluginRegistry())
    expect(run.outcome).toBe('observed')
    if (run.outcome !== 'observed') throw new Error(run.reason)
    expect(run.observations[0]).toMatchObject({
      key: 'activation',
      status: 'healthy',
      evidence: { registered: 0, failed: 0 },
    })
  })
})
