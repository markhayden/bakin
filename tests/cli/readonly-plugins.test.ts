/**
 * Read-only CLI TTY commands — plugin-contributed commands, plugin lists,
 * plugin lifecycle actions, and plugin restore. Split from
 * readonly-commands.test.ts (B7).
 */
import { describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'

// These flows are HTTP-only (fetch is mocked; scaffold writes into a temp
// cwd), but the isolation mocks are mandatory insurance: nothing this test
// transitively imports may ever resolve the real ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-readonly-plugins-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const harness = setupTtyCliHarness({ defaultFetchJson: { ok: true } })
const { fetchMock, output, errorOutput, setStdoutIsTTY, jsonResponse } = harness

describe('read-only CLI TTY commands — plugins', () => {
  it('renders plugin-contributed command results with the shared TUI in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        plugins: [{
          id: 'demo',
          contributes: {
            cliCommands: [{
              name: 'demo:run',
              usage: 'bakin demo run <target>',
              summary: 'Run demo command.',
              dispatch: { type: 'apiRoute', method: 'POST', path: '/run' },
            }],
          },
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        accepted: true,
        target: 'smoke',
      }))
    process.argv = ['bun', 'cli/bakin.ts', 'demo', 'run', 'smoke', '--loud=true']

    await main()

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3737/api/plugins/demo/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ loud: true, target: 'smoke' }),
      }),
    )
    expect(output()).toContain("┃ 🐷 Bakin'")
    expect(output()).toContain('bakin demo run smoke --loud=true')
    expect(output()).toContain('DATA')
    expect(output()).toContain('"target": "smoke"')
    expect(errorOutput()).toBe('')
  })

  it('honors --json for plugin-contributed commands even in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        plugins: [{
          id: 'demo',
          contributes: {
            cliCommands: [{
              name: 'demo:json',
              usage: 'bakin demo json <target> [--json]',
              summary: 'Show JSON command.',
              dispatch: { type: 'apiRoute', method: 'GET', path: '/json' },
            }],
          },
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        target: 'machine',
      }))
    process.argv = ['bun', 'cli/bakin.ts', 'demo', 'json', 'machine', '--json']

    await main()

    expect(output()).toBe('{\n  "target": "machine"\n}')
    expect(output()).not.toContain("Bakin'")
    expect(errorOutput()).toBe('')
  })

  it('keeps plugin-contributed command results raw outside TTY', async () => {
    setStdoutIsTTY(false)
    const { main } = await import('../../cli/bakin')

    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        plugins: [{
          id: 'demo',
          contributes: {
            cliCommands: [{
              name: 'demo:show',
              usage: 'bakin demo show <target>',
              summary: 'Show demo command.',
              dispatch: { type: 'apiRoute', method: 'GET', path: '/show' },
            }],
          },
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        target: 'plain',
      }))
    process.argv = ['bun', 'cli/bakin.ts', 'demo', 'show', 'plain']

    await main()

    expect(output()).toBe('{\n  "target": "plain"\n}')
    expect(output()).not.toContain("Bakin'")
    expect(errorOutput()).toBe('')
  })

  it('renders plugins list with the shared TUI screen', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      plugins: [
        { id: 'team', name: 'Team', version: '1.0.0', source: 'core', status: 'active' },
        { id: 'tasks', name: 'Tasks', version: '2.1.0', source: 'core', status: 'active' },
        { id: 'schedule', name: 'Schedule', version: '2.0.0', source: 'core', status: 'active' },
        { id: 'assets', name: 'Assets', version: '2.0.0', source: 'core', status: 'active' },
        { id: 'health', name: 'Health', version: '1.0.0', source: 'core', status: 'active' },
        { id: 'models', name: 'Models', version: '2.1.0', source: 'core', status: 'active' },
        { id: 'messaging', name: 'Messaging', version: '2.0.0', source: 'github', status: 'active' },
        { id: 'projects', name: 'Projects', version: '2.0.0', source: 'github', status: 'active' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'list']
    await main()
    expect(output()).toContain('Plugins')
    expect(output()).toContain('SOURCE')
    expect(output()).toContain('tasks')
    expect(output()).toContain('schedule')
    expect(output()).toContain('assets')
    expect(output()).toContain('health')
    expect(output()).toContain('models')
    expect(output()).toContain('messaging')
    expect(output()).toContain('projects')
    expect(output()).not.toContain('Installed plugins:')
  })

  it('renders plugin lifecycle actions with shared TUI screens in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'messaging',
      version: '2.0.0',
      activated: true,
      runtimeVersion: 4,
      message: 'Installed "messaging" and activated it.',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'install', 'github:markhayden/bakin-bits-official#plugins/messaging']
    await main()
    expect(output()).toContain('Plugin action')
    expect(output()).toContain('Installed "messaging" and activated it.')
    expect(output()).toContain('Runtime version: 4')
    expect(output()).not.toContain('"id": "messaging"')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'messaging',
      snapshot: '/Users/roscoe/.bakin/.uninstalled/messaging.tar.gz',
      skills: { removed: 2, kept: 0 },
      message: 'Removed "messaging" and deactivated it.',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'remove', 'messaging']
    await main()
    expect(output()).toContain('Plugin action')
    expect(output()).toContain('Removed "messaging" and deactivated it.')
    expect(output()).toContain('Runtime skills: 2 removed, 0 kept')
    expect(output()).not.toContain('"snapshot"')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'local-tools',
      linkedSource: '/Users/roscoe/dev/local-tools',
      pluginDir: '/Users/roscoe/.bakin/plugins/local-tools',
      watching: true,
      message: 'Linked "local-tools" and activated it with dev hot reload.',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'link', './local-tools', '--force']
    await main()
    expect(output()).toContain('Linked "local-tools" and activated it with dev')
    expect(output()).toContain('hot reload.')
    expect(output()).toContain('Dev hot reload is watching the linked source.')
    expect(output()).not.toContain('"linkedSource"')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'local-tools',
      message: 'Unlinked "local-tools" and deactivated it.',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'unlink', 'local-tools']
    await main()
    expect(output()).toContain('Unlinked "local-tools" and deactivated it.')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'messaging',
      before: { version: '1.0.0', commitSha: '1111111111111111111111111111111111111111' },
      after: { version: '2.0.0', commitSha: '2222222222222222222222222222222222222222' },
      pluginAssets: { installed: [{ name: 'compose' }], skipped: [] },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'upgrade', 'messaging', '--yes']
    await main()
    expect(output()).toContain('Plugin action')
    expect(output()).toContain('Upgraded plugin messaging 1.0.0 -> 2.0.0.')
    expect(output()).toContain('Runtime skills: 1 applied, 0 skipped')
    expect(output()).not.toContain('"before"')

    harness.log.mockClear()
    harness.error.mockClear()
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'cannot upgrade core plugin: tasks' }),
      text: () => Promise.resolve('{"error":"cannot upgrade core plugin: tasks"}'),
    } as Response)
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'upgrade', 'tasks', '--yes', '--json']
    await expect(main()).rejects.toThrow('exit:1')
    expect(output()).toContain('"ok": false')
    expect(output()).toContain('"status": 400')
    expect(output()).toContain('"error": "cannot upgrade core plugin: tasks"')
    expect(errorOutput()).not.toContain('cannot upgrade core plugin')

    harness.log.mockClear()
    const scaffoldDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-scaffold-'))
    process.chdir(scaffoldDir)
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'scaffold', 'smoke-plugin']
    await main()
    expect(output()).toContain('Plugin action')
    expect(output()).toContain('Scaffolded plugin smoke-plugin.')
    expect(output()).toContain('Next: cd smoke-plugin && bun install && bakin')
    expect(output()).toContain('plugins install .')
    expect(existsSync(join(scaffoldDir, 'smoke-plugin', 'bakin-plugin.json'))).toBe(true)

    harness.log.mockClear()
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'scaffold', 'json-smoke-plugin', '--json']
    await main()
    expect(output()).toContain('"ok": true')
    expect(output()).toContain('"id": "json-smoke-plugin"')
    expect(output()).not.toContain('Plugin action')
    expect(existsSync(join(scaffoldDir, 'json-smoke-plugin', 'bakin-plugin.json'))).toBe(true)

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'json-plugin',
      message: 'Installed "json-plugin" and activated it.',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'install', './json-plugin', '--json']
    await main()
    expect(output()).toContain('"id": "json-plugin"')
    expect(output()).not.toContain('Plugin action')

    harness.log.mockClear()
    const dir = mkdtempSync(join(tmpdir(), 'bakin-plugin-import-'))
    const manifest = join(dir, 'plugins.json')
    writeFileSync(manifest, JSON.stringify({
      version: 1,
      plugins: [
        { id: 'projects', source: 'github:markhayden/bakin-bits-official#plugins/projects', type: 'github', ref: '', commitSha: '' },
      ],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'projects',
      message: 'Installed "projects" and activated it.',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'import', manifest, '--yes']
    await main()
    expect(output()).toContain('Plugin action')
    expect(output()).toContain('Imported 1 plugin.')
    expect(output()).toContain('Installed: projects')
    expect(output()).not.toContain('Installing projects from')
  })

  it('renders plugin restore snapshots and results with shared TUI screens in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      snapshots: [
        {
          timestamp: '2026-05-04T00-00-00-000Z',
          createdAt: '2026-05-04T00:00:00.000Z',
          filename: 'demo-plugin-2026.tar.gz',
          sizeBytes: 4096,
        },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'restore', 'demo-plugin', '--list']
    await main()

    expect(output()).toContain('Plugin Restore')
    expect(output()).toContain('plugin: demo-plugin')
    expect(output()).toContain('SNAPSHOTS')
    expect(output()).toContain('demo-plugin-2026.tar.gz')
    expect(output()).not.toContain('Uninstall snapshots for')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      message: 'Restored "demo-plugin".',
      snapshotInfo: {
        timestamp: '2026-05-04T00-00-00-000Z',
        createdAt: '2026-05-04T00:00:00.000Z',
        filename: 'demo-plugin-2026.tar.gz',
        sizeBytes: 4096,
      },
      skills: { restored: 2 },
      activated: false,
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'restore', 'demo-plugin', '--snapshot', 'demo-plugin-2026.tar.gz', '--force']
    await main()

    expect(output()).toContain('Plugin Restore')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('Restored "demo-plugin".')
    expect(output()).toContain('demo-plugin-2026.tar.gz')
    expect(output()).toContain('Activation deferred until next server start.')
    expect(output()).not.toContain('Restored plugin:')
  })
})
