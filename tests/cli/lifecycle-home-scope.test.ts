/**
 * Local lifecycle verbs act on THIS home's server only (Codex review, #986):
 * `bakin stop` SIGTERMs the pid in this home's live server.lock and nothing
 * else — the old machine-wide `pgrep` match killed every home's server,
 * including one on 3737 that belonged to another home.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-lifecycle-scope-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media'), antfly: join(testDir, 'antfly') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { waitUntil } from '../helpers/wait'
import { run } from '../../src/cli/commands/lifecycle'

// Stand-ins for two homes' servers: idle processes we own.
const spawnIdle = () => Bun.spawn(['bun', '-e', 'setInterval(() => {}, 1000)'], { stdout: 'ignore', stderr: 'ignore' })
const ours = spawnIdle()
const otherHome = spawnIdle()
afterAll(() => {
  for (const p of [ours, otherHome]) { try { p.kill() } catch { /* already gone */ } }
  rmSync(testDir, { recursive: true, force: true })
})

describe('bakin stop', () => {
  it('signals only the pid in this home\'s server.lock — another home\'s server keeps running', async () => {
    writeFileSync(join(testDir, 'server.lock'), JSON.stringify({ pid: ours.pid, port: 3797, startedAt: Date.now(), bootId: 'b' }))
    const log = mock()
    const origLog = console.log
    console.log = log
    try {
      await run(['stop'])
    } finally {
      console.log = origLog
    }
    await waitUntil(() => ours.killed || ours.exitCode !== null || ours.signalCode !== null, { label: 'this home\'s server got SIGTERM' })
    expect(otherHome.exitCode).toBeNull()
    expect(otherHome.signalCode).toBeNull()
    expect(log.mock.calls.flat().join('\n')).toContain('Bakin stopped')
  })
})
