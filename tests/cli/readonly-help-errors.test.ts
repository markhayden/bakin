/**
 * Read-only CLI TTY commands — help, version, update, unknown commands, and
 * shared error rendering (command issues, API errors, connection failures).
 * Split from readonly-commands.test.ts (B7).
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { APP_VERSION } from '../../packages/core/src/constants'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'

// These flows are HTTP-only (fetch is mocked), but the isolation mocks are
// mandatory insurance: nothing this test transitively imports may ever
// resolve the real ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-readonly-help-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const harness = setupTtyCliHarness({ defaultFetchJson: { ok: true } })
const { fetchMock, output, errorOutput, setStdoutIsTTY, jsonResponse } = harness

describe('read-only CLI TTY commands — help and errors', () => {
  it('renders top-level help with the shared TUI when stdout is a TTY', async () => {
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? 0}`)
    }) as never
    process.argv = ['bun', 'cli/bakin.ts', '--help']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:0')

    expect(output()).toContain("┃ 🐷 Bakin'")
    expect(output()).toContain('Help')
    expect(output()).toContain('LIFECYCLE')
    expect(output()).toContain('TASKS AND WORKFLOWS')
    expect(output()).not.toContain('Usage: bakin <command> [options]')
    expect(errorOutput()).toBe('')
  })

  it('prints a no-op guidance message for `update` on the source CLI', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'update']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(output()).toContain('Self-update is only available in the compiled')
    expect(output()).toContain('brew upgrade bakin')
    expect(errorOutput()).toBe('')
  })

  it('accepts help as a source CLI alias for the shared TUI help', async () => {
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? 0}`)
    }) as never
    process.argv = ['bun', 'cli/bakin.ts', 'help']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:0')

    expect(output()).toContain('Help')
    expect(output()).toContain('LIFECYCLE')
    expect(errorOutput()).toBe('')
  })

  it('renders source CLI version with the shared TUI when stdout is a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'version']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(output()).toContain("┃ 🐷 Bakin'")
    expect(output()).toContain(`Version  v${APP_VERSION}`)
    expect(output()).toContain(APP_VERSION)
    expect(errorOutput()).toBe('')
  })

  it('renders unknown top-level commands with help in the shared TUI', async () => {
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? 0}`)
    }) as never
    fetchMock.mockResolvedValueOnce(jsonResponse({ plugins: [] }))
    process.argv = ['bun', 'cli/bakin.ts', 'wat']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(errorOutput()).toBe('')
    expect(output()).toContain("┃ 🐷 Bakin'")
    expect(output()).toContain('Help  unknown command')
    expect(output()).toContain('ISSUE')
    expect(output()).toContain('Unknown command: wat')
    expect(output()).not.toContain('Usage: bakin <command> [options]')
  })

  it('still renders unknown-command help when plugin command lookup cannot reach the server', async () => {
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? 0}`)
    }) as never
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    process.argv = ['bun', 'cli/bakin.ts', 'wat']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(errorOutput()).toBe('')
    expect(output()).toContain('Help  unknown command')
    expect(output()).toContain('Plugin command lookup skipped')
    expect(output()).not.toContain('Error: Cannot connect to Bakin')
  })

  it('renders doctor repair command issues with the shared TUI when stdout is a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', 'repair', 'wat']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(output()).toContain('Command issue  bakin doctor repair')
    expect(output()).toContain('Unknown doctor repair subcommand: wat')
    expect(output()).toContain('list | show | verify')
    expect(errorOutput()).toBe('')
  })

  it('renders parsed API JSON errors without raw response bodies', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Failed to restore asset' }),
      text: () => Promise.resolve('{"error":"Failed to restore asset"}'),
    } as Response)
    process.argv = ['bun', 'cli/bakin.ts', 'trash', 'restore', 'test']

    await expect(main()).rejects.toThrow('exit:1')
    expect(output()).toContain('Command failed  bakin trash restore test')
    expect(output()).toContain('HTTP 500: Failed to restore asset')
    expect(output()).not.toContain('{"error"')
    expect(errorOutput()).toBe('')
  })

  it('renders server connection failures with the shared TUI when stdout is a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'list']

    await expect(main()).rejects.toThrow('exit:1')
    expect(output()).toContain('Command failed  bakin tasks list')
    expect(output()).toContain('Cannot connect to Bakin. Is the server running?')
    expect(output()).toContain('SERVER_UNREACHABLE')
    expect(output()).toContain('Run `bakin start`')
    expect(errorOutput()).toBe('')
  })

  it('keeps server connection failures plain outside TTY', async () => {
    setStdoutIsTTY(false)
    const { main } = await import('../../cli/bakin')

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'list']

    await expect(main()).rejects.toThrow('exit:1')
    expect(output()).toBe('')
    expect(errorOutput()).toContain('Error: Cannot connect to Bakin. Is the server running?')
    expect(errorOutput()).toContain('Run `bakin start` to launch the server.')
  })
})
