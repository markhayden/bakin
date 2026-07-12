import { describe, expect, it } from 'bun:test'

import { instancePaths } from '../../../scripts/instance/paths'

const ROOT = '/tmp/fake-repo'

describe('instancePaths', () => {
  it('locates the shared OpenClaw home + docker assets under the repo', () => {
    const p = instancePaths(ROOT, 'native')
    expect(p.openclawHome).toBe('/tmp/fake-repo/dev/openclaw-home')
    expect(p.composeFile).toBe('/tmp/fake-repo/dev/docker/docker-compose.yml')
    expect(p.shim).toBe('/tmp/fake-repo/dev/docker/openclaw-shim.sh')
    expect(p.secretsTemplate).toBe('/tmp/fake-repo/dev/docker/secrets.op.env')
  })

  it('uses the real ~/.bakin (null host home) for native mode', () => {
    expect(instancePaths(ROOT, 'native').bakinHome).toBeNull()
  })

  it('uses a throwaway host BAKIN_HOME for isolated mode', () => {
    expect(instancePaths(ROOT, 'isolated').bakinHome).toBe(
      '/tmp/fake-repo/dev/bakin-instances/isolated/home',
    )
  })

  it('has no host BAKIN_HOME for sandbox mode (Bakin runs in-container)', () => {
    expect(instancePaths(ROOT, 'sandbox').bakinHome).toBeNull()
  })

  it('reports reset targets: runtime homes always; isolated also wipes bakin home + antfly data', () => {
    expect(instancePaths(ROOT, 'native').resetTargets).toEqual([
      '/tmp/fake-repo/dev/openclaw-home',
      '/tmp/fake-repo/dev/pi-home',
    ])
    expect(instancePaths(ROOT, 'isolated').resetTargets).toEqual([
      '/tmp/fake-repo/dev/openclaw-home',
      '/tmp/fake-repo/dev/pi-home',
      '/tmp/fake-repo/dev/bakin-instances/isolated/home',
    ])
    expect(instancePaths(ROOT, 'sandbox').resetTargets).toEqual([
      '/tmp/fake-repo/dev/openclaw-home',
      '/tmp/fake-repo/dev/pi-home-sandbox',
    ])
  })

  it('gives host modes one shared pi home and sandbox its own (path strings diverge in-container)', () => {
    expect(instancePaths(ROOT, 'native').piHome).toBe('/tmp/fake-repo/dev/pi-home')
    expect(instancePaths(ROOT, 'isolated').piHome).toBe('/tmp/fake-repo/dev/pi-home')
    // Sandbox pi state records container paths (/home/node/.pi/...) inside
    // registry/sessions — a host-mode boot must never read it.
    expect(instancePaths(ROOT, 'sandbox').piHome).toBe('/tmp/fake-repo/dev/pi-home-sandbox')
  })

  it('parks the rig antfly child data INSIDE the isolated home (adapter-conventional {home}/antfly)', () => {
    expect(instancePaths(ROOT, 'isolated').antflyDataDir).toBe(
      '/tmp/fake-repo/dev/bakin-instances/isolated/home/antfly',
    )
  })

  it('keeps every reset target inside the repo dev/ tree (never ~/.bakin or ~)', () => {
    for (const mode of ['native', 'isolated', 'sandbox'] as const) {
      for (const target of instancePaths(ROOT, mode).resetTargets) {
        expect(target.startsWith('/tmp/fake-repo/dev/')).toBe(true)
      }
    }
  })
})
