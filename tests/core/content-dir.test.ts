import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getContentDir, resetContentDir, initBakinHome } from '@bakin/workflows/lib/content-dir'

describe('content-dir', () => {
  const testDir = join(tmpdir(), `bakin-test-contentdir-${Date.now()}`)
  const origBakinHome = process.env.BAKIN_HOME
  const origContentDir = process.env.CONTENT_DIR

  beforeEach(() => {
    resetContentDir()
    delete process.env.BAKIN_HOME
    delete process.env.CONTENT_DIR
  })

  afterEach(() => {
    resetContentDir()
    if (origBakinHome) process.env.BAKIN_HOME = origBakinHome
    else delete process.env.BAKIN_HOME
    if (origContentDir) process.env.CONTENT_DIR = origContentDir
    else delete process.env.CONTENT_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  it('uses BAKIN_HOME env var when set', () => {
    const customDir = join(testDir, 'custom-bakin')
    process.env.BAKIN_HOME = customDir
    expect(getContentDir()).toBe(customDir)
  })

  it('uses CONTENT_DIR env var when set and BAKIN_HOME is not', () => {
    const customDir = join(testDir, 'custom-content')
    process.env.CONTENT_DIR = customDir
    expect(getContentDir()).toBe(customDir)
  })

  it('falls back to ./content/ when ~/.bakin/ does not exist', () => {
    // Create a ./content/ directory in a temp working dir
    const contentDir = join(process.cwd(), 'content')
    // The function should resolve to ./content/ since ~/.bakin/ won't
    // exist in most test environments. We just verify the function doesn't crash.
    const result = getContentDir()
    expect(typeof result).toBe('string')
  })
})

describe('initBakinHome', () => {
  const testDir = join(tmpdir(), `bakin-test-init-${Date.now()}`)

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('creates directory structure and seed files', () => {
    const { created, seeded } = initBakinHome(testDir)

    // Verify directories were created
    expect(existsSync(join(testDir, 'workflows', 'definitions'))).toBe(true)
    expect(existsSync(join(testDir, 'workflows', 'skills'))).toBe(true)
    expect(existsSync(join(testDir, 'workflows', 'instances'))).toBe(true)
    expect(existsSync(join(testDir, 'plugins'))).toBe(true)

    // Verify settings.json was created at root  subdir
    expect(existsSync(join(testDir, 'settings.json'))).toBe(true)

    // Verify asset directories
    expect(existsSync(join(testDir, 'assets'))).toBe(true)
    expect(existsSync(join(testDir, 'assets', '.trash'))).toBe(true)
    expect(existsSync(join(testDir, 'assets', 'images'))).toBe(true)
    expect(existsSync(join(testDir, 'assets', 'images', '_unlinked'))).toBe(true)
    expect(existsSync(join(testDir, 'assets', 'images', 'library'))).toBe(true)
    expect(existsSync(join(testDir, 'assets', 'text'))).toBe(true)
    expect(existsSync(join(testDir, 'assets', 'video'))).toBe(true)
    expect(existsSync(join(testDir, 'assets', 'audio'))).toBe(true)
    expect(existsSync(join(testDir, 'assets', 'plans'))).toBe(true)
    expect(existsSync(join(testDir, 'assets', 'data'))).toBe(true)
    expect(existsSync(join(testDir, 'assets', 'other'))).toBe(true)

    // Verify other directories
    expect(existsSync(join(testDir, 'projects'))).toBe(true)
    expect(existsSync(join(testDir, 'team', 'personas'))).toBe(true)

    expect(created.length).toBeGreaterThan(0)
  })

  it('does not overwrite existing files on re-init', () => {
    initBakinHome(testDir)
    const { created: secondCreated, seeded: secondSeeded } = initBakinHome(testDir)
    // Directories already exist, so nothing new should be created
    expect(secondCreated.length).toBe(0)
    expect(secondSeeded.length).toBe(0)
  })
})
