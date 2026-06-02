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

  it('reports reset targets: openclaw-home always; isolated also wipes its bakin home', () => {
    expect(instancePaths(ROOT, 'native').resetTargets).toEqual(['/tmp/fake-repo/dev/openclaw-home'])
    expect(instancePaths(ROOT, 'isolated').resetTargets).toEqual([
      '/tmp/fake-repo/dev/openclaw-home',
      '/tmp/fake-repo/dev/bakin-instances/isolated/home',
    ])
  })

  it('keeps every reset target inside the repo dev/ tree (never ~/.bakin or ~)', () => {
    for (const mode of ['native', 'isolated', 'sandbox'] as const) {
      for (const target of instancePaths(ROOT, mode).resetTargets) {
        expect(target.startsWith('/tmp/fake-repo/dev/')).toBe(true)
      }
    }
  })
})
