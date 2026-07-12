import { describe, expect, it } from 'bun:test'

import { parseInstanceArgs } from '../../../scripts/instance/args'
import { instancePaths } from '../../../scripts/instance/paths'
import { resolvePlan, RIG_ANTFLY_PORT, rigAntflySearchUrl } from '../../../scripts/instance/modes'

const ROOT = '/tmp/fake-repo'

function plan(argv: string[]) {
  const args = parseInstanceArgs(argv)
  return resolvePlan(args, instancePaths(ROOT, args.mode))
}

describe('resolvePlan — native × openclaw', () => {
  it('runs Bakin on the host against the gateway, real ~/.bakin (no BAKIN_HOME override)', () => {
    const p = plan(['up'])
    expect(p.runtime).toBe('openclaw')
    expect(p.docker).toEqual({ composeProfile: null, services: ['openclaw-gateway'] })
    expect(p.bakin).toEqual({ placement: 'host', source: 'repo', onboard: 'manual' })
    expect(p.hostEnv.OPENCLAW_HOME).toBe('/tmp/fake-repo/dev/openclaw-home')
    expect(p.hostEnv.OPENCLAW_PATH).toBe('/tmp/fake-repo/dev/docker/openclaw-shim.sh')
    expect(p.hostEnv.BAKIN_URL).toBe('http://host.docker.internal:3737')
    expect(p.hostEnv.BAKIN_HOME).toBeUndefined()
    expect(p.wipeBeforeUp).toEqual([])
    expect(p.antflyChild).toBeNull()
    expect(p.settingsPatch).toBeNull()
  })

  it('points provisionToolAccess at the container-reachable MCP base URL', () => {
    // The adapter writes bakin-<agent> mcp.servers entries at Bakin boot using
    // BAKIN_MCP_BASE_URL; from inside the container, the host Bakin is
    // host.docker.internal, never localhost.
    expect(plan(['up']).hostEnv.BAKIN_MCP_BASE_URL).toBe('http://host.docker.internal:3737')
    expect(plan(['up', '--mode', 'isolated']).hostEnv.BAKIN_MCP_BASE_URL).toBe('http://host.docker.internal:3737')
  })

  it('maps container agent paths to the bind-mounted host home for asset saves', () => {
    // Closes the rig asset-save gap: agents report container workspace paths;
    // the openclaw home is bind-mounted at dev/openclaw-home on the host.
    expect(plan(['up']).hostEnv.BAKIN_AGENT_PATH_MAP)
      .toBe('/home/node/.openclaw=/tmp/fake-repo/dev/openclaw-home')
    expect(plan(['up', '--mode', 'isolated']).hostEnv.BAKIN_AGENT_PATH_MAP)
      .toBe('/home/node/.openclaw=/tmp/fake-repo/dev/openclaw-home')
  })

  it('never selects an adapter via env for native openclaw (real settings rule)', () => {
    expect(plan(['up']).hostEnv.BAKIN_RUNTIME_ADAPTER).toBe('openclaw')
  })
})

describe('resolvePlan — isolated × openclaw', () => {
  it('overrides BAKIN_HOME to the throwaway dev home', () => {
    const p = plan(['up', '--mode', 'isolated'])
    expect(p.bakin.placement).toBe('host')
    expect(p.hostEnv.BAKIN_HOME).toBe('/tmp/fake-repo/dev/bakin-instances/isolated/home')
  })

  it('carries the chosen source', () => {
    expect(plan(['up', '--mode', 'isolated', '--source', 'installed']).bakin.source).toBe('installed')
  })

  it('isolates search: guest-mode URL patch + rig antfly child + service-mode belt', () => {
    const p = plan(['up', '--mode', 'isolated'])
    // Layer 1: throwaway settings point search at the rig child's port —
    // a non-3738 URL is guest mode, so the adapter can never provision the
    // machine-global launchd unit (the clobber that fired on 2026-07-11).
    expect(p.settingsPatch).toEqual({ runtimeAdapter: 'openclaw', searchUrl: rigAntflySearchUrl() })
    // Layer 3 belt: even if the patch is lost, child mode never writes a plist.
    expect(p.hostEnv.BAKIN_SEARCH_SERVICE_MODE).toBe('child')
    expect(p.antflyChild).toEqual({
      port: RIG_ANTFLY_PORT,
      dataDir: '/tmp/fake-repo/dev/bakin-instances/isolated/antfly',
    })
  })
})

