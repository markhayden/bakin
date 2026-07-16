/**
 * Pin: Pi auto-compaction stays ON for Bakin turns (pi-parity T3.5 / P0
 * adjudication). Long tasks COMPACT rather than die because the SDK's
 * settings default is enabled and the adapter's per-turn SettingsManager
 * (messaging.ts: SettingsManager.create(workspace, agentDir, ...)) inherits
 * it. If the pinned SDK ever flips this default, this test fails and
 * messaging.ts must enable compaction explicitly.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-pi-session-settings-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = pathJoin(testDir, 'pi')
process.env.BAKIN_HOME = testDir

import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: pathJoin(testDir, 'bakin.db') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: pathJoin(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { createTurnSettingsManager } from '../../packages/adapter-pi/src/messaging'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('pi session settings (SDK default pin)', () => {
  it('compaction is enabled by default in the adapter-shaped SettingsManager', () => {
    const workspace = pathJoin(testDir, 'pi', 'agents', 'main', 'workspace')
    const agentDir = pathJoin(testDir, 'pi', 'agent')
    mkdirSync(workspace, { recursive: true })
    mkdirSync(agentDir, { recursive: true })

    // THE construction Bakin turns use (exported from messaging.ts).
    const settings = createTurnSettingsManager(workspace, agentDir)
    const compaction = settings.getCompactionSettings()
    expect(compaction.enabled).toBe(true)
    expect(compaction.reserveTokens).toBeGreaterThan(0)
    expect(compaction.keepRecentTokens).toBeGreaterThan(0)
  })
})
