import { describe, expect, it } from 'bun:test'

import {
  antflyBinary,
  antflyChildArgs,
  antflyModelsDir,
  startAntflyChild,
  type AntflyChildDeps,
} from '../../../scripts/instance/antfly-child'
import { RIG_ANTFLY_PORT } from '../../../scripts/instance/modes'

const HOME = '/Users/fake'
const DATA = '/tmp/fake-repo/dev/bakin-instances/isolated/home/antfly'

describe('binary + models resolution', () => {
  it('defaults to the machine-wide install under ~/.antfly', () => {
    expect(antflyBinary({}, HOME)).toBe('/Users/fake/.antfly/bin/antfly')
    expect(antflyModelsDir({}, HOME)).toBe('/Users/fake/.antfly/inference/models')
  })

  it('honors ANTFLY_HOME for the root and ANTFLY_PATH for the binary', () => {
    const env = { ANTFLY_HOME: '/opt/antfly', ANTFLY_PATH: '/custom/bin/antfly' }
    expect(antflyBinary(env, HOME)).toBe('/custom/bin/antfly')
    expect(antflyModelsDir(env, HOME)).toBe('/opt/antfly/inference/models')
    expect(antflyBinary({ ANTFLY_HOME: '/opt/antfly' }, HOME)).toBe('/opt/antfly/bin/antfly')
  })
})

describe('antflyChildArgs', () => {
  it('pins the adapter buildServiceArgv shape (standalone/host/port/health/data/models)', () => {
    // Token-for-token contract with packages/adapter-antfly/src/service.ts
    // buildServiceArgv — health port is ALWAYS port+1. The rig child skips
    // --preload-model on purpose (dev instance; first embed cold-loads).
    expect(antflyChildArgs('/bin/antfly', RIG_ANTFLY_PORT, DATA, '/models')).toEqual([
      '/bin/antfly', 'standalone',
      '--host', '127.0.0.1',
      '--port', '3838',
      '--health-port', '3839',
      '--data-dir', DATA,
      '--models-dir', '/models',
    ])
  })
})

function fakeChildDeps(over: Partial<{
  binaryExists: boolean
  healthyAfter: number
}> = {}) {
  const spawned: string[][] = []
  const killed: string[] = []
  let exitResolve: (code: number) => void = () => {}
  const exited = new Promise<number>((r) => { exitResolve = r })
  let polls = 0
  const mkdirs: string[] = []
  const deps: AntflyChildDeps = {
    spawn: (argv) => {
      spawned.push(argv)
      return {
        kill: (sig) => { killed.push(sig); exitResolve(0) },
        exited,
      }
    },
    fetchOk: async () => {
      polls++
      return polls > (over.healthyAfter ?? 1)
    },
    mkdirp: async (p) => { mkdirs.push(p) },
    exists: () => over.binaryExists ?? true,
    sleep: async () => {},
    log: () => {},
  }
  return { deps, spawned, killed, mkdirs }
}

describe('startAntflyChild', () => {
  const spec = { binary: '/bin/antfly', port: 3838, dataDir: DATA, modelsDir: '/models' }

  it('throws actionably when the engine binary is missing', async () => {
    const { deps } = fakeChildDeps({ binaryExists: false })
    await expect(startAntflyChild(spec, deps)).rejects.toThrow(/bakin install search|ANTFLY_PATH/)
  })

  it('creates the data dir, spawns the pinned argv, and waits for readiness', async () => {
    const { deps, spawned, mkdirs } = fakeChildDeps({ healthyAfter: 3 })
    await startAntflyChild(spec, deps)
    expect(mkdirs).toContain(DATA)
    expect(spawned).toEqual([antflyChildArgs('/bin/antfly', 3838, DATA, '/models')])
  })

  it('stop() terminates the child and awaits its exit', async () => {
    const { deps, killed } = fakeChildDeps()
    const child = await startAntflyChild(spec, deps)
    await child.stop()
    expect(killed).toEqual(['SIGTERM'])
  })
})
