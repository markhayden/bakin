import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dispatchCli } from '../../src/core/cli'

const mockFetch = mock()

describe('bakin plugins binary dispatch', () => {
  const originalFetch = globalThis.fetch
  const originalCwd = process.cwd()
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  let log: ReturnType<typeof spyOn>
  let error: ReturnType<typeof spyOn>

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
    globalThis.fetch = mockFetch as unknown as typeof fetch
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
      text: () => Promise.resolve(''),
    } as Response)
    log = spyOn(console, 'log').mockImplementation(() => {})
    error = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.chdir(originalCwd)
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    log.mockRestore()
    error.mockRestore()
  })

  it('delegates plugin list to the shared source CLI TUI', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
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
