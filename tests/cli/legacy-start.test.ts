import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'

let spawnCalls: unknown[][] = []
let onboarded = false

function fakeChildProcess() {
  return {
    once(event: string, handler: (value?: unknown) => void) {
      if (event === 'close') handler(0)
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
    process.exitCode = originalExitCode
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    spawnCalls = []
    onboarded = false
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
})
