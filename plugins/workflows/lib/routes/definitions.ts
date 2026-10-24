/**
 * Workflow Definition routes
 *
 * Notification-channel listing, template/definition reads, the user-owned
 * definition CRUD (YAML on disk), managed-availability toggling, skill repair,
 * and the node-type palette feed. Self-contained: handlers depend only on the
 * parser/template-list/source-registry/availability/node-type lib modules and
 * the search-sync indexer — no gate, dispatch, or instance state.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { dump, load } from 'js-yaml'
import { z } from 'zod'
import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import { createLogger } from '@bakin/core/logger'
import type { WorkflowDefinition } from '../../types'
import { getContentDir } from '../content-dir'
import { collectTeamTokenIds } from '@bakin/core/workflows/team-token'
import { loadDefinition, listDefinitions, listDefinitionsTolerant, validateDefinition, validateWorkflowId, yamlParseError } from '../parser'
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
import { splitFrontmatter } from '@bakin/core/format/frontmatter'
import { passthroughWf, errorResponseWf, repairSkillBodyWf, rawDefinitionBodyWf, rawSkillBodyWf } from '../route-schemas'

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
  writeFileSync(findExistingUserDefinitionPath(id) ?? join(dir, `${id}.yaml`), dump(def), 'utf-8')
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
    // An unregistered hook invokes to undefined (never a boolean) — the team
    // plugin is unavailable, so skip existence checks rather than treating
    // every team as unknown.
    if (checks.some(([, exists]) => exists === undefined)) return undefined
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

// ─── Raw recovery (self-healing PR1, Codex r1 #7) ────────────────────────
// A definition whose YAML does not parse (or carries a key the schema
// refuses) has no canvas to edit; the recover view edits the FILE. GET hands
// back the bytes on disk whatever state they are in; PUT accepts text that
// parses, passes the strict schema and the semantic validation, and writes
// it verbatim (formatting kept) — a failing save names the line or the key.

const managedDefinitionYaml = (name: string): string | null => {
  const entry = getRegistryDefinition(name)
  if (!entry) return null
  const { source: _source, pluginId: _pluginId, packageId: _packageId, ...bare } = entry.definition as Record<string, unknown>
  return dump(bare)
}

// GET /definitions/:name/raw
const getRawDefinitionHandler = async (req: Request, _ctx: PluginContextLite) => {
  const name = new URL(req.url).searchParams.get('name')
  if (!name) return Response.json({ error: 'name param required' }, { status: 400 })
  const nameError = validateWorkflowId(name)
  if (nameError) return Response.json({ error: nameError }, { status: 400 })
  const userPath = findExistingUserDefinitionPath(name)
  if (userPath) {
    const yaml = readFileSync(userPath, 'utf-8')
    const parseError = yamlParseError(yaml)
    return Response.json({ id: name, source: 'user', path: userPath, yaml, ...(parseError ? { parseError } : {}) })
  }
  const managed = managedDefinitionYaml(name)
  if (managed === null) return Response.json({ error: 'Definition not found' }, { status: 404 })
  const entry = getRegistryDefinition(name)
  // Saving a managed definition's raw text writes a user shadow (the user-wins rule) — said up front.
  return Response.json({ id: name, source: entry?.source ?? 'plugin', path: null, yaml: managed, shadowsOnSave: true })
}

// PUT /definitions/:name/raw  { yaml }
const putRawDefinitionHandler = async (req: Request, ctx: PluginContextLite, parsed?: { body?: { yaml?: string } }) => {
  const name = new URL(req.url).searchParams.get('name')
  if (!name) return Response.json({ error: 'name param required' }, { status: 400 })
  const nameError = validateWorkflowId(name)
  if (nameError) return Response.json({ error: nameError }, { status: 400 })
  const yaml = parsed?.body?.yaml
  if (typeof yaml !== 'string' || yaml.trim() === '') return Response.json({ error: 'yaml is required' }, { status: 400 })
  const parseError = yamlParseError(yaml)
  if (parseError) return Response.json({ error: `YAML does not parse${parseError.line ? ` at line ${parseError.line}` : ''}: ${parseError.message}`, parseError }, { status: 400 })
  const loaded = load(yaml)
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) return Response.json({ error: 'The YAML must be a mapping (a workflow definition).' }, { status: 400 })
  const { id: _id, source: _source, pluginId: _pluginId, packageId: _packageId, ...rest } = loaded as Record<string, unknown>
  const schema = workflowDefinitionSchema.safeParse(rest)
  if (!schema.success) return Response.json({ error: 'validation failed', issues: schema.error.issues }, { status: 400 })
  const definition = schema.data as WorkflowDefinition
  const semanticErrors = validateDefinition(definition, {
    definitionId: name,
    source: 'user',
    knownWorkflowIds: new Set([...listDefinitionsTolerant().entries.map((entry) => entry.name), name]),
    allowEmptySteps: true,
    knownTeamIds: await knownTeamIdsFor(definition, ctx),
  })
  if (semanticErrors.length > 0) return Response.json({ error: 'validation failed', errors: semanticErrors }, { status: 400 })
  const dir = getDefinitionsDir()
  mkdirSync(dir, { recursive: true })
  const path = findExistingUserDefinitionPath(name) ?? join(dir, `${name}.yaml`)
  writeFileSync(path, yaml.endsWith('\n') ? yaml : `${yaml}\n`, 'utf-8')
  return Response.json({ id: name, source: 'user', path, definition })
}

// Workflow skills live at ~/.bakin/workflows/skills/<file>.md; the file name is the record id (rows 127/128).
const SKILL_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/
const skillFilePath = (file: string): string => join(getContentDir(), 'workflows', 'skills', file)

/** What the skills health check would flag on this text — the editor shows the same words a save is refused with. */
export function workflowSkillProblems(content: string): Array<{ section: 'frontmatter' | 'output_schema'; message: string }> {
  const problems: Array<{ section: 'frontmatter' | 'output_schema'; message: string }> = []
  if (splitFrontmatter(content).raw === null) problems.push({ section: 'frontmatter', message: 'The file has no YAML frontmatter (a `---` block at the top).' })
  if (!content.includes('output_schema')) problems.push({ section: 'output_schema', message: 'The frontmatter declares no `output_schema`.' })
  return problems
}

