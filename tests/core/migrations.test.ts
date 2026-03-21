import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { compareVersions, runMigrations, getStoredVersion } from '@/core/migrations'

describe('migrations', () => {
  let tempDir: string
  let contentDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'beacon-migrations-test-'))
    contentDir = join(tempDir, 'content')
    mkdirSync(join(contentDir, '.beacon'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('compareVersions', () => {
    it('should compare equal versions', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    })

    it('should detect older version', () => {
      expect(compareVersions('1.0.0', '1.1.0')).toBe(-1)
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1)
      expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    })

    it('should detect newer version', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1)
      expect(compareVersions('1.1.0', '1.0.0')).toBe(1)
    })
  })

  describe('runMigrations', () => {
    it('should record version on first run with no migrations', async () => {
      const ran = await runMigrations('test-plugin', '1.0.0', join(tempDir, 'migrations'), contentDir)
      expect(ran).toBe(0)
      expect(getStoredVersion('test-plugin', contentDir)).toBe('1.0.0')
    })

    it('should skip if version unchanged', async () => {
      // First run
      await runMigrations('test-plugin', '1.0.0', join(tempDir, 'migrations'), contentDir)
      // Second run
      const ran = await runMigrations('test-plugin', '1.0.0', join(tempDir, 'migrations'), contentDir)
      expect(ran).toBe(0)
    })

    it('should update version even without migration files', async () => {
      await runMigrations('test-plugin', '1.0.0', join(tempDir, 'migrations'), contentDir)
      const ran = await runMigrations('test-plugin', '1.1.0', join(tempDir, 'migrations'), contentDir)
      expect(ran).toBe(0)
      expect(getStoredVersion('test-plugin', contentDir)).toBe('1.1.0')
    })
  })

  describe('getStoredVersion', () => {
    it('should return null for unknown plugins', () => {
      expect(getStoredVersion('unknown', contentDir)).toBeNull()
    })

    it('should return stored version after migration', async () => {
      await runMigrations('my-plugin', '2.0.0', join(tempDir, 'migrations'), contentDir)
      expect(getStoredVersion('my-plugin', contentDir)).toBe('2.0.0')
    })
  })
})
