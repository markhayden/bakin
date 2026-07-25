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
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('@/core/task-store', () => ({}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))

import workflowsPlugin from '@bakin/workflows'
import {
  clearSourceRegistry,
  registerPluginDefinition,
} from '@bakin/core/workflows/source-registry'
import { matchWorkflow } from '@bakin/workflows/lib/matcher'
import { resetWorkflowAvailabilityCache } from '@bakin/workflows/lib/availability'
import { activatePlugin, callRoute, findRoute } from '../test-helpers'
import type { WorkflowDefinition } from '@bakin/workflows/types'

const validDef = {
  name: 'New Demo',
  description: 'demo workflow',
  version: 1,
  steps: [{ id: 's1', type: 'agent', label: 'Do', agent: 'chef' }],
}

describe('workflows CRUD routes', () => {
  beforeEach(() => {
    mkdirSync(defsDir, { recursive: true })
    clearSourceRegistry()
    resetWorkflowAvailabilityCache()
  })
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    clearSourceRegistry()
    resetWorkflowAvailabilityCache()
  })

  it('declares workflow gate approval fallback routes as HTML responses', async () => {
    const activated = await activatePlugin(workflowsPlugin, testDir)
    const getRoute = findRoute(activated.routes, 'GET', '/gates/:taskId/decision') as { responses?: Record<string, { contentType?: string }> } | undefined
    const postRoute = findRoute(activated.routes, 'POST', '/gates/:taskId/decision') as { responses?: Record<string, { contentType?: string }> } | undefined

    expect(getRoute?.responses?.[200]?.contentType).toBe('text/html')
    expect(getRoute?.responses?.[400]?.contentType).toBe('text/html')
    expect(postRoute?.responses?.[200]?.contentType).toBe('text/html')
    expect(postRoute?.responses?.[400]?.contentType).toBe('text/html')
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

    it('creates an empty draft workflow definition on disk', async () => {
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'POST', '/definitions')!

      const res = await callRoute(route, activated.ctx, {
        body: { id: 'draft', name: 'Draft', description: 'x', version: 1, steps: [] },
      })

      expect(res.status).toBe(201)
      const onDisk = yaml.load(readFileSync(join(defsDir, 'draft.yaml'), 'utf-8')) as Record<string, unknown>
      expect(onDisk.steps).toEqual([])
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

    it('refuses to overwrite an existing user-owned id', async () => {
      writeFileSync(join(defsDir, 'existing.yaml'), yaml.dump({ ...validDef, name: 'Original' }))
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'POST', '/definitions')!

      const res = await callRoute(route, activated.ctx, {
        body: { id: 'existing', ...validDef, name: 'Updated' },
      })

      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/already exists/i)
      const onDisk = yaml.load(readFileSync(join(defsDir, 'existing.yaml'), 'utf-8')) as Record<string, unknown>
      expect(onDisk.name).toBe('Original')
    })

    it('rejects unknown YAML keys at save with an error naming the key (strict schemas)', async () => {
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'POST', '/definitions')!

      const res = await callRoute(route, activated.ctx, {
        body: {
          id: 'stale-save',
          name: 'Stale Save',
          description: 'carries a deleted field',
          version: 1,
          steps: [
            { id: 'write', type: 'agent', label: 'Write', agent: 'chef' },
            { id: 'review', type: 'gate', label: 'Review', on_approve: 'done' },
          ],
        },
      })

      expect(res.status).toBe(400)
      expect(JSON.stringify(res.body)).toContain('on_approve')
      expect(existsSync(join(defsDir, 'stale-save.yaml'))).toBe(false)
    })

    it('rejects unsafe workflow ids before writing to disk', async () => {
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'POST', '/definitions')!

      const res = await callRoute(route, activated.ctx, {
        body: { id: '../escape', ...validDef },
      })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/lowercase letters/)
      expect(existsSync(join(testDir, 'workflows', 'escape.yaml'))).toBe(false)
      expect(existsSync(join(defsDir, '..', 'escape.yaml'))).toBe(false)
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
        body: { ...validDef, name: 'Updated', description: 'updated description' },
      })

      expect(res.status).toBe(200)
      const onDisk = yaml.load(readFileSync(join(defsDir, 'edit-me.yaml'), 'utf-8')) as Record<string, unknown>
      expect(onDisk.name).toBe('Updated')
      expect(onDisk.description).toBe('updated description')
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

      const listRoute = findRoute(activated.routes, 'GET', '/definitions')!
      const listRes = await callRoute(listRoute, activated.ctx)
      const shadowed = (listRes.body.templates as Array<{ filename: string; source?: string; shadowedSource?: { source: string; pluginId?: string } }>).find(
        (template) => template.filename === 'plug-only',
      )
      expect(shadowed?.source).toBe('user')
      expect(shadowed?.shadowedSource).toEqual({ source: 'plugin', pluginId: 'workflows' })
    })

    it('returns 400 on invalid body', async () => {
      writeFileSync(join(defsDir, 'edit-me.yaml'), yaml.dump(validDef))
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'PUT', '/definitions/:name')!

      const res = await callRoute(route, activated.ctx, {
        path: '/definitions/edit-me',
        searchParams: { name: 'edit-me' },
        body: { name: '', description: '', version: 1, steps: [] },
      })

      expect(res.status).toBe(400)
    })

    it('rejects unsafe workflow ids before updating disk', async () => {
      const outsidePath = join(testDir, 'workflows', 'escape.yaml')
      writeFileSync(outsidePath, yaml.dump({ ...validDef, name: 'Outside' }))
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'PUT', '/definitions/:name')!

      const res = await callRoute(route, activated.ctx, {
        path: '/definitions/..%2Fescape',
        searchParams: { name: '../escape' },
        body: { ...validDef, name: 'Updated Outside' },
      })

      expect(res.status).toBe(400)
      const onDisk = yaml.load(readFileSync(outsidePath, 'utf-8')) as Record<string, unknown>
      expect(onDisk.name).toBe('Outside')
    })
  })

  describe('PATCH /definitions/:name/availability', () => {
    it('disables a managed workflow and hides it from default list results', async () => {
      registerPluginDefinition('workflows', 'plug-only', validDef as unknown as WorkflowDefinition)
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const availabilityRoute = findRoute(activated.routes, 'PATCH', '/definitions/:name/availability')!
      const listRoute = findRoute(activated.routes, 'GET', '/definitions')!

      const res = await callRoute(availabilityRoute, activated.ctx, {
        path: '/definitions/plug-only/availability',
        searchParams: { name: 'plug-only' },
        body: { disabled: true },
      })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ id: 'plug-only', disabled: true })
      const availabilityFile = join(testDir, 'workflows', 'disabled-defaults.json')
      expect(JSON.parse(readFileSync(availabilityFile, 'utf-8'))).toEqual({
        disabledWorkflowIds: ['plug-only'],
      })

      const defaultList = await callRoute(listRoute, activated.ctx)
      const defaultNames = (defaultList.body.templates as Array<{ filename: string }>).map((template) => template.filename)
      expect(defaultNames).not.toContain('plug-only')

      const includedList = await callRoute(listRoute, activated.ctx, {
        searchParams: { includeDisabled: '1' },
      })
      const included = (includedList.body.templates as Array<{ filename: string; disabled?: boolean }>).find(
        (template) => template.filename === 'plug-only',
      )
      expect(included?.disabled).toBe(true)
    })

    it('reindexes managed workflow search status when availability changes', async () => {
      registerPluginDefinition('workflows', 'plug-only', validDef as unknown as WorkflowDefinition)
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const availabilityRoute = findRoute(activated.routes, 'PATCH', '/definitions/:name/availability')!

      await callRoute(availabilityRoute, activated.ctx, {
        path: '/definitions/plug-only/availability',
        searchParams: { name: 'plug-only' },
        body: { disabled: true },
      })

      expect(activated.ctx.search.index).toHaveBeenLastCalledWith(
        'def:plug-only',
        expect.objectContaining({
          name: 'New Demo',
          type: 'definition',
          status: 'disabled',
        }),
      )

      await callRoute(availabilityRoute, activated.ctx, {
        path: '/definitions/plug-only/availability',
        searchParams: { name: 'plug-only' },
        body: { disabled: false },
      })

      expect(activated.ctx.search.index).toHaveBeenLastCalledWith(
        'def:plug-only',
        expect.objectContaining({
          name: 'New Demo',
          type: 'definition',
          status: 'active',
        }),
      )
    })

    it('does not disable user-owned workflows', async () => {
      writeFileSync(join(defsDir, 'user-only.yaml'), yaml.dump(validDef))
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'PATCH', '/definitions/:name/availability')!

      const res = await callRoute(route, activated.ctx, {
        path: '/definitions/user-only/availability',
        searchParams: { name: 'user-only' },
        body: { disabled: true },
      })

      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/managed/i)
    })

    it('does not apply a managed disabled override to a user shadow', async () => {
      registerPluginDefinition('workflows', 'plug-only', validDef as unknown as WorkflowDefinition)
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const availabilityRoute = findRoute(activated.routes, 'PATCH', '/definitions/:name/availability')!
      const putRoute = findRoute(activated.routes, 'PUT', '/definitions/:name')!
      const getRoute = findRoute(activated.routes, 'GET', '/definitions/:name')!
      const listRoute = findRoute(activated.routes, 'GET', '/definitions')!

      await callRoute(availabilityRoute, activated.ctx, {
        path: '/definitions/plug-only/availability',
        searchParams: { name: 'plug-only' },
        body: { disabled: true },
      })

      const shadowRes = await callRoute(putRoute, activated.ctx, {
        path: '/definitions/plug-only',
        searchParams: { name: 'plug-only' },
        body: { ...validDef, name: 'User Shadow' },
      })
      expect(shadowRes.status).toBe(200)

      const defaultList = await callRoute(listRoute, activated.ctx)
      const listed = (defaultList.body.templates as Array<{ filename: string; disabled?: boolean; source?: string }>).find(
        (template) => template.filename === 'plug-only',
      )
      expect(listed?.source).toBe('user')
      expect(listed?.disabled).toBe(false)

      const detail = await callRoute(getRoute, activated.ctx, {
        path: '/definitions/plug-only',
        searchParams: { name: 'plug-only' },
      })
      expect(detail.body.source).toBe('user')
      expect(detail.body.disabled).toBe(false)
      expect(matchWorkflow('run the plug only workflow')).toBe('plug-only')

      const disableShadowRes = await callRoute(availabilityRoute, activated.ctx, {
        path: '/definitions/plug-only/availability',
        searchParams: { name: 'plug-only' },
        body: { disabled: true },
      })
      expect(disableShadowRes.status).toBe(409)
      expect(disableShadowRes.body.error).toMatch(/managed/i)
    })

    it('excludes disabled managed workflows from matching until re-enabled', async () => {
      registerPluginDefinition('workflows', 'plug-only', validDef as unknown as WorkflowDefinition)
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const availabilityRoute = findRoute(activated.routes, 'PATCH', '/definitions/:name/availability')!

      await callRoute(availabilityRoute, activated.ctx, {
        path: '/definitions/plug-only/availability',
        searchParams: { name: 'plug-only' },
        body: { disabled: true },
      })

      expect(matchWorkflow('run the plug only workflow')).toBeNull()

      await callRoute(availabilityRoute, activated.ctx, {
        path: '/definitions/plug-only/availability',
        searchParams: { name: 'plug-only' },
        body: { disabled: false },
      })

      expect(matchWorkflow('run the plug only workflow')).toBe('plug-only')
    })

    it('does not match empty draft workflows', async () => {
      writeFileSync(join(defsDir, 'draft-only.yaml'), yaml.dump({
        name: 'Draft Only',
        description: 'not ready to run',
        version: 1,
        steps: [],
      }))
      await activatePlugin(workflowsPlugin, testDir)

      expect(matchWorkflow('run the draft only workflow')).toBeNull()
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

    it('rejects unsafe workflow ids before deleting disk files', async () => {
      const outsidePath = join(testDir, 'workflows', 'escape.yaml')
      writeFileSync(outsidePath, yaml.dump({ ...validDef, name: 'Outside' }))
      const activated = await activatePlugin(workflowsPlugin, testDir)
      const route = findRoute(activated.routes, 'DELETE', '/definitions/:name')!

      const res = await callRoute(route, activated.ctx, {
        path: '/definitions/..%2Fescape',
        searchParams: { name: '../escape' },
      })

      expect(res.status).toBe(400)
      expect(existsSync(outsidePath)).toBe(true)
    })
  })

  describe('team-target validation (#611)', () => {
    const teamDef = {
      name: 'Team Demo',
      description: 'workflow with a team step',
      version: 1,
      steps: [{ id: 's1', type: 'agent', label: 'Do', agent: 'team:builders' }],
    }

    it('rejects a definition referencing a nonexistent team when the team plugin answers', async () => {
      const activated = await activatePlugin(workflowsPlugin, testDir)
      activated.ctx.hooks.invoke = mock(async (name: string) =>
        name === 'team.exists' ? false : undefined) as typeof activated.ctx.hooks.invoke
      const route = findRoute(activated.routes, 'POST', '/definitions')!

      const res = await callRoute(route, activated.ctx, { body: { id: 'team-demo', ...teamDef } })
      expect(res.status).toBe(400)
      expect((res.body.errors as string[]).join('\n')).toContain('unknown team "builders"')
    })

    it('accepts a definition whose team exists', async () => {
      const activated = await activatePlugin(workflowsPlugin, testDir)
      activated.ctx.hooks.invoke = mock(async (name: string) =>
        name === 'team.exists' ? true : undefined) as typeof activated.ctx.hooks.invoke
      const route = findRoute(activated.routes, 'POST', '/definitions')!

      const res = await callRoute(route, activated.ctx, { body: { id: 'team-demo', ...teamDef } })
      expect(res.status).toBe(201)
    })

    it('unavailable team plugin (unregistered hook) skips existence checks — tiered pass', async () => {
      const activated = await activatePlugin(workflowsPlugin, testDir)
      // Default harness invoke returns undefined for every hook — exactly the
      // unregistered-hook shape.
      const route = findRoute(activated.routes, 'POST', '/definitions')!

      const res = await callRoute(route, activated.ctx, { body: { id: 'team-demo', ...teamDef } })
      expect(res.status).toBe(201)
    })
  })
})
