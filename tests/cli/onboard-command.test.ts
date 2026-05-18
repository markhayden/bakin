import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

const outcomes = [
  {
    name: 'mkdir',
    finalStatus: 'ok',
    check: { name: 'mkdir', status: 'ok', message: 'home ready' },
    message: 'Bakin home directory is initialized at /Users/roscoe/.bakin',
    durationMs: 1,
  },
  {
    name: 'settings',
    finalStatus: 'ok',
    check: { name: 'settings', status: 'ok', message: 'settings ready' },
    message: 'settings.json is present and parses at /Users/roscoe/.bakin/settings.json',
    durationMs: 1,
  },
]

const runOnboard = mock(async (opts: {
  onProgress?: (message: string) => void
  onOutcome?: (outcome: { name: string; finalStatus: 'ok'; message: string }) => void
}) => {
  opts.onProgress?.('Checking mkdir')
  opts.onOutcome?.({ name: 'mkdir', finalStatus: 'ok', message: outcomes[0].message })
  return { outcomes, exitCode: 0, markerWritten: true }
})

mock.module('../../src/core/onboarding/index', () => ({
  runOnboard,
  isOnboarded: () => false,
  loadState: () => null,
  COMPONENT_ORDER: outcomes.map(outcome => ({ name: outcome.name })),
}))

mock.module('../../src/core/cli/onboarding-interactive', () => ({
  collectOnboardingSelections: async () => ({}),
}))

describe('CLI onboard command', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  const originalConsoleFormat = process.env.BAKIN_CONSOLE_FORMAT
  let log: ReturnType<typeof spyOn>
  let stdoutWrite: ReturnType<typeof spyOn>

  function setStdoutIsTTY(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
  }

  beforeEach(() => {
    mock.clearAllMocks()
    process.argv = originalArgv
    log = spyOn(console, 'log').mockImplementation(() => {})
    stdoutWrite = spyOn(process.stdout, 'write').mockImplementation(() => true)
    process.exit = ((code?: number) => {
      if (code === 0) return undefined as never
      throw new Error(`exit:${code}`)
    }) as never
    setStdoutIsTTY(true)
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    if (originalConsoleFormat === undefined) delete process.env.BAKIN_CONSOLE_FORMAT
    else process.env.BAKIN_CONSOLE_FORMAT = originalConsoleFormat
    log.mockRestore()
    stdoutWrite.mockRestore()
  })

  it('renders the shared onboarding summary for TTY completion', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'onboard', '--force']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
    expect(output).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
    expect(output).toContain('Onboarding')
    expect(output).toContain('Machine setup complete')
    expect(output).toContain('PREREQUISITES')
    expect(output).toContain('Run `bakin start` to launch Bakin.')
  })
})
