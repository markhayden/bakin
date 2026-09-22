/**
 * Plugin settings writes are atomic (tmp + rename): a write that dies
 * mid-flight can never leave a truncated settings file behind, and a reader
 * always sees the previous complete document until the rename lands.
 * Groundwork for the crash-safe models.json → spend.json upgrade (PR 2).
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-settings-atomic-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { mergePluginSettings, pluginSettingsPath, readPluginSettings, writePluginSettings } from '../../packages/core/src/plugins/settings-store'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('plugin settings store — atomic writes', () => {
  it('writes through a temp file and renames; no temp file survives a completed write', () => {
    writePluginSettings('probe', { a: 1 })
    expect(readPluginSettings<Record<string, unknown>>('probe')).toEqual({ a: 1 })
    const leftovers = readdirSync(join(testDir, 'plugin-settings')).filter((f) => f.includes('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('a stale temp file from an interrupted write never shadows the last complete document', () => {
    writePluginSettings('probe', { a: 1 })
    // Simulate a crash between writing the temp file and renaming it.
    writeFileSync(`${pluginSettingsPath('probe')}.tmp`, '{"a":')
    expect(readPluginSettings<Record<string, unknown>>('probe')).toEqual({ a: 1 })
    // The next write replaces the temp file and lands cleanly.
    mergePluginSettings('probe', { b: 2 })
    expect(JSON.parse(readFileSync(pluginSettingsPath('probe'), 'utf8'))).toEqual({ a: 1, b: 2 })
    expect(existsSync(`${pluginSettingsPath('probe')}.tmp`)).toBe(false)
  })
})
