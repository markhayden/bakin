import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

const execFileSync = mock((..._args: unknown[]) => '')
const fetchMock = mock()

mock.module('child_process', () => ({
  execFileSync,
}))

describe('bakin runtime binary dispatch', () => {
  const originalFetch = globalThis.fetch
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  let log: ReturnType<typeof spyOn>
  let error: ReturnType<typeof spyOn>

  function jsonResponse(body: unknown): Response {
    return {
      ok: true,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(''),
    } as Response
  }

  function output(): string {
    return log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
  }

  function errorOutput(): string {
    return error.mock.calls
      .map((call: unknown[]) => call.map(part => String(part)).join(' '))
      .join('\n')
  }

  beforeEach(() => {
    mock.clearAllMocks()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    execFileSync.mockReturnValue('')
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    log = spyOn(console, 'log').mockImplementation(() => {})
    error = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    log.mockRestore()
    error.mockRestore()
  })

  it('renders binary help with the shared TUI when stdout is a TTY', async () => {
    const { dispatchCli } = await import('../../src/core/cli')

    const result = await dispatchCli(['bun', 'bakin', '--help'])

    expect(result).toEqual({ startServer: false, exitCode: 0 })
    expect(output()).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
    expect(output()).toContain('Help')
    expect(output()).toContain('LIFECYCLE')
    expect(output()).not.toContain('Usage: bakin <command> [options]')
    expect(errorOutput()).toBe('')
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
