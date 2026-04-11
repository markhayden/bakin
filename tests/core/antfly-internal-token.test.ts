import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { generateToken, verifyToken, getOrCreateToken } from '../../src/core/antfly-internal-token'
import { resetSettingsCache, getSettings } from '../../src/core/settings'
import { resetContentDir } from '../../src/core/content-dir'

const TEST_CONTENT_DIR = path.join(process.cwd(), 'test-content-internal-token')
const SETTINGS_FILE = path.join(TEST_CONTENT_DIR, 'settings.json')

describe('antfly-internal-token', () => {
  beforeEach(() => {
    process.env.CONTENT_DIR = TEST_CONTENT_DIR
    resetContentDir()
    resetSettingsCache()
    if (fs.existsSync(TEST_CONTENT_DIR)) {
      fs.rmSync(TEST_CONTENT_DIR, { recursive: true })
    }
    fs.mkdirSync(TEST_CONTENT_DIR, { recursive: true })
  })

  afterEach(() => {
    delete process.env.CONTENT_DIR
    resetContentDir()
    resetSettingsCache()
    if (fs.existsSync(TEST_CONTENT_DIR)) {
      fs.rmSync(TEST_CONTENT_DIR, { recursive: true })
    }
  })

  describe('generateToken', () => {
    it('produces 64 hex characters (32 bytes)', () => {
      const token = generateToken()
      expect(token).toMatch(/^[0-9a-f]{64}$/)
    })

    it('produces unique tokens across calls', () => {
      const a = generateToken()
      const b = generateToken()
      expect(a).not.toBe(b)
    })
  })

  describe('verifyToken', () => {
    it('accepts matching tokens', () => {
      const token = generateToken()
      expect(verifyToken(token, token)).toBe(true)
    })

    it('rejects mismatched tokens of the same length', () => {
      const a = generateToken()
      const b = generateToken()
      expect(verifyToken(a, b)).toBe(false)
    })

    it('rejects tokens of different lengths without throwing', () => {
      expect(verifyToken('short', generateToken())).toBe(false)
    })

    it('rejects null, undefined, and empty provided tokens', () => {
      const expected = generateToken()
      expect(verifyToken(null, expected)).toBe(false)
      expect(verifyToken(undefined, expected)).toBe(false)
      expect(verifyToken('', expected)).toBe(false)
    })

    it('rejects when expected token is empty', () => {
      expect(verifyToken('anything', '')).toBe(false)
    })
  })

  describe('getOrCreateToken', () => {
    it('generates and persists a token on first call', () => {
      const token = getOrCreateToken()
      expect(token).toMatch(/^[0-9a-f]{64}$/)

      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
      expect(raw.antfly.internal.token).toBe(token)
    })

    it('returns the same token across calls when already persisted', () => {
      const first = getOrCreateToken()
      resetSettingsCache()
      const second = getOrCreateToken()
      expect(second).toBe(first)
    })

    it('preserves a port value already set in settings', () => {
      fs.writeFileSync(
        SETTINGS_FILE,
        JSON.stringify({ antfly: { internal: { token: '', port: 4242 } } }),
      )
      resetSettingsCache()

      getOrCreateToken()

      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
      expect(raw.antfly.internal.port).toBe(4242)
    })

    it('applies the default port when none is set in settings', () => {
      getOrCreateToken()
      expect(getSettings().antfly.internal.port).toBe(3738)
    })
  })
})
