import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import yaml from 'js-yaml'

const testDir = join(tmpdir(), `bakin-test-defs-crud-${Date.now()}`)
const defsDir = join(testDir, 'workflows', 'definitions')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
}))
mock.module('@bakin/tasks/lib/flow-store', () => ({}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))

import workflowsPlugin from '@bakin/workflows'
import {
  clearSourceRegistry,
  registerPluginDefinition,
} from '@bakin/workflows/lib/source-registry'
import { activatePlugin, callRoute, findRoute } from '../test-helpers'
import type { WorkflowDefinition } from '@bakin/workflows/types'

const validDef = {
  name: 'New Demo',
  description: 'demo workflow',
  version: 1,
  steps: [{ id: 's1', type: 'agent', label: 'Do', agent: 'basil' }],
}

describe('workflows CRUD routes', () => {
  beforeEach(() => {
    mkdirSync(defsDir, { recursive: true })
    clearSourceRegistry()
  })
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    clearSourceRegistry()
  })

  describe('POST /definitions', () => {
    it('creates a new user-owned YAML on disk', async () => {
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'POST', '/definitions')
      expect(route).toBeDefined()

      const res = await callRoute(route!, activated.ctx, {
        body: { id: 'new-demo', ...validDef },
      })

      expect(res.status).toBe(201)
      expect(res.body.id).toBe('new-demo')
      expect(res.body.source).toBe('user')

      const onDisk = join(defsDir, 'new-demo.yaml')
      expect(existsSync(onDisk)).toBe(true)
      const parsed = yaml.load(readFileSync(onDisk, 'utf-8')) as Record<string, unknown>
      expect(parsed.name).toBe('New Demo')
    })

    it('rejects an invalid definition (missing steps)', async () => {
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'POST', '/definitions')!

      const res = await callRoute(route, activated.ctx, {
        body: { id: 'bad', name: 'Bad', description: 'x', version: 1, steps: [] },
      })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/validation|invalid/i)
    })

    it('refuses to overwrite a plugin-owned id', async () => {
      registerPluginDefinition('workflows', 'shared-id', validDef as unknown as WorkflowDefinition)
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'POST', '/definitions')!

      const res = await callRoute(route, activated.ctx, {
        body: { id: 'shared-id', ...validDef },
      })

      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/plugin/i)
      expect(existsSync(join(defsDir, 'shared-id.yaml'))).toBe(false)
    })
  })

  describe('PUT /definitions/:name', () => {
    it('updates an existing user definition on disk', async () => {
      writeFileSync(
        join(defsDir, 'edit-me.yaml'),
        yaml.dump({ ...validDef, name: 'Original' }),
      )
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'PUT', '/definitions/:name')!

      const res = await callRoute(route, activated.ctx, {
        path: '/definitions/edit-me',
        searchParams: { name: 'edit-me' },
        body: { ...validDef, name: 'Updated' },
      })

      expect(res.status).toBe(200)
      const onDisk = yaml.load(readFileSync(join(defsDir, 'edit-me.yaml'), 'utf-8')) as Record<string, unknown>
      expect(onDisk.name).toBe('Updated')
    })

    it('refuses to write a user shadow when only :readOnly query is set', async () => {
      // Confirms the plugin-id route remains read-only — PUT against a
      // plugin-only id should write a user-side YAML (creating the shadow),
      // NOT mutate the plugin entry. The user-wins rule does the rest.
      registerPluginDefinition('workflows', 'plug-only', validDef as unknown as WorkflowDefinition)
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'PUT', '/definitions/:name')!

      const res = await callRoute(route, activated.ctx, {
        path: '/definitions/plug-only',
        searchParams: { name: 'plug-only' },
        body: { ...validDef, name: 'User Override' },
      })

      expect(res.status).toBe(200)
      // The disk file is the user shadow — plugin entry is unchanged
      const onDisk = yaml.load(readFileSync(join(defsDir, 'plug-only.yaml'), 'utf-8')) as Record<string, unknown>
      expect(onDisk.name).toBe('User Override')
    })

    it('returns 400 on invalid body', async () => {
      writeFileSync(join(defsDir, 'edit-me.yaml'), yaml.dump(validDef))
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'PUT', '/definitions/:name')!

      const res = await callRoute(route, activated.ctx, {
        path: '/definitions/edit-me',
        searchParams: { name: 'edit-me' },
        body: { name: 'No Steps', description: '', version: 1, steps: [] },
      })

      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /definitions/:name', () => {
    it('deletes a user definition from disk', async () => {
      writeFileSync(join(defsDir, 'delete-me.yaml'), yaml.dump(validDef))
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'DELETE', '/definitions/:name')!

      const res = await callRoute(route, activated.ctx, {
        path: '/definitions/delete-me',
        searchParams: { name: 'delete-me' },
      })

      expect(res.status).toBe(200)
      expect(existsSync(join(defsDir, 'delete-me.yaml'))).toBe(false)
    })

    it('refuses to delete a plugin-owned id with no user shadow', async () => {
      registerPluginDefinition('workflows', 'plug-only', validDef as unknown as WorkflowDefinition)
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'DELETE', '/definitions/:name')!

      const res = await callRoute(route, activated.ctx, {
        path: '/definitions/plug-only',
        searchParams: { name: 'plug-only' },
      })

      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/plugin/i)
    })

    it('returns 404 when target does not exist', async () => {
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'DELETE', '/definitions/:name')!

      const res = await callRoute(route, activated.ctx, {
        path: '/definitions/missing',
        searchParams: { name: 'missing' },
      })

      expect(res.status).toBe(404)
    })
  })
})
