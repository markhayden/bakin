import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-plugin-settings-sse-${Date.now()}`)

const notifySettingsChange = mock(async (_pluginId: string, _settings: Record<string, unknown>) => undefined)
const broadcast = mock((_event: Record<string, unknown>) => undefined)
const broadcastPluginSettingsChanged = mock((pluginId: string) => broadcast({
  type: 'plugin:settings-changed',
  pluginId,
  timestamp: new Date().toISOString(),
}))

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
}))

// The settings-store (in packages/core) resolves via the core content-dir.
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
}))

mock.module('../../src/core/plugin-registry', () => ({
  pluginRegistry: {
    notifySettingsChange,
  },
}))

mock.module('@/core/plugin-registry', () => ({
  pluginRegistry: {
    notifySettingsChange,
  },
}))

mock.module('../../src/core/sse', () => ({
  broadcast,
  broadcastPluginSettingsChanged,
}))

mock.module('@/core/sse', () => ({
  broadcast,
  broadcastPluginSettingsChanged,
}))

const { get, put } = await import('../../packages/host/src/api/plugin-settings/[pluginId]')

function readSettings(pluginId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(testDir, 'plugin-settings', `${pluginId}.json`), 'utf-8'))
}

describe('plugin settings SSE', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mock.clearAllMocks()
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('writes settings, notifies the plugin registry, and broadcasts plugin:settings-changed', async () => {
    const body = { contentTypes: [{ id: 'blog', label: 'Blog' }] }
    const response = await put(
      new Request('http://localhost/api/plugin-settings/messaging', {
        method: 'PUT',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
      new URL('http://localhost/api/plugin-settings/messaging'),
    )

    expect(response.status).toBe(200)
    expect(readSettings('messaging')).toEqual(body)
    expect(notifySettingsChange).toHaveBeenCalledWith('messaging', body)
    expect(broadcast).toHaveBeenCalledTimes(1)

    const event = broadcast.mock.calls[0]![0] as Record<string, unknown>
    expect(event.type).toBe('plugin:settings-changed')
    expect(event.pluginId).toBe('messaging')
    expect(typeof event.timestamp).toBe('string')
    expect(Number.isNaN(Date.parse(event.timestamp as string))).toBe(false)
  })

  it('preserves current pluginId extraction behavior for malformed paths', async () => {
    const body = { enabled: true }
    await put(
      new Request('http://localhost/api/plugin-settings/', {
        method: 'PUT',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
      new URL('http://localhost/api/plugin-settings/'),
    )

    expect(existsSync(join(testDir, 'plugin-settings', 'plugin-settings.json'))).toBe(true)
    expect(readSettings('plugin-settings')).toEqual(body)
    expect(notifySettingsChange).toHaveBeenCalledWith('plugin-settings', body)
    expect((broadcast.mock.calls[0]![0] as Record<string, unknown>).pluginId).toBe('plugin-settings')
  })

  it('rejects invalid plugin ids on PUT without writing or notifying', async () => {
    // Note: a literal '..' segment never reaches the handler — the URL
    // constructor (and Node's request-path normalization) collapses it.
    for (const id of ['EVIL', 'a b', 'a..b', '.hidden', 'x'.repeat(41)]) {
      const url = new URL(`http://localhost/api/plugin-settings/${encodeURIComponent(id)}`)
      const response = await put(
        new Request(url, {
          method: 'PUT',
          body: JSON.stringify({ enabled: true }),
          headers: { 'Content-Type': 'application/json' },
        }),
        url,
      )
      expect(response.status).toBe(400)
    }
    expect(existsSync(join(testDir, 'plugin-settings'))).toBe(false)
    expect(notifySettingsChange).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('rejects invalid plugin ids on GET', async () => {
    const url = new URL('http://localhost/api/plugin-settings/EVIL')
    const response = await get(new Request(url, { method: 'GET' }), url)
    expect(response.status).toBe(400)
  })
})
