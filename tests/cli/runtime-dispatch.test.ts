import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { APP_VERSION } from '../../packages/core/src/constants'
import { setStdoutIsTTY, setupTtyCliHarness, withTempBakinHome } from './helpers/tty-cli-harness'

const execFileSync = mock((..._args: unknown[]) => '')

mock.module('child_process', () => ({
  execFileSync,
}))

const harness = setupTtyCliHarness({ exitMode: 'none', defaultFetchJson: { ok: true } })
const { fetchMock, output, errorOutput, jsonResponse } = harness
// The HTTP CLI resolves its target ONCE at load (`CLI_TARGET`, BAKIN_URL-aware).
// Load it now, under the preload's BAKIN_URL, so a test that clears the variable
// for the in-process update path cannot pin a server-less target for the
// status/other HTTP commands that run after it.
await import('../../src/cli/http')

describe('bakin runtime binary dispatch', () => {
  beforeEach(() => {
    execFileSync.mockReset()
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

  /** The test preload points BAKIN_URL at a dead port; `bakin update` honours it (review r14 #1), so the local path needs it absent. */
  async function withoutBakinUrl(run: () => Promise<void>): Promise<void> {
    const saved = process.env.BAKIN_URL
    delete process.env.BAKIN_URL
    try {
      await run()
    } finally {
      if (saved !== undefined) process.env.BAKIN_URL = saved
    }
  }

  it('renders binary update failures with the shared TUI when stdout is a TTY', async () => {
    // No server in this home (and no BAKIN_URL): the update runs in-process as
    // the self-update operation; the release lookup fails and the failure is the card.
    await withoutBakinUrl(() => withTempBakinHome('bakin-test-dispatch-update-', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      const { dispatchCli } = await import('../../src/core/cli')

      const result = await dispatchCli(['bun', 'bakin', 'update'])

      expect(result).toEqual({ startServer: false, exitCode: 1 })
      expect(output()).toContain('Command failed  bakin update')
      expect(output()).toContain('Could not fetch release info: HTTP 500')
      expect(output()).toContain('UPDATE_FAILED')
      expect(errorOutput()).toBe('')
    }))
  })

  it('keeps binary update failures plain outside TTY', async () => {
    setStdoutIsTTY(false)
    await withoutBakinUrl(() => withTempBakinHome('bakin-test-dispatch-update-plain-', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      const { dispatchCli } = await import('../../src/core/cli')

      const result = await dispatchCli(['bun', 'bakin', 'update'])

      expect(result).toEqual({ startServer: false, exitCode: 1 })
      expect(output()).toContain('Fetching latest release')
      expect(errorOutput()).toContain('Could not fetch release info: HTTP 500')
    }))
  })

  it('with BAKIN_URL set, `bakin update` targets THAT server and never replaces this binary (review r14 #1)', async () => {
    setStdoutIsTTY(false)
    await withTempBakinHome('bakin-test-dispatch-update-remote-', async () => {
      // The preload's BAKIN_URL names a dead port: unreachable is the answer, and no release is ever fetched.
      fetchMock.mockRejectedValueOnce(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }))
      const { dispatchCli } = await import('../../src/core/cli')
      const result = await dispatchCli(['bun', 'bakin', 'update'])
      expect(result).toEqual({ startServer: false, exitCode: 1 })
      expect(errorOutput()).toContain('(BAKIN_URL) did not answer')
      expect(output()).not.toContain('Fetching latest release')
    })
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
    // stop reads THIS home's server.lock: a temp home, never the real one.
    // No service is loaded: launchctl/systemctl answer the way they do for an unknown job.
    execFileSync.mockImplementation((cmd: unknown) => {
      if (cmd === 'launchctl' || cmd === 'systemctl') throw Object.assign(new Error('exit 113'), { stdout: '', stderr: cmd === 'launchctl' ? 'Could not find service' : 'Failed to connect to bus: No such file or directory' })
      return ''
    })
    await withTempBakinHome('bakin-test-dispatch-stop-', async () => {
      const { dispatchCli } = await import('../../src/core/cli')

      const result = await dispatchCli(['bun', 'bakin', 'stop'])

      expect(result).toEqual({ startServer: false, exitCode: 0 })
      expect(output()).toContain('Runtime action')
      expect(output()).toContain('No running Bakin server for this home.')
      expect(errorOutput()).toBe('')
    })
  })
})
