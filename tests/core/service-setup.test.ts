/**
 * The ONE Bakin service-setup engine (self-healing PR1 slice 1.3c): unit
 * generation and the load decision, shared by `bakin setup service` (which
 * restarts) and Health's `service-setup` repair (which never kills a running
 * server — the maintenance coordinator owns restarts from PR3 on).
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-service-setup-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, logs: join(testDir, 'logs'), db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) }))

import { generateLaunchAgentPlist, generateSystemdUnit, setupBakinService, type ServiceSetupIo } from '../../src/core/service-setup'

const launch = { programArgs: ['/usr/local/bin/bakin', 'serve'], workingDir: testDir }

function fakeIo(over: Partial<ServiceSetupIo> & { loaded?: boolean; serverPid?: number | null } = {}): { io: ServiceSetupIo; calls: string[][]; written: Map<string, string>; removed: string[] } {
  const calls: string[][] = []
  const written = new Map<string, string>()
  const removed: string[] = []
  const { loaded = false, serverPid = null, ...rest } = over
  const io: ServiceSetupIo = {
    platform: 'darwin',
    homedir: () => '/Users/tester',
    uid: () => '501',
    launch: async () => launch,
    environment: async () => ({ PATH: '/usr/bin', BAKIN_HOME: testDir }),
    exec: (cmd, args) => {
      calls.push([cmd, ...args])
      if (cmd === 'launchctl' && args[0] === 'print') return loaded ? { ok: true, output: 'x = {\n\tstate = running\n\tpid = 42\n}' } : { ok: false, output: 'Could not find service' }
      return { ok: true, output: '' }
    },
    exists: (path) => written.has(path),
    readFile: (path) => written.get(path) ?? null,
    writeFile: (path, text) => { written.set(path, text) },
    mkdir: () => {},
    unlink: (path) => { removed.push(path); written.delete(path) },
    serverOutsideService: () => (serverPid ? { pid: serverPid } : null),
    waitForServer: async () => ({ ok: true, version: 'test' }),
    ...rest,
  }
  return { io, calls, written, removed }
}

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true }) })

describe('unit generation', () => {
  it('the LaunchAgent plist names the label, program, environment, working dir, RunAtLoad and KeepAlive', () => {
    const plist = generateLaunchAgentPlist({ programArgs: ['/x/bakin', 'serve'], environment: { BAKIN_HOME: '/h & co' }, workingDir: '/w', stdoutPath: '/o', stderrPath: '/e' })
    expect(plist).toContain('<string>com.makinbakin.bakin</string>')
    expect(plist).toContain('<string>/x/bakin</string>\n    <string>serve</string>')
    expect(plist).toContain('<key>BAKIN_HOME</key>\n    <string>/h &amp; co</string>')
    expect(plist).toContain('<key>WorkingDirectory</key>\n  <string>/w</string>')
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>')
    expect(plist).toContain('<key>KeepAlive</key>\n  <true/>')
  })
  it('the systemd unit quotes its ExecStart and environment', () => {
    const unit = generateSystemdUnit({ programArgs: ['/x/bakin', 'serve'], environment: { BAKIN_HOME: '/h' }, workingDir: '/w', stdoutPath: '/o', stderrPath: '/e' })
    expect(unit).toContain('ExecStart="/x/bakin" "serve"')
    expect(unit).toContain('Environment="BAKIN_HOME=/h"')
    expect(unit).toContain('WorkingDirectory="/w"')
  })
})

describe('setupBakinService', () => {
  const plistPath = '/Users/tester/Library/LaunchAgents/com.makinbakin.bakin.plist'

  it('restart mode (the CLI): writes the unit, bootstraps and kickstarts, then waits for the server', async () => {
    const { io, calls, written } = fakeIo()
    const result = await setupBakinService({ restart: true }, io)
    expect(result).toMatchObject({ ok: true, platform: 'darwin', unitPath: plistPath, loaded: 'restarted', started: { ok: true, version: 'test' } })
    expect(written.get(plistPath)).toContain('<string>serve</string>')
    expect(calls).toContainEqual(['launchctl', 'bootstrap', 'gui/501', plistPath])
    expect(calls).toContainEqual(['launchctl', 'kickstart', '-k', 'gui/501/com.makinbakin.bakin'])
  })

  it('repair mode on an unloaded service with nothing else running: writes and bootstraps, never kickstarts', async () => {
    const { io, calls } = fakeIo()
    const result = await setupBakinService({ restart: false }, io)
    expect(result.loaded).toBe('started')
    expect(calls).toContainEqual(['launchctl', 'bootstrap', 'gui/501', plistPath])
    expect(calls.some((c) => c[1] === 'kickstart')).toBe(false)
  })

  it('repair mode on a LOADED service: the unit is rewritten and the running job is left alone (no bootout, no kickstart)', async () => {
    const { io, calls, written } = fakeIo({ loaded: true })
    const result = await setupBakinService({ restart: false }, io)
    expect(result.loaded).toBe('kept')
    expect(result.message).toMatch(/next restart/i)
    expect(written.has(plistPath)).toBe(true)
    expect(calls.filter((c) => c[0] === 'launchctl').map((c) => c[1])).toEqual(['print'])
  })

  it('repair mode when a Bakin server runs OUTSIDE the service: the unit is written, loading is deferred, nothing is started twice', async () => {
    const { io, calls } = fakeIo({ serverPid: 777 })
    const result = await setupBakinService({ restart: false }, io)
    expect(result.loaded).toBe('deferred')
    expect(result.message).toContain('777')
    expect(calls.some((c) => c[1] === 'bootstrap' || c[1] === 'kickstart')).toBe(false)
  })

  it('uninstall boots the job out and removes the unit (legacy labels too)', async () => {
    const { io, calls, written, removed } = fakeIo()
    written.set(plistPath, 'old')
    const result = await setupBakinService({ uninstall: true, restart: false }, io)
    expect(result).toMatchObject({ ok: true, loaded: 'removed' })
    expect(calls).toContainEqual(['launchctl', 'bootout', 'gui/501', plistPath])
    expect(removed).toContain(plistPath)
  })

  it('linux writes the user unit and enables it; an unsupported platform is refused', async () => {
    const { io, calls, written } = fakeIo({ platform: 'linux' })
    const result = await setupBakinService({ restart: true }, io)
    expect(result.unitPath).toBe('/Users/tester/.config/systemd/user/com.makinbakin.bakin.service')
    expect(written.get(result.unitPath)).toContain('ExecStart=')
    expect(calls).toContainEqual(['systemctl', '--user', 'enable', '--now', 'com.makinbakin.bakin.service'])
    const other = await setupBakinService({ restart: true }, fakeIo({ platform: 'win32' }).io)
    expect(other.ok).toBe(false)
    expect(other.message).toContain('not supported')
  })
})
