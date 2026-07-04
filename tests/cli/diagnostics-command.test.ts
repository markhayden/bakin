import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetSettingsCache } from '../../src/core/settings'

const harness = setupTtyCliHarness({
  exitMode: 'zero-or-undefined-returns',
  defaultIsTTY: null,
  saveEnv: ['BAKIN_HOME', 'BAKIN_CONSOLE_FORMAT', 'BAKIN_DISABLE_FILE_LOG'],
})
const { fetchMock, output } = harness

describe('diagnostics CLI command', () => {
  let tempDir: string

  beforeEach(() => {
    resetSettingsCache()
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-diagnostics-cli-'))
    process.env.BAKIN_HOME = tempDir
    process.env.BAKIN_DISABLE_FILE_LOG = '1'
    delete process.env.BAKIN_CONSOLE_FORMAT
    fetchMock.mockRejectedValue(new TypeError('fetch should not be called'))
  })

  afterEach(() => {
    resetSettingsCache()
    rmSync(tempDir, { recursive: true, force: true })
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
    harness.log.mockClear()

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
    harness.log.mockClear()

    process.argv = ['bun', 'cli/bakin.ts', 'diagnostics', 'startup', 'off', '--json']
    await main()

    expect(fetchMock).not.toHaveBeenCalled()
    const body = JSON.parse(output()) as { startup: { enabled: boolean; slowMs: number } }
    expect(body.startup.enabled).toBe(false)
  })
})
