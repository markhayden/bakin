/**
 * Workflow Definition routes
 *
 * Notification-channel listing, template/definition reads, the user-owned
 * definition CRUD (YAML on disk), managed-availability toggling, skill repair,
 * and the node-type palette feed. Self-contained: handlers depend only on the
 * parser/template-list/source-registry/availability/node-type lib modules and
 * the search-sync indexer — no gate, dispatch, or instance state.
 */
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { z } from 'zod'
import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import { createLogger } from '@bakin/core/logger'
import type { WorkflowDefinition } from '../../types'
import { getContentDir } from '../content-dir'
import { collectTeamTokenIds } from '@bakin/core/workflows/team-token'
import { loadDefinition, listDefinitions, validateDefinition, validateWorkflowId } from '../parser'
import {
  buildTemplateList,
  resolveSubWorkflows,
  workflowSkillDriftForDefinition,
  workflowSkillDriftBySkill,
} from '../template-list'
import {
  isReadOnly,
  getDefinition as getRegistryDefinition,
  getShadowedSource,
} from '@bakin/core/workflows/source-registry'
import { isWorkflowDisabled, setWorkflowDisabled } from '../availability'
import { indexDefinition } from '../search-sync'
import { repairWorkflowSkillDrift } from '../workflow-skill-drift'
import { workflowDefinitionSchema, listNodeTypes } from '@bakin/core/workflows/node-type-registry'
import { listNotificationChannels } from '@bakin/core/workflows/notification-channel-registry'
import { passthroughWf, errorResponseWf, repairSkillBodyWf } from '../route-schemas'

const log = createLogger('workflows')

// ─── User-definition YAML paths ──────────────────────────────────────────
// User YAML files live at ~/.bakin/workflows/definitions/{id}.yaml.
// Plugin-shipped definitions are read-only — POST refuses to overwrite a
// plugin-owned id, DELETE refuses to remove a plugin-only id with no user
// shadow. PUT always writes to disk (creating a shadow if needed) because the
// user-wins rule lets a user override a plugin definition.

const getDefinitionsDir = (): string => join(getContentDir(), 'workflows', 'definitions')
const getUserDefinitionPaths = (id: string): { yamlPath: string; ymlPath: string } => {
  const dir = getDefinitionsDir()
  return {
    yamlPath: join(dir, `${id}.yaml`),
    ymlPath: join(dir, `${id}.yml`),
  }
}

const findExistingUserDefinitionPath = (id: string): string | null => {
  const { yamlPath, ymlPath } = getUserDefinitionPaths(id)
  return existsSync(yamlPath) ? yamlPath : existsSync(ymlPath) ? ymlPath : null
}

const userDefinitionExists = (id: string): boolean => findExistingUserDefinitionPath(id) !== null

const writeUserDefinition = (id: string, def: unknown): void => {
  const dir = getDefinitionsDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(findExistingUserDefinitionPath(id) ?? join(dir, `${id}.yaml`), yaml.dump(def), 'utf-8')
}

// ─── Handlers ─────────────────────────────────────────────────────────────

// GET /definitions — list all workflow templates
const listHandler = async (req: Request, _ctx: PluginContextLite) => {
  const url = new URL(req.url)
  const includeDisabled = url.searchParams.get('includeDisabled') === '1' || url.searchParams.get('includeDisabled') === 'true'
  return Response.json(buildTemplateList({ includeDisabled }))
}

// GET /definitions/:name — get a specific definition with resolved sub-workflows
const getDefinitionHandler = async (req: Request, _ctx: PluginContextLite) => {
  const url = new URL(req.url)
  const name = url.searchParams.get('name')

  if (!name) {
    return Response.json({ error: 'name param required' }, { status: 400 })
  }
  const nameError = validateWorkflowId(name)
  if (nameError) {
    return Response.json({ error: nameError }, { status: 400 })
  }

  const definition = loadDefinition(name)
  if (!definition) {
    return Response.json({ error: 'Definition not found' }, { status: 404 })
  }

  // Include resolved sub-workflows so clients don't need a second fetch
  const subWorkflows: Record<string, WorkflowDefinition> = {}
  resolveSubWorkflows(definition.steps, subWorkflows)

  return Response.json({
    definition,
    subWorkflows,
    source: definition.source,
    pluginId: definition.pluginId,
    disabled: definition.source !== 'user' && isWorkflowDisabled(name),
    shadowedSource: definition.source === 'user' ? getShadowedSource(name) : undefined,
    skillDrift: workflowSkillDriftForDefinition(definition, workflowSkillDriftBySkill(), subWorkflows),
  })
}

