/**
 * Snapshot dir + tarball permission regression test (commit C23).
 *
 * C16 added chmod 0o700 on the .uninstalled dir and chmod 0o600 on the
 * tarball file because plugin-settings JSON inside may contain secrets.
 * No previous test pinned these; a regression that drops them silently
 * was invisible. This file makes that visible.
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, statSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-snapshot-perms-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { snapshotUninstall } from '../../../src/core/plugins/uninstall-snapshot'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

describe('snapshotUninstall permissions', () => {
  it('creates ~/.bakin/.uninstalled/ with mode 0700 and tarball with mode 0600', async () => {
    // Build a minimal plugin dir + settings file so the snapshot has content.
    const pluginDir = join(testDir, 'plugins', 'permtest')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(join(pluginDir, 'bakin-plugin.json'), '{"id":"permtest","version":"1.0.0"}', 'utf-8')

    const settingsFile = join(testDir, 'plugin-settings', 'permtest.json')
    mkdirSync(join(testDir, 'plugin-settings'), { recursive: true })
    writeFileSync(settingsFile, JSON.stringify({ apiKey: 'sk-secret' }), 'utf-8')

    const result = await snapshotUninstall({
      pluginId: 'permtest',
      pluginDir,
      settingsFile,
      removedSkillDirs: [],
    })

    // Tarball directory is restricted to the owner (no group/other access).
    const dirMode = statSync(join(testDir, '.uninstalled')).mode & 0o777
    expect(dirMode).toBe(0o700)

    // Tarball itself is owner-only — settings JSON inside may contain secrets.
    const fileMode = statSync(result.tarballPath).mode & 0o777
    expect(fileMode).toBe(0o600)
  })
})
