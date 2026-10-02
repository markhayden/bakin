import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { rmSync } from 'fs'
import { delimiter, dirname, join } from 'path'
import { tmpdir } from 'os'
import { resetContentDir, getBakinPaths } from '../../src/core/content-dir'
import { setStoredSecret } from '../../packages/core/src/media/secret-store'
import { ensureBinDirsOnPath, injectIntegrationEnv, type EnvSecretMapping } from '../../src/core/secret-env'

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

  it('prepends the Bakin bin dir and the running binary\'s dir to PATH once', () => {
    const bin = getBakinPaths().bin
    expect(bin).toBe(join(testDir, 'bin'))
    const execDir = dirname(process.execPath)

    process.env.PATH = '/usr/bin'
    ensureBinDirsOnPath()
    expect(process.env.PATH).toBe(`${bin}${delimiter}${execDir}${delimiter}/usr/bin`)

    // Idempotent — a second call must not duplicate either segment.
    ensureBinDirsOnPath()
    const segments = process.env.PATH!.split(delimiter)
    expect(segments.filter((p) => p === bin)).toHaveLength(1)
    expect(segments.filter((p) => p === execDir)).toHaveLength(1)
  })

  it('adds only the missing segment when the exec dir is already on PATH', () => {
    const bin = getBakinPaths().bin
    const execDir = dirname(process.execPath)

    process.env.PATH = `/usr/bin${delimiter}${execDir}`
    ensureBinDirsOnPath()
    expect(process.env.PATH).toBe(`${bin}${delimiter}/usr/bin${delimiter}${execDir}`)
  })
})
