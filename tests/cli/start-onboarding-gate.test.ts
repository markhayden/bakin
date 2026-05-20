import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

let onboarded = false

mock.module('../../src/core/onboarding/state', () => ({
  isOnboarded: () => onboarded,
}))

describe('CLI start onboarding gate', () => {
  let originalSkip: string | undefined
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

  beforeEach(() => {
    onboarded = false
    originalSkip = process.env.BAKIN_SKIP_ONBOARDING_CHECK
    delete process.env.BAKIN_SKIP_ONBOARDING_CHECK
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
  })

  afterEach(() => {
    if (originalSkip === undefined) delete process.env.BAKIN_SKIP_ONBOARDING_CHECK
    else process.env.BAKIN_SKIP_ONBOARDING_CHECK = originalSkip
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
  })

  it('blocks start with the shared onboarding TUI when onboarding has not completed', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['node', 'bakin', 'start'])

    expect(result).toEqual({ startServer: false, exitCode: 1 })
    const output = logSpy.mock.calls.map(call => String(call[0])).join('\n')
    expect(output).toContain("┃ 🐷 Bakin'")
    expect(output).toContain('Onboard')
    expect(output).toContain('Initial setup required')
    expect(output).toContain('Run `bakin onboard`')
    expect(errorSpy.mock.calls).toHaveLength(0)
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('keeps plain start gate errors for non-TTY output', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['node', 'bakin', 'start'])

    expect(result).toEqual({ startServer: false, exitCode: 1 })
    const output = errorSpy.mock.calls.map(call => String(call[0])).join('\n')
    expect(output).toContain('Bakin has not been onboarded on this machine.')
    expect(output).toContain('bakin onboard')
    expect(logSpy.mock.calls).toHaveLength(0)
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('allows start when onboarding marker is current', async () => {
    onboarded = true
    const { dispatchCli } = await import('../../src/core/cli')

    await expect(dispatchCli(['node', 'bakin', 'start'])).resolves.toEqual({ startServer: true, exitCode: 0 })
  })

  it('allows explicit onboarding gate bypass for development', async () => {
    const { dispatchCli } = await import('../../src/core/cli')

    await expect(dispatchCli(['node', 'bakin', 'start', '--skip-onboarding-check'])).resolves.toEqual({ startServer: true, exitCode: 0 })
  })

  it('allows env-based onboarding gate bypass for development', async () => {
    process.env.BAKIN_SKIP_ONBOARDING_CHECK = '1'
    const { dispatchCli } = await import('../../src/core/cli')

    await expect(dispatchCli(['node', 'bakin', 'start'])).resolves.toEqual({ startServer: true, exitCode: 0 })
  })

  it('allows serve without the human onboarding gate for service managers', async () => {
    const { dispatchCli } = await import('../../src/core/cli')

    await expect(dispatchCli(['node', 'bakin', 'serve'])).resolves.toEqual({ startServer: true, exitCode: 0 })
  })
})
