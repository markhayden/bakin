import { afterEach, describe, expect, it, mock } from 'bun:test'
import { setStdoutIsTTY, setupTtyCliHarness } from './helpers/tty-cli-harness'

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

const harness = setupTtyCliHarness({ exitMode: 'none', defaultIsTTY: null, mockFetch: false })

describe('legacy CLI start command', () => {
  afterEach(() => {
    spawnCalls = []
    onboarded = false
    spawnError = null
  })

  it('renders the shared onboarding gate instead of the old unknown command path', async () => {
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'start']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(process.exitCode).toBe(1)
    expect(spawnCalls).toHaveLength(0)
    expect(harness.error.mock.calls).toHaveLength(0)
    const output = harness.log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
    expect(output).toContain('Onboard')
    expect(output).toContain('Initial setup required')
    expect(output).toContain('Run `bakin onboard`')
  })

  it('starts the source server in the foreground after onboarding is complete', async () => {
    onboarded = true
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'start']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(process.exitCode).toBe(0)
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0][1]).toEqual(expect.arrayContaining(['serve']))
    expect(String((spawnCalls[0][1] as string[])[0])).toContain('server.ts')
    expect(spawnCalls[0][2]).toEqual(expect.objectContaining({ stdio: 'inherit' }))
    expect(harness.error.mock.calls).toHaveLength(0)
    expect(harness.log.mock.calls).toHaveLength(0)
  })

  it('renders foreground start spawn failures with the shared TUI', async () => {
    onboarded = true
    spawnError = new Error('spawn denied')
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'start']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(process.exitCode).toBe(1)
    expect(spawnCalls).toHaveLength(1)
    const output = harness.log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
    expect(output).toContain('Command failed  bakin start')
    expect(output).toContain('Failed to start Bakin.')
    expect(output).toContain('START_FAILED')
    expect(output).toContain('spawn denied')
    expect(harness.error.mock.calls).toHaveLength(0)
  })
})
