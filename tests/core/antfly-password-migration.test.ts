/**
 * Antfly basic-auth password lives in the 0600 secret store, not
 * settings.json — settings.json is broadcast by GET /api/settings and is
 * meant to be export-safe (secret-store invariant). Audit finding:
 * sec-secrets-ssrf (P2 pull-in).
 *
 * Covers: one-time migration of a legacy settings.json password into
 * secrets.json, and the env → store resolution order.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-antfly-secret-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import {
  migrateAntflyPasswordToSecretStore,
  resolveAntflyPassword,
  setStoredProviderKey,
} from '../../packages/core/src/media/secret-store'

const settingsPath = join(testDir, 'settings.json')

function writeLegacySettings(): void {
  writeFileSync(settingsPath, JSON.stringify({
    search: {
      adapter: 'antfly',
      settings: {
        enabled: true,
        url: 'http://localhost:8080/api/v1',
        auth: { username: 'bakin', password: 'LEGACY-SECRET' },
      },
    },
  }, null, 2))
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  delete process.env.ANTFLY_PASSWORD
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  delete process.env.ANTFLY_PASSWORD
})

describe('antfly password migration', () => {
  it('relocates a legacy settings.json password into the 0600 secret store', () => {
    writeLegacySettings()

    expect(migrateAntflyPasswordToSecretStore()).toBe(true)

    // settings.json keeps the username, loses the password.
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    expect(settings.search.settings.auth).toEqual({ username: 'bakin' })
    expect(readFileSync(settingsPath, 'utf-8')).not.toContain('LEGACY-SECRET')

    // The password now resolves from the store, and the store file is 0600.
    expect(resolveAntflyPassword()).toEqual({ password: 'LEGACY-SECRET', source: 'store' })
    const mode = statSync(join(testDir, 'secrets.json')).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('is a no-op on a second run and on files without a legacy password', () => {
    writeLegacySettings()
    expect(migrateAntflyPasswordToSecretStore()).toBe(true)
    expect(migrateAntflyPasswordToSecretStore()).toBe(false)

    rmSync(settingsPath)
    expect(migrateAntflyPasswordToSecretStore()).toBe(false)
    expect(existsSync(settingsPath)).toBe(false)
  })

  it('a store value present before migration wins; settings password is still stripped', () => {
    setStoredProviderKey('antfly', 'STORE-FIRST')
    writeLegacySettings()

    expect(migrateAntflyPasswordToSecretStore()).toBe(true)
    expect(resolveAntflyPassword()).toEqual({ password: 'STORE-FIRST', source: 'store' })
    expect(readFileSync(settingsPath, 'utf-8')).not.toContain('LEGACY-SECRET')
  })

  it('resolution order: ANTFLY_PASSWORD env beats the store; empty when neither set', () => {
    expect(resolveAntflyPassword()).toBeNull()

    setStoredProviderKey('antfly', 'FROM-STORE')
    expect(resolveAntflyPassword()).toEqual({ password: 'FROM-STORE', source: 'store' })

    process.env.ANTFLY_PASSWORD = 'FROM-ENV'
    expect(resolveAntflyPassword()).toEqual({ password: 'FROM-ENV', source: 'env' })
  })
})