describe('resolvePlan — sandbox × openclaw', () => {
  it('runs Bakin in-container under the sandbox profile, manual onboarding by default', () => {
    const p = plan(['up', '--mode', 'sandbox'])
    expect(p.docker).toEqual({ composeProfile: 'sandbox', services: ['sandbox'] })
    expect(p.bakin).toEqual({ placement: 'container', source: 'repo', onboard: 'manual' })
    expect(p.hostEnv.BAKIN_HOME).toBeUndefined()
    // In-container Bakin reaches its own MCP server on localhost — the adapter
    // default — so sandbox must NOT override BAKIN_MCP_BASE_URL.
    expect(p.hostEnv.BAKIN_MCP_BASE_URL).toBeUndefined()
    expect(p.antflyChild).toBeNull()
  })

  it('auto-onboards when --preconfigure is set', () => {
    expect(plan(['up', '--mode', 'sandbox', '--preconfigure']).bakin.onboard).toBe('auto')
  })
})

describe('resolvePlan — native × pi', () => {
  it('needs no docker at all and selects pi via the env override only', () => {
    const p = plan(['up', '--runtime', 'pi'])
    expect(p.runtime).toBe('pi')
    expect(p.docker).toBeNull()
    expect(p.bakin.placement).toBe('host')
    expect(p.hostEnv.BAKIN_RUNTIME_ADAPTER).toBe('pi')
    expect(p.hostEnv.PI_HOME).toBe('/tmp/fake-repo/dev/pi-home')
    // Real ~/.bakin, never written: no BAKIN_HOME, no settings patch.
    expect(p.hostEnv.BAKIN_HOME).toBeUndefined()
    expect(p.settingsPatch).toBeNull()
  })

  it('sets no OpenClaw or MCP-callback env — pi is in-process on the host', () => {
    const env = plan(['up', '--runtime', 'pi']).hostEnv
    expect(env.OPENCLAW_HOME).toBeUndefined()
    expect(env.OPENCLAW_PATH).toBeUndefined()
    expect(env.BAKIN_MCP_BASE_URL).toBeUndefined()
    expect(env.BAKIN_URL).toBeUndefined()
    expect(env.BAKIN_AGENT_PATH_MAP).toBeUndefined()
  })
})

describe('resolvePlan — isolated × pi', () => {
  it('throwaway BAKIN_HOME + PI_HOME + search isolation', () => {
    const p = plan(['up', '--mode', 'isolated', '--runtime', 'pi'])
    expect(p.docker).toBeNull()
    expect(p.hostEnv.BAKIN_HOME).toBe('/tmp/fake-repo/dev/bakin-instances/isolated/home')
    expect(p.hostEnv.PI_HOME).toBe('/tmp/fake-repo/dev/pi-home')
    expect(p.hostEnv.BAKIN_RUNTIME_ADAPTER).toBe('pi')
    expect(p.hostEnv.BAKIN_SEARCH_SERVICE_MODE).toBe('child')
    expect(p.settingsPatch).toEqual({ runtimeAdapter: 'pi', searchUrl: rigAntflySearchUrl() })
    expect(p.antflyChild).toEqual({
      port: RIG_ANTFLY_PORT,
      dataDir: '/tmp/fake-repo/dev/bakin-instances/isolated/antfly',
    })
  })
})

describe('resolvePlan — sandbox × pi', () => {
  it('runs Bakin in-container under the sandbox-pi profile', () => {
    const p = plan(['up', '--mode', 'sandbox', '--runtime', 'pi'])
    expect(p.docker).toEqual({ composeProfile: 'sandbox-pi', services: ['sandbox-pi'] })
    expect(p.bakin).toEqual({ placement: 'container', source: 'repo', onboard: 'manual' })
    // Container env comes from the compose service, not hostEnv.
    expect(p.hostEnv).toEqual({})
    expect(p.antflyChild).toBeNull()
    expect(p.settingsPatch).toBeNull()
  })
})

describe('resolvePlan — fresh', () => {
  it('wipes the mode reset targets before bringing up', () => {
    expect(plan(['up', '--fresh']).wipeBeforeUp).toEqual([
      '/tmp/fake-repo/dev/openclaw-home',
      '/tmp/fake-repo/dev/pi-home',
    ])
    expect(plan(['up', '--mode', 'isolated', '--fresh']).wipeBeforeUp).toEqual([
      '/tmp/fake-repo/dev/openclaw-home',
      '/tmp/fake-repo/dev/pi-home',
      '/tmp/fake-repo/dev/bakin-instances/isolated/home',
      '/tmp/fake-repo/dev/bakin-instances/isolated/antfly',
    ])
  })
})

describe('rigAntflySearchUrl', () => {
  it('is never the adapter-managed local default (guest-mode guarantee)', () => {
    // isLocalDefaultUrl matches only 127.0.0.1:3738/localhost:3738 — the rig
    // port must not collide with it, or the adapter would provision launchd.
    expect(rigAntflySearchUrl()).toBe(`http://127.0.0.1:${RIG_ANTFLY_PORT}`)
    expect(RIG_ANTFLY_PORT).not.toBe(3738)
    // health port is always port+1 — must clear the real instance's 3739 too.
    expect(RIG_ANTFLY_PORT + 1).not.toBe(3739)
  })
})
