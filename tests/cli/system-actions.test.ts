import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'
import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'

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
    expect(output()).toContain('No running Bakin process found.')
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
    expect(output()).toContain('Version: test')
    expect(output()).not.toContain('[..] Starting Bakin server')
    expect(spawn).toHaveBeenCalled()
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

  it('restarts through launchctl when the LaunchAgent is installed', async () => {
    const { main } = await import('../../cli/bakin')

    existsSync.mockImplementation((path?: unknown) => String(path).endsWith('com.makinbakin.bakin.plist'))
    process.argv = ['bun', 'cli/bakin.ts', 'restart']
    await main()

    expect(execFileSync).toHaveBeenCalledWith('launchctl', ['kickstart', '-k', 'gui/501/com.makinbakin.bakin'], expect.any(Object))
    expect(spawn).not.toHaveBeenCalled()
    expect(output()).toContain('Bakin restarted.')
    expect(output()).toContain('Service: com.makinbakin.bakin')
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
