import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resetContentDir } from '../../../src/core/content-dir'
import {
  getStoredProviderKey,
  getStoredSecret,
  listStoredProviders,
  listStoredSecrets,
  resolveProviderApiKeySource,
  setStoredProviderKey,
  setStoredSecret,
  unsetStoredProviderKey,
  unsetStoredSecret,
} from '../../../packages/core/src/media/secret-store'

describe('media secret-store', () => {
  let testDir: string
  const original = {
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    google: process.env.GOOGLE_AI_API_KEY,
    home: process.env.BAKIN_HOME,
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `bakin-secret-store-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    process.env.BAKIN_HOME = testDir
    resetContentDir()
    delete process.env.OPENAI_API_KEY
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_AI_API_KEY
  })

  afterEach(() => {
    for (const [key, value] of [['OPENAI_API_KEY', original.openai], ['GEMINI_API_KEY', original.gemini], ['GOOGLE_AI_API_KEY', original.google], ['BAKIN_HOME', original.home]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    resetContentDir()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('returns null for an unset provider and an empty list', () => {
    expect(getStoredProviderKey('openai')).toBeNull()
    expect(listStoredProviders()).toEqual([])
  })

  it('persists, reads back, lists, and unsets a provider key', () => {
    setStoredProviderKey('openai', 'sk-stored')
    expect(getStoredProviderKey('openai')).toBe('sk-stored')
    expect(listStoredProviders()).toEqual(['openai'])

    expect(unsetStoredProviderKey('openai')).toBe(true)
    expect(getStoredProviderKey('openai')).toBeNull()
    expect(unsetStoredProviderKey('openai')).toBe(false)
  })

  it('rejects reserved/invalid provider ids (no prototype pollution / data loss)', () => {
    expect(() => setStoredProviderKey('__proto__', 'x')).toThrow(/Invalid provider id/)
    expect(() => setStoredProviderKey('constructor', 'x')).toThrow(/Invalid provider id/)
    expect(() => setStoredProviderKey('bad id!', 'x')).toThrow(/Invalid provider id/)
    expect(getStoredProviderKey('openai')).toBeNull()
    expect(listStoredProviders()).toEqual([])
    // a key under a "polluted" name never leaks into a real provider lookup
    expect(getStoredProviderKey('__proto__')).toBeNull()
  })

  it('writes the store file with 0600 permissions', () => {
    setStoredProviderKey('google', 'g-stored')
    const path = join(testDir, 'secrets.json')
    expect(existsSync(path)).toBe(true)
    // Low 9 permission bits should be owner-read/write only.
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('resolves env over the store and reports the source', () => {
    setStoredProviderKey('openai', 'sk-stored')
    process.env.OPENAI_API_KEY = 'sk-env'
    expect(resolveProviderApiKeySource('openai')).toEqual({ apiKey: 'sk-env', source: 'env' })
  })

  it('falls back to the store when no env key is present', () => {
    setStoredProviderKey('google', 'g-stored')
    expect(resolveProviderApiKeySource('google')).toEqual({ apiKey: 'g-stored', source: 'store' })
  })

  describe('named secrets', () => {
    it('round-trips a named secret per provider', () => {
      setStoredSecret('brave', 'apiKey', 'bsk-1')
      setStoredSecret('discord', 'botToken', 'tok-1')
      expect(getStoredSecret('brave', 'apiKey')).toBe('bsk-1')
      expect(getStoredSecret('discord', 'botToken')).toBe('tok-1')
      expect(getStoredSecret('discord', 'apiKey')).toBeNull()
    })

    it('lists secret NAMES per provider — never values', () => {
      setStoredSecret('brave', 'apiKey', 'bsk-1')
      setStoredSecret('discord', 'botToken', 'tok-1')
      setStoredSecret('discord', 'appId', 'app-1')
      expect(listStoredSecrets()).toEqual({ brave: ['apiKey'], discord: ['appId', 'botToken'] })
    })

    it('unsets a single named secret and drops the provider when empty', () => {
      setStoredSecret('discord', 'botToken', 'tok-1')
      setStoredSecret('discord', 'appId', 'app-1')
      expect(unsetStoredSecret('discord', 'botToken')).toBe(true)
      expect(getStoredSecret('discord', 'botToken')).toBeNull()
      expect(getStoredSecret('discord', 'appId')).toBe('app-1')
      expect(unsetStoredSecret('discord', 'appId')).toBe(true)
      expect(listStoredSecrets()).toEqual({})
      expect(unsetStoredSecret('discord', 'appId')).toBe(false)
    })

    it('interoperates with the legacy apiKey wrappers (same slot)', () => {
      setStoredProviderKey('openai', 'sk-legacy')
      expect(getStoredSecret('openai', 'apiKey')).toBe('sk-legacy')
      setStoredSecret('openai', 'apiKey', 'sk-named')
      expect(getStoredProviderKey('openai')).toBe('sk-named')
      expect(listStoredProviders()).toEqual(['openai'])
    })

    it('a provider with only non-apiKey secrets is absent from listStoredProviders', () => {
      setStoredSecret('discord', 'botToken', 'tok-1')
      expect(listStoredProviders()).toEqual([])
      expect(listStoredSecrets()).toEqual({ discord: ['botToken'] })
    })

    it('rejects invalid secret names and reserved keys', () => {
      expect(() => setStoredSecret('brave', '__proto__', 'x')).toThrow(/Invalid secret name/)
      expect(() => setStoredSecret('brave', 'bad name!', 'x')).toThrow(/Invalid secret name/)
      expect(() => setStoredSecret('__proto__', 'apiKey', 'x')).toThrow(/Invalid provider id/)
      expect(listStoredSecrets()).toEqual({})
    })

    it('keeps 0600 permissions when writing named secrets', () => {
      setStoredSecret('brave', 'apiKey', 'bsk-1')
      expect(statSync(join(testDir, 'secrets.json')).mode & 0o777).toBe(0o600)
    })
  })
})