// POST /skills/:name/repair — replace a stale local workflow skill when provenance proves it is safe.
const repairSkillHandler = async (_req: Request, _ctx: PluginContextLite, parsed?: { params?: { name?: string }; body?: { confirmKnownOld?: boolean } }) => {
  const name = parsed?.params?.name
  if (!name) {
    return Response.json({ error: 'name param required' }, { status: 400 })
  }

  const result = repairWorkflowSkillDrift({
    contentDir: getContentDir(),
    skillName: name,
    confirmKnownOld: parsed?.body?.confirmKnownOld === true,
  })
  const status = result.status === 'applied'
    ? 200
    : result.status === 'not-found'
      ? 404
      : result.status === 'failed'
        ? 500
        : 409
  return Response.json(result.status === 'failed' ? { ...result, error: result.message } : result, { status })
}

// POST /definitions — create a new user-owned workflow YAML
/** Existing team ids for a definition's `team:<id>` step targets. Undefined
 * when the definition references none OR the team plugin is unreachable —
 * validateDefinition then skips existence checks (tiered, like nested-
 * workflow refs) and dispatch fails honestly instead. */
async function knownTeamIdsFor(definition: WorkflowDefinition, ctx: PluginContextLite): Promise<Set<string> | undefined> {
  const ids = collectTeamTokenIds(definition.steps ?? [])
  if (ids.length === 0) return undefined
  try {
    const checks = await Promise.all(ids.map(async (teamId) =>
      [teamId, await ctx.hooks.invoke<boolean>('team.exists', { teamId })] as const))
    return new Set(checks.filter(([, exists]) => exists === true).map(([teamId]) => teamId))
  } catch {
    return undefined
  }
}

