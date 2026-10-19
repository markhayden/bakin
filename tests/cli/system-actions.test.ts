import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'
import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'
import * as realServerLock from '../../src/core/server-lock'

const execFileSync = mock((..._args: unknown[]) => '')
const existsSync = mock(() => false)
const mkdirSync = mock()
const unlinkSync = mock()
const writeFileSync = mock()
const homedir = mock(() => '/Users/tester')
const spawn = mock(() => ({
  pid: 4242,
  unref: mock(),
}))

mock.module('child_process', () => ({
  execFileSync,
  spawn,
}))

mock.module('fs', () => ({
  ...nodeFs,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
}))

mock.module('os', () => ({
  ...nodeOs,
  homedir,
}))

// Lifecycle verification reads THIS home's live server.lock: the started or
// restarted server answers on 3737.
const serverLock = { ...realServerLock }
mock.module('../../src/core/server-lock', () => ({
  ...serverLock,
  liveServerBaseUrl: () => 'http://localhost:3737',
}))

// stop/restart never reach a real lock, process, service or socket (#898 K):
// the lifecycle IO is a fake each test configures.
import type { LifecycleIo, LockInfo } from '../../src/cli/lifecycle-control'
let fakeLock: LockInfo | null = null
let serviceOwns = false
const servedBoots = new Map<number, { bootId: string; pid: number }>()
const fakeIo = (): LifecycleIo => ({
  platform: 'darwin',
  home: '/Users/tester/.bakin',
  selfPid: 1,
  readLock: () => fakeLock,
  pidAlive: (pid) => fakeLock?.pid === pid,
  http: async (method, port, path) => {
    const boot = servedBoots.get(port)
    if (!boot || method !== 'GET' || path !== '/api/version') return null
    return { status: 200, body: { version: 'test', pid: boot.pid, bootId: boot.bootId, state: 'serving' } }
  },
  listProcesses: () => [],
  exec: (cmd, args) => {
    execFileSync(cmd, args, {})
    if (args[0] === 'print') return serviceOwns && fakeLock ? { ok: true, output: `x = {\n\tpid = ${fakeLock.pid}\n}` } : { ok: false, output: 'Could not find service' }
    if (args[0] === 'kickstart') { fakeLock = { pid: 7777, port: 3737, bootId: 'boot-service', cliSecret: 's' }; servedBoots.set(3737, { pid: 7777, bootId: 'boot-service' }) }
    return { ok: true, output: '' }
  },
  uid: () => '501',
  readFile: () => null,
  launchAgentPath: () => '/Users/tester/Library/LaunchAgents/com.makinbakin.bakin.plist',
  systemdUnitPath: () => '/Users/tester/.config/systemd/user/com.makinbakin.bakin.service',
  spawnServer: () => {
    fakeLock = { pid: 4242, port: 3737, bootId: 'boot-new', cliSecret: 's' }
    servedBoots.set(3737, { pid: 4242, bootId: 'boot-new' })
    return { pid: 4242, exitedEarly: () => false, error: () => null }
  },
  now: () => 0,
  sleep: async () => {},
})
mock.module('../../src/cli/lifecycle-io', () => ({
  canonicalHome: () => '/Users/tester/.bakin',
  realLifecycleIo: async () => fakeIo(),
}))

const harness = setupTtyCliHarness()
const { fetchMock, output } = harness

