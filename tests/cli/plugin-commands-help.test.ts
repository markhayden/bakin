/**
 * Plugin-contributed CLI commands surface in help (audit P2 #7: they were
 * dispatchable via the manifest but invisible in `bakin --help`). Help must
 * always render — an unreachable server or malformed manifest degrades to
 * the static usage, never an error.
 */
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// The help flow is HTTP-only (fetch is mocked), but the isolation mocks are
// mandatory insurance: nothing this test transitively imports may ever
// resolve the real ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-plugin-cmd-help-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const fetchMock = mock()

describe('plugin commands in CLI help', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalFetch = globalThis.fetch
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  let log: ReturnType<typeof spyOn>

  function setStdoutIsTTY(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
  }

  function jsonResponse(body: unknown): Response {
    return { ok: true, json: () => Promise.resolve(body), text: () => Promise.resolve('') } as Response
  }

  function output(): string {
    return log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
  }

  const manifestWithCommands = {
    plugins: [
      { id: 'projects', contributes: { cliCommands: [
        { name: 'projects:list', usage: 'bakin projects list', summary: 'List projects.' },
      ] } },
      { id: 'messaging', contributes: {} },
    ],
  }

  beforeEach(() => {
    mock.clearAllMocks()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    log = spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
    process.exit = ((code?: number) => {
      if (code === 0) return undefined as never
      throw new Error(`exit:${code}`)
    }) as never
    setStdoutIsTTY(false)
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    globalThis.fetch = originalFetch
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    mock.restore()
  })

  it('non-TTY --help appends a Plugin commands section when the manifest lists them', async () => {
    fetchMock.mockResolvedValue(jsonResponse(manifestWithCommands))
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? 0}`)
    }) as never
    process.argv = ['bun', 'cli/bakin.ts', '--help']
    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:0')

    const text = output()
    expect(text).toContain('Plugin commands:')
    expect(text).toContain('bakin projects list')
    expect(text).toContain('List projects.')
  })

  it('help degrades to the static usage when the server is unreachable', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }))
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? 0}`)
    }) as never
    process.argv = ['bun', 'cli/bakin.ts', '--help']
    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:0')

    const text = output()
    expect(text).toContain('Usage: bakin <command>')
    expect(text).not.toContain('Plugin commands:')
  })

  it('pluginCommandHelpGroups returns [] on a manifest without commands', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ plugins: [{ id: 'x' }] }))
    const { pluginCommandHelpGroups } = await import('../../src/cli/help')
    expect(await pluginCommandHelpGroups()).toEqual([])
  })
})
