/**
 * The plugin lockfile holds installed provenance only (#1007 B 8.6): the
 * retired check markers (`lastChecked`, `remoteHeadSha`,
 * `remoteArtifactVersion`, `remoteArtifactRebuild`, `lastSourceTreeSha`) a
 * pre-#1007 `bakin plugins list --check` wrote are dropped on read, and a
 * read never writes the file.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readPluginLockfile } from '../../../packages/core/src/plugins/lockfile'

const testDir = join(tmpdir(), `bakin-test-lockfile-legacy-markers-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('plugin lockfile — retired check markers', () => {
  it('a row carrying the pre-#1007 markers reads without them; the file is not rewritten', () => {
    const path = join(testDir, 'lock.json')
    const raw = JSON.stringify({
      version: 1,
      plugins: {
        notes: {
          source: 'github:acme/notes', type: 'github', ref: 'main', commitSha: 'a'.repeat(40), installedAt: '2026-10-01T00:00:00.000Z',
          version: '1.0.0', permissions: [], manifestSha: 'c'.repeat(64),
          lastChecked: '2026-10-02T00:00:00.000Z', remoteHeadSha: 'b'.repeat(40), remoteArtifactVersion: '1.1.0', remoteArtifactRebuild: true,
          sourceTreeSha: 'd'.repeat(64), lastSourceTreeSha: 'e'.repeat(64),
        },
      },
    }, null, 2)
    writeFileSync(path, raw)

    const lock = readPluginLockfile(path)
    const row = lock.plugins.notes as Record<string, unknown>
    for (const marker of ['lastChecked', 'remoteHeadSha', 'remoteArtifactVersion', 'remoteArtifactRebuild', 'lastSourceTreeSha']) {
      expect(row).not.toHaveProperty(marker)
    }
    // Installed provenance survives.
    expect(row.sourceTreeSha).toBe('d'.repeat(64))
    expect(row.commitSha).toBe('a'.repeat(40))
    expect(readFileSync(path, 'utf-8')).toBe(raw)
  })
})
