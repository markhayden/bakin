import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetSettingsCache } from '../../src/core/settings'

describe('diagnostics CLI command', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalFetch = globalThis.fetch
  const originalBakinHome = process.env.BAKIN_HOME
  const originalConsoleFormat = process.env.BAKIN_CONSOLE_FORMAT
  const originalDisableFileLog = process.env.BAKIN_DISABLE_FILE_LOG

  let tempDir: string
  let log: ReturnType<typeof spyOn>
  let error: ReturnType<typeof spyOn>
  const fetchMock = mock()

  function output(): string {
    return log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
  }

  beforeEach(() => {
    mock.clearAllMocks()
    resetSettingsCache()
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-diagnostics-cli-'))
    process.env.BAKIN_HOME = tempDir
    process.env.BAKIN_DISABLE_FILE_LOG = '1'
    delete process.env.BAKIN_CONSOLE_FORMAT
    process.argv = originalArgv
    process.exit = ((code?: number) => {
      if (code === 0 || code === undefined) return undefined as never
      throw new Error(`exit:${code}`)
    }) as never
    globalThis.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockRejectedValue(new TypeError('fetch should not be called'))
    log = spyOn(console, 'log').mockImplementation(() => {})
    error = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetSettingsCache()
    process.argv = originalArgv
    process.exit = originalExit
    globalThis.fetch = originalFetch
    if (originalBakinHome === undefined) delete process.env.BAKIN_HOME
    else process.env.BAKIN_HOME = originalBakinHome
    if (originalConsoleFormat === undefined) delete process.env.BAKIN_CONSOLE_FORMAT
    else process.env.BAKIN_CONSOLE_FORMAT = originalConsoleFormat
    if (originalDisableFileLog === undefined) delete process.env.BAKIN_DISABLE_FILE_LOG
    else process.env.BAKIN_DISABLE_FILE_LOG = originalDisableFileLog
    rmSync(tempDir, { recursive: true, force: true })
    log.mockRestore()
    error.mockRestore()
  })

  it('enables startup diagnostics in local settings without a running server', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'diagnostics', 'startup', 'on', '--slow-ms', '123', '--json']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(fetchMock).not.toHaveBeenCalled()
    const body = JSON.parse(output()) as { startup: { enabled: boolean; slowMs: number } }
    expect(body.startup).toEqual({ enabled: true, slowMs: 123 })

    const settingsPath = join(tempDir, 'settings.json')
    expect(existsSync(settingsPath)).toBe(true)
    const onDisk = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    expect(onDisk.diagnostics.startup).toEqual({ enabled: true, slowMs: 123 })
  })

  it('reports startup diagnostics status from local settings', async () => {
    const { main } = await import('../../cli/bakin')
    process.argv = ['bun', 'cli/bakin.ts', 'diagnostics', 'startup', 'on', '--slow-ms=321', '--json']
    await main()
    log.mockClear()

    process.argv = ['bun', 'cli/bakin.ts', 'diagnostics', 'startup', 'status', '--json']
    await main()

    expect(fetchMock).not.toHaveBeenCalled()
    const body = JSON.parse(output()) as { startup: { enabled: boolean; slowMs: number } }
    expect(body.startup).toEqual({ enabled: true, slowMs: 321 })
  })

  it('disables startup diagnostics in local settings', async () => {
    const { main } = await import('../../cli/bakin')
    process.argv = ['bun', 'cli/bakin.ts', 'diagnostics', 'startup', 'on', '--json']
    await main()
    log.mockClear()

    process.argv = ['bun', 'cli/bakin.ts', 'diagnostics', 'startup', 'off', '--json']
    await main()

    expect(fetchMock).not.toHaveBeenCalled()
    const body = JSON.parse(output()) as { startup: { enabled: boolean; slowMs: number } }
    expect(body.startup.enabled).toBe(false)
  })
})
