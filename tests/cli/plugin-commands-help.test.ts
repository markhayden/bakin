/**
 * Plugin-contributed CLI commands surface in help (audit P2 #7: they were
 * dispatchable via the manifest but invisible in `bakin --help`). Help must
 * always render — an unreachable server or malformed manifest degrades to
 * the static usage, never an error.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'

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

const harness = setupTtyCliHarness({ defaultIsTTY: false })
const { fetchMock, output, jsonResponse } = harness

describe('plugin commands in CLI help', () => {
  const manifestWithCommands = {
    plugins: [
      { id: 'projects', contributes: { cliCommands: [
        { name: 'projects:list', usage: 'bakin projects list', summary: 'List projects.' },
      ] } },
      { id: 'messaging', contributes: {} },
    ],
  }

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
