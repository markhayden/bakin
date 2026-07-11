import { describe, expect, it } from 'bun:test'

import { parseInstanceArgs } from '../../../scripts/instance/args'
import { instancePaths } from '../../../scripts/instance/paths'
import { resolvePlan } from '../../../scripts/instance/modes'

const ROOT = '/tmp/fake-repo'

function plan(argv: string[]) {
  const args = parseInstanceArgs(argv)
  return resolvePlan(args, instancePaths(ROOT, args.mode))
}

describe('resolvePlan — native', () => {
  it('runs Bakin on the host against the gateway, real ~/.bakin (no BAKIN_HOME override)', () => {
    const p = plan(['up'])
    expect(p.composeProfile).toBeNull()
    expect(p.services).toEqual(['openclaw-gateway'])
    expect(p.bakin).toEqual({ placement: 'host', source: 'repo', onboard: 'manual' })
    expect(p.hostEnv.OPENCLAW_HOME).toBe('/tmp/fake-repo/dev/openclaw-home')
    expect(p.hostEnv.OPENCLAW_PATH).toBe('/tmp/fake-repo/dev/docker/openclaw-shim.sh')
    expect(p.hostEnv.BAKIN_URL).toBe('http://host.docker.internal:3737')
    expect(p.hostEnv.BAKIN_HOME).toBeUndefined()
    expect(p.wipeBeforeUp).toEqual([])
  })

  it('points provisionToolAccess at the container-reachable MCP base URL', () => {
    // The adapter writes bakin-<agent> mcp.servers entries at Bakin boot using
    // BAKIN_MCP_BASE_URL; from inside the container, the host Bakin is
    // host.docker.internal, never localhost.
    expect(plan(['up']).hostEnv.BAKIN_MCP_BASE_URL).toBe('http://host.docker.internal:3737')
    expect(plan(['up', '--mode', 'isolated']).hostEnv.BAKIN_MCP_BASE_URL).toBe('http://host.docker.internal:3737')
  })
})

describe('resolvePlan — isolated', () => {
  it('overrides BAKIN_HOME to the throwaway dev home', () => {
    const p = plan(['up', '--mode', 'isolated'])
    expect(p.bakin.placement).toBe('host')
    expect(p.hostEnv.BAKIN_HOME).toBe('/tmp/fake-repo/dev/bakin-instances/isolated/home')
  })

  it('carries the chosen source', () => {
    expect(plan(['up', '--mode', 'isolated', '--source', 'installed']).bakin.source).toBe('installed')
  })
})

describe('resolvePlan — sandbox', () => {
  it('runs Bakin in-container under the sandbox profile, manual onboarding by default', () => {
    const p = plan(['up', '--mode', 'sandbox'])
    expect(p.composeProfile).toBe('sandbox')
    expect(p.services).toEqual(['sandbox'])
    expect(p.bakin).toEqual({ placement: 'container', source: 'repo', onboard: 'manual' })
    expect(p.hostEnv.BAKIN_HOME).toBeUndefined()
    // In-container Bakin reaches its own MCP server on localhost — the adapter
    // default — so sandbox must NOT override BAKIN_MCP_BASE_URL.
    expect(p.hostEnv.BAKIN_MCP_BASE_URL).toBeUndefined()
  })

  it('auto-onboards when --preconfigure is set', () => {
    expect(plan(['up', '--mode', 'sandbox', '--preconfigure']).bakin.onboard).toBe('auto')
  })
})

describe('resolvePlan — fresh', () => {
  it('wipes the mode reset targets before bringing up', () => {
    expect(plan(['up', '--fresh']).wipeBeforeUp).toEqual(['/tmp/fake-repo/dev/openclaw-home'])
    expect(plan(['up', '--mode', 'isolated', '--fresh']).wipeBeforeUp).toEqual([
      '/tmp/fake-repo/dev/openclaw-home',
      '/tmp/fake-repo/dev/bakin-instances/isolated/home',
    ])
  })
})
