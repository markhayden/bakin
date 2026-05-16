import { describe, expect, it } from 'bun:test'
import {
  PluginManifestError,
  parsePluginManifest,
  readPluginManifestJson,
} from '../../packages/core/src/plugins/manifest'

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
      secrets: [
        {
          name: 'ANTHROPIC_API_KEY',
          description: 'Anthropic API key used to fetch provider model metadata.',
          required: false,
        },
        {
          name: 'OPENCLAW_GATEWAY_TOKEN',
          description: 'OpenClaw gateway token used by runtime gateway integrations.',
        },
      ],
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
    expect(manifest.secrets).toEqual([
      {
        name: 'ANTHROPIC_API_KEY',
        description: 'Anthropic API key used to fetch provider model metadata.',
        required: false,
      },
      {
        name: 'OPENCLAW_GATEWAY_TOKEN',
        description: 'OpenClaw gateway token used by runtime gateway integrations.',
        required: true,
      },
    ])
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

  it('rejects legacy string-array secrets', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      secrets: ['ANTHROPIC_API_KEY'],
    })).toThrow(/secrets/)
  })

  it('rejects non-env-var secret names', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      secrets: [
        {
          name: 'anthropic-api-key',
          description: 'Anthropic API key.',
          required: true,
        },
      ],
    })).toThrow(/secrets\[0\]\.name/)
  })

  it('requires strict contract fields by default', () => {
    const { bakin: _bakin, ...missingBakin } = baseManifest
    expect(() => parsePluginManifest(missingBakin)).toThrow(/bakin/)

    const { description: _description, ...missingDescription } = baseManifest
    expect(() => parsePluginManifest(missingDescription)).toThrow(/description/)
  })

  it('rejects legacy minimal manifests', () => {
    expect(() => parsePluginManifest({
      id: 'legacy',
      name: 'Legacy',
      version: '0.1.0',
    })).toThrow(/entry/)
  })

  it('accepts an optional ed25519 signature block', () => {
    const manifest = parsePluginManifest({
      ...baseManifest,
      signature: {
        algorithm: 'ed25519',
        signer: 'markhayden',
        publicKey: 'MCowBQYDK2VwAyEAtest',
        signature: 'signed-body',
      },
    })

    expect(manifest.signature?.algorithm).toBe('ed25519')
    expect(manifest.signature?.signer).toBe('markhayden')
  })

  it('rejects malformed signature blocks', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      signature: {
        algorithm: 'rsa',
        signer: 'markhayden',
        publicKey: 'MCowBQYDK2VwAyEAtest',
        signature: 'signed-body',
      },
    })).toThrow(/signature\.algorithm/)

    expect(() => parsePluginManifest({
      ...baseManifest,
      signature: {
        algorithm: 'ed25519',
        signer: 'markhayden',
        signature: 'signed-body',
      },
    })).toThrow(/signature\.publicKey/)
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
