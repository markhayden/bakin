/**
 * Manifest-driven plugin command dispatch: strict declared args, the
 * contributing plugin's id in route paths, and global flags (--json, --as)
 * that never leak into command params.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'

const testDir = join(tmpdir(), `bakin-test-plugin-dispatch-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { dispatchPluginCliCommand } from '../../src/cli/commands/plugin-dispatch'

const harness = setupTtyCliHarness({ defaultIsTTY: false, exitMode: 'always-throws' })
const { fetchMock, jsonResponse, errorOutput } = harness

const manifest = {
  plugins: [
    { id: 'projects', contributes: { cliCommands: [{
      name: 'projects:create',
      usage: 'bakin projects create <title>',
      summary: 'Create a project',
      dispatch: { type: 'execTool', name: 'bakin_exec_projects_create' },
      args: [
        { name: 'title', type: 'string', positional: true, required: true },
        { name: 'tasks', type: 'string[]' },
      ],
    }] } },
    { id: 'terminal', contributes: { cliCommands: [{
      name: 'terminal:attach',
      usage: 'bakin terminal attach <ref>',
      summary: 'Attach this terminal',
      dispatch: { type: 'apiRoute', method: 'POST', path: '/cli/attach', launch: { bin: 'tmux' } },
      args: [{ name: 'ref', type: 'string', positional: true, required: true }],
    }, {
      name: 'term:ls',
      usage: 'bakin term ls',
      summary: 'List terminal sessions',
      dispatch: { type: 'apiRoute', method: 'GET', path: '/cli/sessions' },
      args: [],
    }] } },
  ],
}

function requestTo(index: number): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit]
  return { url, init }
}

describe('dispatchPluginCliCommand', () => {
  it('sends typed params to the exec tool and drops global flags', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(manifest)).mockResolvedValueOnce(jsonResponse({ ok: true }))

    expect(await dispatchPluginCliCommand('projects', ['create', 'a,b', '--tasks', 'x', '--tasks', 'y', '--json', '--as', 'human'])).toBe(true)

    const { url, init } = requestTo(1)
    expect(url).toEndWith('/api/exec-tools/bakin_exec_projects_create')
    expect(JSON.parse(String(init.body))).toEqual({ params: { title: 'a,b', tasks: ['x', 'y'] }, agent: 'cli' })
  })

  it('routes apiRoute commands under the contributing plugin id, not the typed word', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(manifest)).mockResolvedValueOnce(jsonResponse({ sessions: [] }))

    expect(await dispatchPluginCliCommand('term', ['ls'])).toBe(true)

    expect(requestTo(1).url).toEndWith('/api/plugins/terminal/cli/sessions')
  })

  it('refuses an invalid invocation with the command usage and sends nothing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(manifest))

    await expect(dispatchPluginCliCommand('projects', ['create', 'T', '--nope', 'x'])).rejects.toThrow('exit:1')

    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(errorOutput()).toContain('Unknown option --nope')
    expect(errorOutput()).toContain('bakin projects create <title>')
  })

  it('returns false when no plugin declares the command', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(manifest))

    expect(await dispatchPluginCliCommand('projects', ['archive', 'p1'])).toBe(false)
  })

  it('runs launch commands through the launcher, which refuses a non-interactive caller before posting', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(manifest))

    await expect(dispatchPluginCliCommand('terminal', ['attach', 's1', '--as', 'human'])).rejects.toThrow('exit:1')

    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(errorOutput()).toContain('run it from an interactive terminal')
  })

  it('refuses a malformed --as before anything is prepared', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(manifest))

    await expect(dispatchPluginCliCommand('terminal', ['attach', 's1', '--as=human', '--as='])).rejects.toThrow('exit:1')

    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(errorOutput()).toContain('--as needs a value')
  })
})
