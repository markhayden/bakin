/**
 * #898 K — the in-process restart (self-update) drives the service only when
 * the LOADED service's pid is THIS process; a plist/unit file existing is
 * the next launch's config, possibly another home's.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-server-restart-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testDir, 'openclaw'), getOpenClawPath: (...p: string[]) => join(testDir, 'openclaw', ...p), resetOpenClawHome: () => {} }))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }))

let servicePid: number | null = null
mock.module('../../src/core/service-manager', () => ({ loadedServicePid: () => servicePid }))
const spawns: Array<{ args: string[]; env: Record<string, string> }> = []
const execs: string[][] = []
mock.module('node:child_process', () => ({
  spawn: (_cmd: string, args: string[], opts: { env: Record<string, string> }) => { spawns.push({ args, env: opts.env }); return { pid: 4242, unref() {} } },
  execFileSync: (cmd: string, args: string[]) => { execs.push([cmd, ...args]); return '' },
}))

import { activateServerRestart, prepareServerRestart, scheduleServerRestart } from '../../src/core/server-restart'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => { spawns.length = 0; execs.length = 0; servicePid = null; Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true }) })
afterAll(() => Object.defineProperty(process, 'platform', platform))

describe('prepareServerRestart / activateServerRestart (#1007 D7.11 P19)', () => {
  it('preparing proves the standalone path without spawning or arming anything; activating spawns the successor', () => {
    servicePid = null
    spawns.length = 0
    const prepared = prepareServerRestart(500, { execPath: process.execPath })
    expect(prepared).toMatchObject({ ok: true, strategy: 'standalone-child', delayMs: 500, execPath: process.execPath })
    expect(spawns).toEqual([])
    const armed = activateServerRestart(prepared)
    expect(armed).toMatchObject({ ok: true, strategy: 'standalone-child', restartDelayMs: 500 })
    expect(spawns).toHaveLength(1)
  })

  it('a successor that cannot run (no executable) fails preparation — nothing is armed, so the update refuses before the swap', () => {
    servicePid = null
    spawns.length = 0
    const prepared = prepareServerRestart(500, { execPath: join(testDir, 'missing-bakin') })
    expect(prepared.ok).toBe(false)
    expect((prepared as { error: string }).error).toContain('not runnable')
    const armed = activateServerRestart(prepared)
    expect(armed.ok).toBe(false)
    expect(spawns).toEqual([])
  })

  it('a loaded service running THIS process prepares as a service restart (no spawn either way)', () => {
    servicePid = process.pid
    spawns.length = 0
    const prepared = prepareServerRestart(250)
    expect(prepared).toMatchObject({ ok: true, strategy: process.platform === 'darwin' ? 'launchagent' : 'systemd' })
    expect(spawns).toEqual([])
  })
})

describe('scheduleServerRestart', () => {
  it('uses the service only when the loaded service runs THIS process', () => {
    servicePid = process.pid
    expect(scheduleServerRestart(10_000).strategy).toBe('launchagent')
    expect(spawns).toEqual([])
  })

  it('a loaded service running another pid (another home) is never driven — the standalone child carries THIS home, absolute', () => {
    servicePid = 99999
    const result = scheduleServerRestart(10_000)
    expect(result.strategy).toBe('standalone-child')
    expect(spawns).toHaveLength(1)
    expect(spawns[0]!.env.BAKIN_HOME).toBe(testDir)
    expect(execs.some((c) => c.includes('kickstart'))).toBe(false)
  })

  it('no loaded service → the standalone child', () => {
    expect(scheduleServerRestart(10_000).strategy).toBe('standalone-child')
  })
})
