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

mock.module('../../src/lib/plugin-registry', () => ({
  pluginRegistry: {
    notifySettingsChange,
  },
}))

mock.module('@/lib/plugin-registry', () => ({
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

const { put } = await import('../../packages/host/src/api/plugin-settings/[pluginId]')

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
})
