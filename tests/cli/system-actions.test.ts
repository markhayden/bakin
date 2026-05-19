import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
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

describe('CLI system action TUI commands', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  let log: ReturnType<typeof spyOn>
  let error: ReturnType<typeof spyOn>

  function output(): string {
    return log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
  }

  beforeEach(() => {
    mock.clearAllMocks()
    execFileSync.mockImplementation((...args: unknown[]) => args[0] === 'id' ? '501\n' : '')
    existsSync.mockReturnValue(false)
    spawn.mockReturnValue({ pid: 4242, unref: mock() })
    homedir.mockReturnValue('/Users/tester')
    process.argv = originalArgv
    globalThis.fetch = mock(async () => ({ ok: true, json: async () => ({ version: 'test' }) })) as unknown as typeof fetch
    globalThis.setTimeout = ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
      if (typeof handler === 'function') handler(...args)
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    log = spyOn(console, 'log').mockImplementation(() => {})
    error = spyOn(console, 'error').mockImplementation(() => {})
    process.exit = ((code?: number) => {
      if (code === 0) return undefined as never
      throw new Error(`exit:${code}`)
    }) as never
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    log.mockRestore()
    error.mockRestore()
  })

  it('renders stop results with the shared runtime action TUI in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    process.argv = ['bun', 'cli/bakin.ts', 'stop']
    await main()

    expect(output()).toContain('Runtime action')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('No running Bakin process found.')
    expect(output()).not.toContain('[OK]')
    expect(error.mock.calls).toHaveLength(0)
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
    expect(error.mock.calls).toHaveLength(0)
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
    expect(error.mock.calls).toHaveLength(0)
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
    expect(error.mock.calls).toHaveLength(0)
  })
})
