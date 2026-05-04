/**
 * T5 — runtime /api/docs builder.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { z } from 'zod'

const testDir = join(tmpdir(), `bakin-test-docs-runtime-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/task-store', () => ({}))

import { defineRoute } from '../../packages/core/src/routing'
import { buildOpenApiDocument, invalidateDocsCache } from '../../packages/host/src/api/docs-runtime'
import { collectOpenApiSources } from '../../packages/host/src/api/openapi-sources'

describe('buildOpenApiDocument', () => {
  it('returns a valid OpenAPI 3.1 envelope when no routes', () => {
    invalidateDocsCache()
    const doc = buildOpenApiDocument([])
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info.title).toBe('Bakin API')
    expect(Object.keys(doc.paths)).toEqual([])
  })

  it('emits paths for plugin + core routes with correct path normalization', () => {
    invalidateDocsCache()
    const tasksRoute = defineRoute({
      path: '/:taskId',
      method: 'GET',
      summary: 'Get task',
      params: z.object({ taskId: z.string() }),
      responses: { 200: z.object({ id: z.string() }) },
      handler: async () => Response.json({ id: 'a' }),
    })
    const doc = buildOpenApiDocument([
      {
        scope: 'tasks',
        fullPath: '/api/plugins/tasks/:taskId',
        route: tasksRoute as any,
      },
    ])
    expect(Object.keys(doc.paths)).toEqual(['/api/plugins/tasks/{taskId}'])
    const op = doc.paths['/api/plugins/tasks/{taskId}'].get
    expect(op.summary).toBe('Get task')
    expect(op.parameters?.[0].in).toBe('path')
  })

  it('groups by tag', () => {
    invalidateDocsCache()
    const a = defineRoute({
      path: '/a', method: 'GET', summary: 'A',
      responses: { 200: z.object({}) },
      handler: async () => Response.json({}),
    })
    const b = defineRoute({
      path: '/b', method: 'GET', summary: 'B',
      responses: { 200: z.object({}) },
      handler: async () => Response.json({}),
    })
    const doc = buildOpenApiDocument([
      { scope: 'tasks', fullPath: '/api/plugins/tasks/a', route: a as any },
      { scope: 'core', fullPath: '/api/b', route: b as any },
    ])
    const tagNames = doc.tags.map(t => t.name).sort()
    expect(tagNames).toEqual(['Core', 'Tasks'])
  })

  it('collects typed core route schemas for the live OpenAPI document', () => {
    invalidateDocsCache()
    const doc = buildOpenApiDocument(collectOpenApiSources([]))

    const schema = doc.paths['/api/plugins/link'].post.requestBody?.content['application/json'].schema

    expect(schema?.properties).toHaveProperty('localPath')
    expect(schema?.properties).toHaveProperty('force')
    expect(schema?.properties).not.toHaveProperty('path')
    expect(schema?.required).toEqual(['localPath'])
  })
})
