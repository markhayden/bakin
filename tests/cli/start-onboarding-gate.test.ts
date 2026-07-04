import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { setStdoutIsTTY, setupTtyCliHarness } from './helpers/tty-cli-harness'

let onboarded = false

mock.module('../../src/core/onboarding/state', () => ({
  isOnboarded: () => onboarded,
}))

const harness = setupTtyCliHarness({
  exitMode: 'none',
  mockFetch: false,
  saveEnv: ['BAKIN_SKIP_ONBOARDING_CHECK'],
})

describe('CLI start onboarding gate', () => {
  beforeEach(() => {
    onboarded = false
    delete process.env.BAKIN_SKIP_ONBOARDING_CHECK
  })

  it('blocks start with the shared onboarding TUI when onboarding has not completed', async () => {
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['node', 'bakin', 'start'])

    expect(result).toEqual({ startServer: false, exitCode: 1 })
    const output = harness.log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
    expect(output).toContain("┃ 🐷 Bakin'")
    expect(output).toContain('Onboard')
    expect(output).toContain('Initial setup required')
    expect(output).toContain('Run `bakin onboard`')
    expect(harness.error.mock.calls).toHaveLength(0)
  })

  it('keeps plain start gate errors for non-TTY output', async () => {
    setStdoutIsTTY(false)
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['node', 'bakin', 'start'])

    expect(result).toEqual({ startServer: false, exitCode: 1 })
    const output = harness.error.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
    expect(output).toContain('Bakin has not been onboarded on this machine.')
    expect(output).toContain('bakin onboard')
    expect(harness.log.mock.calls).toHaveLength(0)
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