describe('CLI system action TUI commands', () => {
  const originalSetTimeout = globalThis.setTimeout
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  function writtenTextForPath(suffix: string): string {
    const call = writeFileSync.mock.calls.find((args: unknown[]) => String(args[0]).endsWith(suffix))
    return call ? String(call[1]) : ''
  }

  beforeEach(() => {
    execFileSync.mockImplementation((...args: unknown[]) => args[0] === 'id' ? '501\n' : '')
    existsSync.mockReturnValue(false)
    spawn.mockReturnValue({ pid: 4242, unref: mock() })
    homedir.mockReturnValue('/Users/tester')
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ version: 'test' }) } as Response)
    globalThis.setTimeout = ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
      if (typeof handler === 'function') handler(...args)
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    fakeLock = null
    serviceOwns = false
    servedBoots.clear()
  })

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
  })

  it('renders stop results with the shared runtime action TUI in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    process.argv = ['bun', 'cli/bakin.ts', 'stop']
    await main()

    expect(output()).toContain('Runtime action')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('No running Bakin server for this home.')
    expect(output()).not.toContain('[OK]')
    expect(harness.error.mock.calls).toHaveLength(0)
  })

  it('renders restart results with the shared runtime action TUI in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    process.argv = ['bun', 'cli/bakin.ts', 'restart']
    await main()

    expect(output()).toContain('Runtime action')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('Bakin restarted.')
    expect(output()).toContain('Started process 4242.')
    expect(output()).toContain('version test')
    expect(output()).not.toContain('[..]')
    expect(harness.error.mock.calls).toHaveLength(0)
  })

  it('renders setup service enable results with the shared runtime action TUI in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    process.argv = ['bun', 'cli/bakin.ts', 'setup', 'service']
    await main()

    expect(output()).toContain('Runtime action')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('Bakin autostart enabled.')
    expect(output()).toContain('Service: com.makinbakin.bakin')
    expect(output()).toContain('Disable: bakin setup service --uninstall')
    expect(output()).not.toContain('[OK]')
    expect(writeFileSync).toHaveBeenCalled()
    expect(execFileSync).toHaveBeenCalledWith('launchctl', expect.arrayContaining(['bootstrap', 'gui/501', expect.any(String)]), expect.any(Object))
    expect(harness.error.mock.calls).toHaveLength(0)
  })

  it('uses the real executable when compiled argv points at Bun virtual fs', async () => {
    const { main } = await import('../../cli/bakin')

    process.argv = ['/usr/local/bin/bakin', '/$bunfs/root/bakin-darwin-arm64', 'setup', 'service']
    await main()

    const plist = writtenTextForPath('com.makinbakin.bakin.plist')
    expect(plist).toContain(`<string>${process.execPath}</string>`)
    expect(plist).toContain('<string>serve</string>')
    expect(plist).toContain('<key>WorkingDirectory</key>')
    expect(plist).toContain('<string>/Users/tester/.bakin</string>')
    expect(plist).not.toContain('/$bunfs')
  })

  it('restarts through launchctl only when the loaded service owns this home\'s proven server — never because a plist exists (#898 K)', async () => {
    const { main } = await import('../../cli/bakin')

    // This home's server answers as itself, and the loaded service's pid IS it.
    fakeLock = { pid: 500, port: 3737, bootId: 'boot-old', cliSecret: 's' }
    servedBoots.set(3737, { pid: 500, bootId: 'boot-old' })
    serviceOwns = true
    process.argv = ['bun', 'cli/bakin.ts', 'restart']
    await main()

    expect(execFileSync).toHaveBeenCalledWith('launchctl', ['kickstart', '-k', 'gui/501/com.makinbakin.bakin'], expect.any(Object))
    expect(output()).toContain('Bakin restarted.')
    expect(output()).toContain('Restarted through the Bakin service')
  })

  it('a plist alone (service not owning anything here) never kickstarts — a manual start instead', async () => {
    const { main } = await import('../../cli/bakin')

    existsSync.mockImplementation((path?: unknown) => String(path).endsWith('com.makinbakin.bakin.plist'))
    process.argv = ['bun', 'cli/bakin.ts', 'restart']
    await main()

    expect(execFileSync).not.toHaveBeenCalledWith('launchctl', ['kickstart', '-k', 'gui/501/com.makinbakin.bakin'], expect.any(Object))
    expect(output()).toContain('Started process 4242.')
  })

  it('renders setup service uninstall results with the shared runtime action TUI in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    process.argv = ['bun', 'cli/bakin.ts', 'setup', 'service', '--uninstall']
    await main()

    expect(output()).toContain('Runtime action')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('Bakin autostart disabled.')
    expect(output()).toContain('Service: com.makinbakin.bakin')
    expect(output()).not.toContain('[OK]')
    expect(harness.error.mock.calls).toHaveLength(0)
  })
})
