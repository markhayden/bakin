/**
 * Entity links: one resolver from a declared kind + id to an in-app href,
 * shared by the browser (`@makinbakin/sdk/navigation`) and the server.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-navigation-entities-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { fillEntityHref } from '../../packages/core/src/plugins/entity-href'
import { createEntityRegistry, entityHref as serverEntityHref } from '../../packages/core/src/plugins/entity-registry'
import { entityHref } from '@makinbakin/sdk/navigation'
import { setEntityDeclarations } from '@makinbakin/sdk/internal'

const declare = (pluginId: string, kind: string, href: string) => ({ kind, label: kind, icon: 'Box', href, pluginId, id: `${pluginId}:${kind}` })

afterEach(() => setEntityDeclarations([]))

describe('fillEntityHref', () => {
  test('fills {id} in a path and in a query', () => {
    expect(fillEntityHref('/projects/{id}', 'p-1')).toBe('/projects/p-1')
    expect(fillEntityHref('/tasks?taskId={id}', 't-1')).toBe('/tasks?taskId=t-1')
  })

  test('every value is URL-encoded, so an id can never add a segment or a parameter', () => {
    expect(fillEntityHref('/projects/{id}', '../admin?x=1#y')).toBe('/projects/..%2Fadmin%3Fx%3D1%23y')
    expect(fillEntityHref('/tasks?taskId={id}', 'a&b=c')).toBe('/tasks?taskId=a%26b%3Dc')
  })

  test('compound routes take named params', () => {
    expect(fillEntityHref('/brands/{brandId}/docs/{kind}/{name}', 'acme/guidelines/voice', {
      brandId: 'acme', kind: 'guidelines', name: 'voice & tone',
    })).toBe('/brands/acme/docs/guidelines/voice%20%26%20tone')
  })

  test('a missing param is no link, never a half-filled one', () => {
    expect(fillEntityHref('/brands/{brandId}/docs/{kind}/{name}', 'x', { brandId: 'acme' })).toBeNull()
    expect(fillEntityHref('/projects/{id}', '')).toBeNull()
  })

  test('params cannot replace the id', () => {
    expect(fillEntityHref('/projects/{id}', 'real', { id: 'spoofed' })).toBe('/projects/real')
  })
})

describe('entityHref (browser)', () => {
  test('resolves through the declared kind', () => {
    setEntityDeclarations([declare('tasks', 'task', '/tasks?taskId={id}')])
    expect(entityHref('tasks:task', 't-9')).toBe('/tasks?taskId=t-9')
  })

  test('extra query parameters are appended, with or without a query in the template', () => {
    setEntityDeclarations([declare('tasks', 'task', '/tasks?taskId={id}'), declare('team', 'agent', '/team/{id}')])
    expect(entityHref('tasks:task', 't-9', { query: { field: 'assignee' } })).toBe('/tasks?taskId=t-9&field=assignee')
    expect(entityHref('team:agent', 'pixel', { query: { tab: 'diagnostics', q: 'a b' } })).toBe('/team/pixel?tab=diagnostics&q=a%20b')
  })

  test('compound routes take params', () => {
    setEntityDeclarations([declare('brands', 'doc', '/brands/{brandId}/docs/{kind}/{name}')])
    expect(entityHref('brands:doc', 'acme/guidelines/voice.md', { params: { brandId: 'acme', kind: 'guidelines', name: 'voice.md' } }))
      .toBe('/brands/acme/docs/guidelines/voice.md')
  })

  test('an undeclared kind has no href', () => {
    expect(entityHref('gone:thing', 'x')).toBeNull()
  })
})

describe('entityHref (server)', () => {
  test('resolves through the server registry', () => {
    const registry = createEntityRegistry()
    registry.publish('projects', [{ kind: 'project', label: 'Project', icon: 'FolderKanban', href: '/projects/{id}' }])
    expect(serverEntityHref('projects:project', 'p-1', undefined, registry)).toBe('/projects/p-1')
    expect(serverEntityHref('projects:milestone', 'm-1', undefined, registry)).toBeNull()
  })
})