// GET /skills/:name/raw
const getRawSkillHandler = async (_req: Request, _ctx: PluginContextLite, parsed?: { params?: { name?: string } }) => {
  const file = parsed?.params?.name
  if (!file || !SKILL_FILE_RE.test(file)) return Response.json({ error: 'name must be a skill file name (<name>.md)' }, { status: 400 })
  const path = skillFilePath(file)
  if (!existsSync(path)) return Response.json({ error: 'Skill file not found' }, { status: 404 })
  let content: string
  try {
    content = readFileSync(path, 'utf-8')
  } catch (err) {
    return Response.json({ error: `Skill file could not be read: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }
  return Response.json({ name: file, path, content, problems: workflowSkillProblems(content) })
}

// PUT /skills/:name/raw  { content }
const putRawSkillHandler = async (_req: Request, _ctx: PluginContextLite, parsed?: { params?: { name?: string }; body?: { content?: string } }) => {
  const file = parsed?.params?.name
  if (!file || !SKILL_FILE_RE.test(file)) return Response.json({ error: 'name must be a skill file name (<name>.md)' }, { status: 400 })
  const content = parsed?.body?.content
  if (typeof content !== 'string' || content.trim() === '') return Response.json({ error: 'content is required' }, { status: 400 })
  const path = skillFilePath(file)
  if (!existsSync(path)) return Response.json({ error: 'Skill file not found' }, { status: 404 })
  const problems = workflowSkillProblems(content)
  if (problems.length > 0) return Response.json({ error: problems.map((problem) => problem.message).join(' '), problems }, { status: 400 })
  writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`, 'utf-8')
  return Response.json({ name: file, path, saved: true })
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
  defineRoute({ path: '/definitions/:name/raw', method: 'GET', description: 'Read a workflow definition file verbatim for the recover editor — bytes on disk whatever state they parse into (managed definitions are dumped; saving them writes a user shadow)', summary: 'Read raw workflow YAML', params: z.object({ name: z.string() }), responses: { 200: passthroughWf, 400: errorResponseWf, 404: errorResponseWf, 500: errorResponseWf }, handler: getRawDefinitionHandler }),
  defineRoute({ path: '/definitions/:name/raw', method: 'PUT', description: 'Save a workflow definition from raw YAML text (parse + strict schema + semantic validation; written verbatim) — the recover editor\'s save', summary: 'Save raw workflow YAML', params: z.object({ name: z.string() }), body: rawDefinitionBodyWf, responses: { 200: passthroughWf, 400: errorResponseWf, 404: errorResponseWf, 500: errorResponseWf }, handler: putRawDefinitionHandler }),
  defineRoute({ path: '/skills/:name/raw', method: 'GET', description: 'Read a workflow skill file verbatim with the problems the skills health check would flag (frontmatter / output_schema)', summary: 'Read raw workflow skill', params: z.object({ name: z.string() }), responses: { 200: passthroughWf, 400: errorResponseWf, 404: errorResponseWf, 500: errorResponseWf }, handler: getRawSkillHandler }),
  defineRoute({ path: '/skills/:name/raw', method: 'PUT', description: 'Save a workflow skill file from raw text; refused while it still lacks frontmatter or an output_schema', summary: 'Save raw workflow skill', params: z.object({ name: z.string() }), body: rawSkillBodyWf, responses: { 200: passthroughWf, 400: errorResponseWf, 404: errorResponseWf, 500: errorResponseWf }, handler: putRawSkillHandler }),
  defineRoute({ path: '/node-types', method: 'GET', description: 'List registered workflow node types (builtin + plugin-registered) for the canvas palette', summary: 'List registered workflow node types (builtin + plugin-registered) for the canvas palette', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: nodeTypesHandler }),
]
