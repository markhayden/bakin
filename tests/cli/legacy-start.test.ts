import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'

let spawnCalls: unknown[][] = []
let onboarded = false
let spawnError: Error | null = null

function fakeChildProcess() {
  let closeHandler: ((value?: unknown) => void) | undefined
  let errorHandler: ((value?: unknown) => void) | undefined
  let settled = false

  const settle = () => {
    queueMicrotask(() => {
      if (settled) return
      if (spawnError && errorHandler) {
        settled = true
        errorHandler(spawnError)
        return
      }
      if (!spawnError && closeHandler) {
        settled = true
        closeHandler(0)
      }
    })
  }

  return {
    once(event: string, handler: (value?: unknown) => void) {
      if (event === 'close') closeHandler = handler
      if (event === 'error') errorHandler = handler
      settle()
      return this
    },
  }
}

mock.module('child_process', () => ({
  spawn: (...args: unknown[]) => {
    spawnCalls.push(args)
    return fakeChildProcess()
  },
  execSync: () => '',
}))

mock.module('../../src/core/onboarding/state', () => ({
  isOnboarded: () => onboarded,
}))

describe('legacy CLI start command', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalExitCode = process.exitCode
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    process.exitCode = originalExitCode ?? 0
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    spawnCalls = []
    onboarded = false
    spawnError = null
  })

  it('renders the shared onboarding gate instead of the old unknown command path', async () => {
    const err = spyOn(console, 'error').mockImplementation(() => {})
    const log = spyOn(console, 'log').mockImplementation(() => {})
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    process.argv = ['bun', 'cli/bakin.ts', 'start']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(process.exitCode).toBe(1)
    expect(spawnCalls).toHaveLength(0)
    expect(err.mock.calls).toHaveLength(0)
    const output = log.mock.calls.map(call => String(call[0])).join('\n')
    expect(output).toContain('Onboard')
    expect(output).toContain('Initial setup required')
    expect(output).toContain('Run `bakin onboard`')
    log.mockRestore()
    err.mockRestore()
  })

  it('starts the source server in the foreground after onboarding is complete', async () => {
    onboarded = true
    const err = spyOn(console, 'error').mockImplementation(() => {})
    const log = spyOn(console, 'log').mockImplementation(() => {})
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    process.argv = ['bun', 'cli/bakin.ts', 'start']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(process.exitCode).toBe(0)
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0][1]).toEqual(expect.arrayContaining(['serve']))
    expect(String((spawnCalls[0][1] as string[])[0])).toContain('server.ts')
    expect(spawnCalls[0][2]).toEqual(expect.objectContaining({ stdio: 'inherit' }))
    expect(err.mock.calls).toHaveLength(0)
    expect(log.mock.calls).toHaveLength(0)
    log.mockRestore()
    err.mockRestore()
  })

  it('renders foreground start spawn failures with the shared TUI', async () => {
    onboarded = true
    spawnError = new Error('spawn denied')
    const err = spyOn(console, 'error').mockImplementation(() => {})
    const log = spyOn(console, 'log').mockImplementation(() => {})
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    process.argv = ['bun', 'cli/bakin.ts', 'start']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(process.exitCode).toBe(1)
    expect(spawnCalls).toHaveLength(1)
    const output = log.mock.calls.map(call => String(call[0])).join('\n')
    expect(output).toContain('Command failed  bakin start')
    expect(output).toContain('Failed to start Bakin.')
    expect(output).toContain('START_FAILED')
    expect(output).toContain('spawn denied')
    expect(err.mock.calls).toHaveLength(0)
    log.mockRestore()
    err.mockRestore()
  })
})
