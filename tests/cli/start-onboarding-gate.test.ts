import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

let onboarded = false

mock.module('../../src/core/onboarding/state', () => ({
  isOnboarded: () => onboarded,
}))

describe('CLI start onboarding gate', () => {
  let originalSkip: string | undefined

  beforeEach(() => {
    onboarded = false
    originalSkip = process.env.BAKIN_SKIP_ONBOARDING_CHECK
    delete process.env.BAKIN_SKIP_ONBOARDING_CHECK
  })

  afterEach(() => {
    if (originalSkip === undefined) delete process.env.BAKIN_SKIP_ONBOARDING_CHECK
    else process.env.BAKIN_SKIP_ONBOARDING_CHECK = originalSkip
  })

  it('blocks start when onboarding has not completed', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['node', 'bakin', 'start'])

    expect(result).toEqual({ startServer: false, exitCode: 1 })
    expect(errorSpy.mock.calls.map(call => String(call[0])).join('\n')).toContain('bakin onboard')
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
