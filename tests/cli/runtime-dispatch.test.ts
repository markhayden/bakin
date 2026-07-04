import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { APP_VERSION } from '../../packages/core/src/constants'
import { setStdoutIsTTY, setupTtyCliHarness } from './helpers/tty-cli-harness'

const execFileSync = mock((..._args: unknown[]) => '')

mock.module('child_process', () => ({
  execFileSync,
}))

const harness = setupTtyCliHarness({ exitMode: 'none', defaultFetchJson: { ok: true } })
const { fetchMock, output, errorOutput, jsonResponse } = harness

describe('bakin runtime binary dispatch', () => {
  beforeEach(() => {
    execFileSync.mockReturnValue('')
  })

  it('renders binary help with the shared TUI when stdout is a TTY', async () => {
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['bun', 'bakin', '--help'])

    expect(result).toEqual({ startServer: false, exitCode: 0 })
    expect(output()).toContain("┃ 🐷 Bakin'")
    expect(output()).toContain('Help')
    expect(output()).toContain('LIFECYCLE')
    expect(output()).not.toContain('Usage: bakin <command> [options]')
    expect(errorOutput()).toBe('')
  })

  it('renders binary version with the shared TUI when stdout is a TTY', async () => {
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['bun', 'bakin', 'version'])

    expect(result).toEqual({ startServer: false, exitCode: 0 })
    expect(output()).toContain("┃ 🐷 Bakin'")
    expect(output()).toContain(`Version  v${APP_VERSION}`)
    expect(output()).toContain(APP_VERSION)
    expect(errorOutput()).toBe('')
  })

  it('keeps binary version plain outside TTY', async () => {
    setStdoutIsTTY(false)
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['bun', 'bakin', '--version'])

    expect(result).toEqual({ startServer: false, exitCode: 0 })
    expect(output()).toBe(APP_VERSION)
    expect(errorOutput()).toBe('')
  })

  it('starts the server for the hidden restart child argv shape', async () => {
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['bakin', '__bakin-restart-child', '999999999'])

    expect(result).toEqual({ startServer: true, exitCode: 0 })
    expect(errorOutput()).toBe('')
  })

  it('renders binary update failures with the shared TUI when stdout is a TTY', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response)
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['bun', 'bakin', 'update'])

    expect(result).toEqual({ startServer: false, exitCode: 1 })
    expect(output()).toContain('Command failed  bakin update')
    expect(output()).toContain('Could not fetch release info: HTTP 500')
    expect(output()).toContain('UPDATE_FAILED')
    expect(errorOutput()).toBe('')
  })

  it('keeps binary update failures plain outside TTY', async () => {
    setStdoutIsTTY(false)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response)
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['bun', 'bakin', 'update'])

    expect(result).toEqual({ startServer: false, exitCode: 1 })
    expect(output()).toContain('Fetching latest release')
    expect(errorOutput()).toContain('Could not fetch release info: HTTP 500')
  })

  it('delegates status to the shared source CLI TUI', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        intervalMin: 5,
        lastRun: '2026-05-18T04:00:00.000Z',
        nextRun: '2026-05-18T04:05:00.000Z',
        secondsUntilNext: 120,
        dispatchedCount: 7,
      }))
      .mockResolvedValueOnce(jsonResponse({ agents: [{ id: 'main' }, { id: 'patch' }], mainAgentId: 'main' }))
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['bun', 'bakin', 'status'])

    expect(result).toEqual({ startServer: false, exitCode: 0 })
    expect(output()).toContain('Status')
    expect(output()).toContain('DISPATCH')
    expect(output()).not.toContain('=== Bakin Status ===')
    expect(errorOutput()).toBe('')
  })

  it('delegates stop to the shared source CLI TUI', async () => {
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['bun', 'bakin', 'stop'])

    expect(result).toEqual({ startServer: false, exitCode: 0 })
    expect(output()).toContain('Runtime action')
    expect(output()).toContain('No running Bakin process found.')
    expect(output()).not.toContain('No running Bakin server at')
    expect(errorOutput()).toBe('')
  })
})
