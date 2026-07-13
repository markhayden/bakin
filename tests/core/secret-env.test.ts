import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { rmSync } from 'fs'
import { join, delimiter } from 'path'
import { tmpdir } from 'os'
import { resetContentDir, getBakinPaths } from '../../src/core/content-dir'
import { setStoredSecret } from '../../packages/core/src/media/secret-store'
import { ensureBakinBinOnPath, injectIntegrationEnv, type EnvSecretMapping } from '../../src/core/secret-env'

describe('secret-env boot injection', () => {
  let testDir: string
  const original = {
    home: process.env.BAKIN_HOME,
    path: process.env.PATH,
    brave: process.env.BRAVE_SEARCH_API_KEY,
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `bakin-secret-env-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    process.env.BAKIN_HOME = testDir
    resetContentDir()
    delete process.env.BRAVE_SEARCH_API_KEY
  })

  afterEach(() => {
    for (const [key, value] of [['BAKIN_HOME', original.home], ['PATH', original.path], ['BRAVE_SEARCH_API_KEY', original.brave]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    resetContentDir()
    rmSync(testDir, { recursive: true, force: true })
  })

  const mapping: EnvSecretMapping[] = [{ envVar: 'BRAVE_SEARCH_API_KEY', provider: 'brave', name: 'apiKey' }]

  it('injects a stored secret into an UNSET env var', () => {
    setStoredSecret('brave', 'apiKey', 'bsk-stored')
    const injected = injectIntegrationEnv(mapping)
    expect(process.env.BRAVE_SEARCH_API_KEY).toBe('bsk-stored')
    expect(injected).toEqual(['BRAVE_SEARCH_API_KEY'])
  })

  it('never overrides an already-set env var (env-first)', () => {
    process.env.BRAVE_SEARCH_API_KEY = 'bsk-env'
    setStoredSecret('brave', 'apiKey', 'bsk-stored')
    const injected = injectIntegrationEnv(mapping)
    expect(process.env.BRAVE_SEARCH_API_KEY).toBe('bsk-env')
    expect(injected).toEqual([])
  })

  it('leaves the env var unset when nothing is stored', () => {
    const injected = injectIntegrationEnv(mapping)
    expect(process.env.BRAVE_SEARCH_API_KEY).toBeUndefined()
    expect(injected).toEqual([])
  })

  it('exposes a bin path under the content dir and prepends it to PATH once', () => {
    const expected = getBakinPaths().bin
    expect(expected).toBe(join(testDir, 'bin'))

    process.env.PATH = '/usr/bin'
    ensureBakinBinOnPath()
    expect(process.env.PATH).toBe(`${expected}${delimiter}/usr/bin`)

    // Idempotent — a second call must not duplicate the segment.
    ensureBakinBinOnPath()
    expect(process.env.PATH!.split(delimiter).filter(p => p === expected)).toHaveLength(1)
  })
})
