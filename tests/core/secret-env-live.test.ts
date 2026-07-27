/**
 * D18 (#687): secret-env injection is no longer boot-only.
 *
 * 1. collectPackSecretMappings() derives EnvSecretMapping[] from installed
 *    skill-pack manifests' secrets[] (secretSlot-backed) — boot injects
 *    pack-declared vars, not just the static list.
 * 2. injectSecretEnvForSlot() live-injects after a secret save so the
 *    install → guided-key → agent-turn journey works without a restart.
 *    Same rules as boot: unset-only, env always wins, never log values.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-secret-live-${Date.now()}-${randomUUID()}`)

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { setStoredSecret } from '../../packages/core/src/media/secret-store'
import { writeLockfile, readLockfile, addPackage } from '../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../packages/core/src/agent-packages/package-paths'
import {
  collectPackSecretMappings,
  injectSecretEnvForSlot,
} from '../../src/core/secret-env'

const ENV_VAR = 'BAKIN_TEST_HUB_KEY'

function seedInstalledPack(): void {
  const lock = addPackage(readLockfile(), 'hub-demo@1.0.0', {
    kind: 'skill-pack',
    version: '1.0.0',
    source: 'clawhub:@x/demo',
    ref: '',
    commitSha: '',
    installedAt: new Date().toISOString(),
    projections: [],
    refCount: 0,
    dependents: [],
  })
  writeLockfile(lock)
  const dir = getPackageSourceDir(testDir, 'skill-pack', 'hub-demo', '1.0.0')
  mkdirSync(join(dir, 'skills', 'demo'), { recursive: true })
  writeFileSync(join(dir, 'skills', 'demo', 'SKILL.md'), '# demo')
  writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify({
    id: 'hub-demo',
    name: 'hub-demo',
    version: '1.0.0',
    kind: 'skill-pack',
    contributions: { skills: ['skills/demo'] },
    secrets: [{ name: ENV_VAR, description: 'test key', secretSlot: 'skills.BAKIN_TEST_HUB_KEY' }],
  }))
}

describe('secret-env live injection (D18)', () => {
  const originalVar = process.env[ENV_VAR]

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
    delete process.env[ENV_VAR]
  })

  afterEach(() => {
    if (originalVar === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalVar
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('collectPackSecretMappings derives mappings from installed manifests', () => {
    seedInstalledPack()
    const mappings = collectPackSecretMappings()
    expect(mappings).toContainEqual({ envVar: ENV_VAR, provider: 'skills', name: 'BAKIN_TEST_HUB_KEY' })
  })

  it('injectSecretEnvForSlot live-injects a just-saved secret for its declared env var', () => {
    seedInstalledPack()
    setStoredSecret('skills', 'BAKIN_TEST_HUB_KEY', 'sk-live-123')
    const injected = injectSecretEnvForSlot('skills', 'BAKIN_TEST_HUB_KEY')
    expect(injected).toEqual([ENV_VAR])
    expect(process.env[ENV_VAR]).toBe('sk-live-123')
  })

  it('env always wins — a preexisting env value is never overwritten', () => {
    seedInstalledPack()
    process.env[ENV_VAR] = 'from-real-env'
    setStoredSecret('skills', 'BAKIN_TEST_HUB_KEY', 'sk-live-123')
    expect(injectSecretEnvForSlot('skills', 'BAKIN_TEST_HUB_KEY')).toEqual([])
    expect(process.env[ENV_VAR]).toBe('from-real-env')
  })

  it('a slot no installed pack declares injects nothing', () => {
    seedInstalledPack()
    setStoredSecret('unrelated', 'apiKey', 'sk-x')
    expect(injectSecretEnvForSlot('unrelated', 'apiKey')).toEqual([])
  })
})
