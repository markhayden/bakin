import { describe, expect, it } from 'bun:test'
import {
  PluginManifestError,
  parsePluginManifest,
  readPluginManifestJson,
} from '../../packages/core/src/plugins/manifest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const baseManifest = {
  id: 'messaging',
  name: 'Messaging',
  version: '1.0.0',
  bakin: '>=1.0.0',
  description: 'Content planning and delivery',
  entry: {
    server: 'index.ts',
    client: 'client.tsx',
  },
  permissions: ['storage.read', 'storage.write'],
}

describe('plugin manifest schema', () => {
  it('parses a strict manifest with declared contributions', () => {
    const manifest = parsePluginManifest({
      ...baseManifest,
      runtimeCapabilities: ['agents', 'cron', 'channels.message'],
      contributes: {
        apiRoutes: [
          { method: 'GET', path: '/', summary: 'List messaging items' },
          {
            method: 'POST',
            path: '/:itemId/approve',
            summary: 'Approve an item',
            operationId: 'messaging-approve-item',
            tags: ['Messaging'],
            parameters: [
              { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
            ],
            requestBody: {
              required: false,
              schema: {
                type: 'object',
                properties: {
                  note: { type: 'string' },
                },
              },
            },
            responses: {
              200: {
                description: 'Approved item.',
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                  },
                },
              },
            },
          },
        ],
        clientRoutes: [
          { path: '/messaging/calendar', summary: 'Messaging calendar' },
        ],
        execTools: [
          { name: 'messaging.create', summary: 'Create a messaging item' },
        ],
        cliCommands: [
          {
            name: 'messaging',
            usage: 'bakin messaging <subcommand>',
            summary: 'Manage messaging content',
            dispatch: { type: 'apiRoute', method: 'POST', path: '/sessions' },
          },
        ],
        settings: [
          { key: 'intervalMinutes', summary: 'Content sweep interval' },
        ],
        docs: {
          slug: 'plugins/official/messaging',
        },
      },
    })

    expect(manifest.id).toBe('messaging')
    expect(manifest.entry.client).toBe('client.tsx')
    expect(manifest.contributes?.apiRoutes?.[1]?.path).toBe('/:itemId/approve')
    expect(manifest.contributes?.apiRoutes?.[1]?.operationId).toBe('messaging-approve-item')
    expect(manifest.contributes?.apiRoutes?.[1]?.parameters?.[0]?.name).toBe('itemId')
    expect(manifest.contributes?.apiRoutes?.[1]?.responses?.[200]?.description).toBe('Approved item.')
    expect(manifest.contributes?.cliCommands?.[0]?.dispatch?.type).toBe('apiRoute')
  })

  it('rejects invalid plugin ids', () => {
    expect(() => parsePluginManifest({ ...baseManifest, id: 'Messaging' })).toThrow(PluginManifestError)
    expect(() => parsePluginManifest({ ...baseManifest, id: 'message_board' })).toThrow(/Invalid plugin id/)
  })

  it('requires strict contract fields by default', () => {
    const { bakin: _bakin, ...missingBakin } = baseManifest
    expect(() => parsePluginManifest(missingBakin)).toThrow(/bakin/)

    const { description: _description, ...missingDescription } = baseManifest
    expect(() => parsePluginManifest(missingDescription)).toThrow(/description/)
  })

  it('can parse legacy minimal manifests only when explicitly allowed', () => {
    const manifest = parsePluginManifest({
      id: 'legacy',
      name: 'Legacy',
      version: '0.1.0',
    }, { allowLegacy: true })

    expect(manifest.entry.server).toBe('index.ts')
    expect(manifest.bakin).toBe('>=1.0.0')
  })

  it('allows legacy core CLI command metadata without dispatch', () => {
    const manifest = parsePluginManifest({
      id: 'legacy',
      name: 'Legacy',
      version: '0.1.0',
      contributes: {
        cliCommands: [
          {
            name: 'status',
            usage: 'bakin status',
            summary: 'Show status.',
          },
        ],
      },
    }, { allowLegacy: true })

    expect(manifest.contributes?.cliCommands?.[0]?.dispatch).toBeUndefined()
  })

  it('parses every bundled plugin manifest in legacy mode', () => {
    const pluginsDir = join(import.meta.dir, '..', '..', 'plugins')
    const pluginIds = readdirSync(pluginsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()

    expect(pluginIds.length).toBeGreaterThan(0)
    for (const pluginId of pluginIds) {
      const manifestText = readFileSync(join(pluginsDir, pluginId, 'bakin-plugin.json'), 'utf-8')
      expect(() => readPluginManifestJson(manifestText, { allowLegacy: true })).not.toThrow()
    }
  })

  it('requires CLI command dispatch in strict manifests', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: {
        cliCommands: [
          {
            name: 'status',
            usage: 'bakin status',
            summary: 'Show status.',
          },
        ],
      },
    })).toThrow(/contributes\.cliCommands\[0\]\.dispatch must be an object/)
  })

  it('rejects absolute API paths in plugin route declarations', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: {
        apiRoutes: [
          { method: 'GET', path: '/api/tasks', summary: 'Bad route' },
        ],
      },
    })).toThrow(/plugin-relative/)
  })

  it('rejects client routes under /api', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: {
        clientRoutes: [
          { path: '/api/plugins/messaging', summary: 'Bad route' },
        ],
      },
    })).toThrow(/must not be an API path/)
  })

  it('rejects unknown runtime capabilities', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      runtimeCapabilities: ['openclaw'],
    })).toThrow(/Unknown runtime capability/)
  })

  it('reports invalid JSON through readPluginManifestJson', () => {
    expect(() => readPluginManifestJson('{ nope')).toThrow(/Invalid bakin-plugin\.json/)
  })
})