const createDefinitionHandler = async (req: Request, ctx: PluginContextLite) => {
  let body: { id?: string; [k: string]: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id : undefined
  if (!id) {
    return Response.json({ error: 'id is required' }, { status: 400 })
  }
  const idError = validateWorkflowId(id)
  if (idError) {
    return Response.json({ error: idError }, { status: 400 })
  }
  if (userDefinitionExists(id)) {
    return Response.json(
      { error: `Workflow id "${id}" already exists. Use PUT to update it.` },
      { status: 409 },
    )
  }

  // Refuse to overwrite a plugin-only id (no user shadow yet)
  if (isReadOnly(id)) {
    const entry = getRegistryDefinition(id)
    return Response.json(
      { error: `Workflow id "${id}" is owned by plugin "${entry?.pluginId ?? 'unknown'}" — POST refuses to overwrite. Use PUT to create a user shadow.` },
      { status: 409 },
    )
  }

  const rest = { ...body }
  delete rest.id
  const parsed = workflowDefinitionSchema.safeParse(rest)
  if (!parsed.success) {
    return Response.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const definition = parsed.data as WorkflowDefinition
  const semanticErrors = validateDefinition(definition, {
    definitionId: id,
    source: 'user',
    knownWorkflowIds: new Set([...listDefinitions().map((entry) => entry.name), id]),
    allowEmptySteps: true,
    knownTeamIds: await knownTeamIdsFor(definition, ctx),
  })
  if (semanticErrors.length > 0) {
    return Response.json(
      { error: 'validation failed', errors: semanticErrors },
      { status: 400 },
    )
  }

  writeUserDefinition(id, definition)
  return Response.json({ id, source: 'user', definition }, { status: 201 })
}

// PUT /definitions/:name — update or create a user-owned workflow YAML
const updateDefinitionHandler = async (req: Request, ctx: PluginContextLite) => {
  const url = new URL(req.url)
  const name = url.searchParams.get('name')
  if (!name) {
    return Response.json({ error: 'name param required' }, { status: 400 })
  }
  const nameError = validateWorkflowId(name)
  if (nameError) {
    return Response.json({ error: nameError }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const rest = { ...body }
  delete rest.id
  const parsed = workflowDefinitionSchema.safeParse(rest)
  if (!parsed.success) {
    return Response.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const definition = parsed.data as WorkflowDefinition
  const semanticErrors = validateDefinition(definition, {
    definitionId: name,
    source: 'user',
    knownWorkflowIds: new Set([...listDefinitions().map((entry) => entry.name), name]),
    allowEmptySteps: true,
    knownTeamIds: await knownTeamIdsFor(definition, ctx),
  })
  if (semanticErrors.length > 0) {
    return Response.json(
      { error: 'validation failed', errors: semanticErrors },
      { status: 400 },
    )
  }

  writeUserDefinition(name, definition)
  return Response.json({ id: name, source: 'user', definition })
}

// PATCH /definitions/:name/availability — enable/disable a managed workflow
const updateAvailabilityHandler = async (req: Request, _ctx: PluginContextLite) => {
  const url = new URL(req.url)
  const name = url.searchParams.get('name')
  if (!name) {
    return Response.json({ error: 'name param required' }, { status: 400 })
  }
  const nameError = validateWorkflowId(name)
  if (nameError) {
    return Response.json({ error: nameError }, { status: 400 })
  }

  let body: { disabled?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.disabled !== 'boolean') {
    return Response.json({ error: 'disabled must be a boolean' }, { status: 400 })
  }

  const effectiveDefinition = loadDefinition(name)
  if (!effectiveDefinition || effectiveDefinition.source === 'user') {
    return Response.json({ error: 'Only managed workflows can be disabled' }, { status: 409 })
  }

  setWorkflowDisabled(name, body.disabled)
  try {
    await indexDefinition(name, effectiveDefinition, effectiveDefinition.source)
  } catch (err) {
    log.warn('Failed to reindex workflow availability change', { name, error: err instanceof Error ? err.message : String(err) })
  }
  return Response.json({ id: name, disabled: body.disabled })
}

// DELETE /definitions/:name — remove the user-owned YAML for this id
const deleteDefinitionHandler = async (req: Request, _ctx: PluginContextLite) => {
  const url = new URL(req.url)
  const name = url.searchParams.get('name')
  if (!name) {
    return Response.json({ error: 'name param required' }, { status: 400 })
  }
  const nameError = validateWorkflowId(name)
  if (nameError) {
    return Response.json({ error: nameError }, { status: 400 })
  }

  const existing = findExistingUserDefinitionPath(name)

  if (!existing) {
    // No user file. If plugin owns this id, the user is trying to delete
    // something they don't own — return 409 so the UI can explain.
    if (isReadOnly(name)) {
      const entry = getRegistryDefinition(name)
      return Response.json(
        { error: `Workflow id "${name}" is owned by plugin "${entry?.pluginId ?? 'unknown'}" — cannot delete. Edit the plugin or shadow it with PUT.` },
        { status: 409 },
      )
    }
    return Response.json({ error: 'Definition not found' }, { status: 404 })
  }

  unlinkSync(existing)
  return Response.json({ id: name, deleted: true })
}

// GET /node-types — palette data source. Returns the registered node-type
// metadata (builtin + plugin-registered) minus the Zod schemas (which
// aren't JSON-serializable). The canvas-editor palette hydrates from this.
const nodeTypesHandler = async (_req: Request, _ctx: PluginContextLite) => {
  const items = listNodeTypes().map((def) => ({
    kind: def.kind,
    runtime: def.runtime,
    pluginId: def.pluginId,
    edgeRules: def.edgeRules,
    formFields: def.formFields,
  }))
  return Response.json({ nodeTypes: items })
}

export const definitionRoutes = [
  defineRoute({
    path: '/notification-channels',
    method: 'GET',
    description: 'List registered notification channels',
    summary: 'List registered notification channels',
    responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf },
    handler: async (_req: Request, _ctx: PluginContextLite) => new Response(
      JSON.stringify({ channels: listNotificationChannels() }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  }),
  defineRoute({ path: '/definitions', method: 'GET', description: 'List all workflow templates with step counts and resolved sub-workflows', summary: 'List all workflow templates with step counts and resolved sub-workflows', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: listHandler }),
  defineRoute({ path: '/definitions/:name', method: 'GET', description: 'Get a specific workflow definition by name', summary: 'Get a specific workflow definition by name', params: z.object({ name: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: getDefinitionHandler }),
  defineRoute({ path: '/skills/:name/repair', method: 'POST', description: 'Repair a stale local workflow skill from its managed source when safe', summary: 'Repair stale workflow skill', params: z.object({ name: z.string() }), body: repairSkillBodyWf, responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: passthroughWf, 409: passthroughWf, 500: errorResponseWf }, handler: repairSkillHandler }),
  defineRoute({ path: '/definitions', method: 'POST', description: 'Create a new user-owned workflow definition', summary: 'Create a new user-owned workflow definition', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: createDefinitionHandler }),
  defineRoute({ path: '/definitions/:name', method: 'PUT', description: 'Update or shadow a workflow definition (writes user YAML)', summary: 'Update or shadow a workflow definition (writes user YAML)', params: z.object({ name: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: updateDefinitionHandler }),
  defineRoute({ path: '/definitions/:name/availability', method: 'PATCH', description: 'Enable or disable a managed workflow definition for automatic selection', summary: 'Toggle managed workflow availability', params: z.object({ name: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: updateAvailabilityHandler }),
  defineRoute({ path: '/definitions/:name', method: 'DELETE', description: 'Delete a user-owned workflow definition', summary: 'Delete a user-owned workflow definition', params: z.object({ name: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: deleteDefinitionHandler }),
  defineRoute({ path: '/node-types', method: 'GET', description: 'List registered workflow node types (builtin + plugin-registered) for the canvas palette', summary: 'List registered workflow node types (builtin + plugin-registered) for the canvas palette', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: nodeTypesHandler }),
]
