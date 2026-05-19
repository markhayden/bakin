import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

const execFileSync = mock(() => '')
const spawn = mock(() => ({
  pid: 4242,
  unref: mock(),
}))

mock.module('child_process', () => ({
  execFileSync,
  spawn,
}))

describe('CLI system action TUI commands', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  let log: ReturnType<typeof spyOn>
  let error: ReturnType<typeof spyOn>

  function output(): string {
    return log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
  }

  beforeEach(() => {
    mock.clearAllMocks()
    execFileSync.mockReturnValue('')
    spawn.mockReturnValue({ pid: 4242, unref: mock() })
    process.argv = originalArgv
    globalThis.fetch = mock(async () => ({ ok: true, json: async () => ({ version: 'test' }) })) as unknown as typeof fetch
    globalThis.setTimeout = ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
      if (typeof handler === 'function') handler(...args)
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout
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
})
