import { describe, expect, it, mock } from 'bun:test'

// Per CLAUDE.md — defensive content-dir mocks even for pure parser tests.
mock.module('../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-plugin-manifest-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-plugin-manifest-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})

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
    })).toThrow(/bakin/)
  })

  it('rejects the removed "entry" field with an actionable message', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      entry: { server: 'index.ts', client: 'client.tsx' },
    })).toThrow(/"entry" was removed[\s\S]*index\.ts[\s\S]*client\.tsx/)
  })

  it('rejects the removed "tests" field with an actionable message', () => {
    expect(() => parsePluginManifest({ ...baseManifest, tests: 'tests/' }))
      .toThrow(/"tests" was removed/)
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

describe('plugin manifest declarative client contributions (lazy loading)', () => {
  it('parses contributes.nav / routes / slots / eager', () => {
    const manifest = parsePluginManifest({
      ...baseManifest,
      contributes: {
        nav: [
          {
            id: 'messaging',
            label: 'Messaging',
            icon: 'MessageSquare',
            href: '/messaging',
            order: 25,
            section: 'create',
            badge: { tone: 'info' },
            children: [
              { id: 'messaging-calendar', label: 'Calendar', icon: 'CalendarDays', href: '/messaging/calendar' },
            ],
          },
        ],
        routes: [
          { path: '/messaging', summary: 'Messaging index' },
          { path: '/messaging/plans/[id]' },
        ],
        slots: ['nav-badge-providers', 'page:/messaging'],
        eager: true,
      },
    })

    expect(manifest.contributes?.nav).toEqual([
      {
        id: 'messaging',
        label: 'Messaging',
        icon: 'MessageSquare',
        href: '/messaging',
        order: 25,
        section: 'create',
        badge: { tone: 'info' },
        children: [
          { id: 'messaging-calendar', label: 'Calendar', icon: 'CalendarDays', href: '/messaging/calendar' },
        ],
      },
    ])
    expect(manifest.contributes?.routes).toEqual([
      { path: '/messaging', summary: 'Messaging index' },
      { path: '/messaging/plans/[id]', summary: undefined },
    ])
    expect(manifest.contributes?.slots).toEqual(['nav-badge-providers', 'page:/messaging'])
    expect(manifest.contributes?.eager).toBe(true)
  })

  it('rejects nav items missing id or label', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: { nav: [{ label: 'No id', href: '/x' }] },
    })).toThrow(/missing required field "id"/)
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: { nav: [{ id: 'x', href: '/x' }] },
    })).toThrow(/missing required field "label"/)
  })

  it('rejects nav hrefs that are not app paths', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: { nav: [{ id: 'x', label: 'X', href: '/api/plugins/x' }] },
    })).toThrow(/must be an app path/)
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: { nav: [{ id: 'x', label: 'X', href: 'relative' }] },
    })).toThrow(/must be an app path/)
  })

  it('rejects duplicate nav ids across nesting levels', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: {
        nav: [
          { id: 'x', label: 'X', children: [{ id: 'x', label: 'X again' }] },
        ],
      },
    })).toThrow(/duplicate nav item id "x"/)
  })

  it('rejects invalid badge tones in nav items', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: { nav: [{ id: 'x', label: 'X', badge: { tone: 'loud' } }] },
    })).toThrow(/badge\.tone must be one of/)
  })

  it('parses every allowed top-level nav section', () => {
    for (const section of ['plan-and-automate', 'create', 'operations'] as const) {
      const manifest = parsePluginManifest({
        ...baseManifest,
        contributes: { nav: [{ id: `item-${section}`, label: section, section }] },
      })
      expect(manifest.contributes?.nav?.[0]?.section).toBe(section)
    }
  })

  it('rejects unknown nav sections with the allowed values', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: { nav: [{ id: 'x', label: 'X', section: 'custom-heading' }] },
    })).toThrow(/section must be one of: plan-and-automate, create, operations/)
  })

  it('rejects nav sections on children instead of silently ignoring them', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: {
        nav: [{
          id: 'group',
          label: 'Group',
          children: [{ id: 'child', label: 'Child', section: 'create' }],
        }],
      },
    })).toThrow(/children\[0\]\.section is only valid on top-level nav items/)
  })

  it('rejects removed nav placement with migration guidance', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: {
        nav: [{ id: 'x', label: 'X', placement: 'bottom' }],
      },
    })).toThrow(/placement was removed.*section.*host-owned/)
  })

  it('rejects removed alwaysExpanded with disclosure migration guidance', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: { nav: [{ id: 'group', label: 'Group', alwaysExpanded: true }] },
    })).toThrow(/alwaysExpanded was removed.*disclosure/)
  })

  it('rejects route patterns under /api and duplicates', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: { routes: [{ path: '/api/messaging' }] },
    })).toThrow(/must not be an API path/)
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: { routes: [{ path: '/messaging' }, { path: '/messaging' }] },
    })).toThrow(/duplicate path "\/messaging"/)
  })

  it('rejects non-string slot entries and non-boolean eager', () => {
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: { slots: ['page:/x', 7] },
    })).toThrow(/only non-empty strings/)
    expect(() => parsePluginManifest({
      ...baseManifest,
      contributes: { eager: 'yes' },
    })).toThrow(/eager must be a boolean/)
  })
})
