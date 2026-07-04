import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dispatchCli } from '../../src/core/cli'
import { setStdoutIsTTY, setupTtyCliHarness } from './helpers/tty-cli-harness'

const harness = setupTtyCliHarness({ exitMode: 'none', defaultIsTTY: null, defaultFetchJson: { ok: true } })
const { fetchMock: mockFetch, output, errorOutput } = harness

describe('bakin plugins binary dispatch', () => {

  it('delegates plugin list to the shared source CLI TUI', async () => {
    setStdoutIsTTY(true)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        plugins: [
          { id: 'tasks', name: 'Tasks', version: '2.1.0', source: 'core', status: 'active', routes: 12 },
        ],
      }),
      text: () => Promise.resolve(''),
    } as Response)

    const result = await dispatchCli(['bun', 'bakin', 'plugins', 'list'])

    expect(result).toEqual({ startServer: false, exitCode: 0 })
    expect(output()).toContain('Plugins')
    expect(output()).toContain('INSTALLED PLUGINS')
    expect(output()).toContain('tasks')
    expect(output()).not.toContain('ID              NAME')
    expect(errorOutput()).toBe('')
  })

  it('prints structured JSON for plugin upgrade API errors with --json', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'cannot upgrade core plugin: tasks' }),
      text: () => Promise.resolve('{"error":"cannot upgrade core plugin: tasks"}'),
    } as Response)

    const result = await dispatchCli(['bun', 'bakin', 'plugins', 'upgrade', 'tasks', '--yes', '--json'])

    expect(result).toEqual({ startServer: false, exitCode: 1 })
    expect(output()).toContain('"ok": false')
    expect(output()).toContain('"status": 400')
    expect(output()).toContain('"error": "cannot upgrade core plugin: tasks"')
    expect(errorOutput()).toBe('')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3737/api/plugins/upgrade',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ pluginId: 'tasks', yes: true }),
      }),
    )
  })

  it('supports plugin scaffold --json in the binary dispatcher', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakin-dispatch-scaffold-'))
    process.chdir(dir)

    const result = await dispatchCli(['bun', 'bakin', 'plugins', 'scaffold', 'json-dispatch-plugin', '--json'])

    expect(result).toEqual({ startServer: false, exitCode: 0 })
    expect(output()).toContain('"ok": true')
    expect(output()).toContain('"id": "json-dispatch-plugin"')
    expect(output()).not.toContain('Scaffolded plugin at')
    expect(existsSync(join(dir, 'json-dispatch-plugin', 'bakin-plugin.json'))).toBe(true)
  })
})
