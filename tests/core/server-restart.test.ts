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

import { scheduleServerRestart } from '../../src/core/server-restart'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => { spawns.length = 0; execs.length = 0; servicePid = null; Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true }) })
afterAll(() => Object.defineProperty(process, 'platform', platform))

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
