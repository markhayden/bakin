import type {
  ApiRouteContribution,
  CliCommandContribution,
  ClientRouteContribution,
  ClientRoutePatternContribution,
  ExecToolContribution,
  HttpMethod,
  NavItem,
  NavSection,
  PluginContributions,
  PluginManifest,
  PluginManifestSignature,
  PluginPermission,
  RuntimeCapability,
  SecretDeclaration,
  SettingsContribution,
} from '@makinbakin/sdk/types'

export const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{0,39}$/

const HTTP_METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const RUNTIME_CAPABILITIES = new Set<RuntimeCapability>([
  'agents',
  'messaging',
  'channels.message',
  'channels.rich-content',
  'channels.interactive-approval',
  'channels.threaded-replies',
  'cron',
  'skills',
  'models',
  'tasks',
  'search',
])

export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginManifestError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(obj: Record<string, unknown>, key: string, opts: { required?: boolean } = {}): string | undefined {
  const value = obj[key]
  if (value === undefined || value === null) {
    if (opts.required) throw new PluginManifestError(`bakin-plugin.json missing required field "${key}"`)
    return undefined
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PluginManifestError(`bakin-plugin.json field "${key}" must be a non-empty string`)
  }
  return value
}

function stringArrayField(obj: Record<string, unknown>, key: string): string[] | undefined {
  const value = obj[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    throw new PluginManifestError(`bakin-plugin.json field "${key}" must be an array of strings`)
  }
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new PluginManifestError(`bakin-plugin.json field "${key}" must contain only non-empty strings`)
    }
    if (!out.includes(item)) out.push(item)
  }
  return out
}

function secretDeclarationsField(obj: Record<string, unknown>, key: string): SecretDeclaration[] | undefined {
  const value = obj[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    throw new PluginManifestError(`bakin-plugin.json field "${key}" must be an array of secret declaration objects`)
  }

  const out: SecretDeclaration[] = []
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index++) {
    const item = value[index]
    if (!isRecord(item)) {
      throw new PluginManifestError(`bakin-plugin.json field "${key}[${index}]" must be an object`)
    }

    const name = item.name
    if (typeof name !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      throw new PluginManifestError(`bakin-plugin.json field "${key}[${index}].name" must be an environment variable name`)
    }

    if (seen.has(name)) continue
    seen.add(name)

    const description = item.description
    if (typeof description !== 'string' || description.trim().length === 0) {
      throw new PluginManifestError(`bakin-plugin.json field "${key}[${index}].description" must be a non-empty string`)
    }

    const required = item.required
    if (required !== undefined && typeof required !== 'boolean') {
      throw new PluginManifestError(`bakin-plugin.json field "${key}[${index}].required" must be a boolean`)
    }

    out.push({
      name,
      description,
      required: required ?? true,
    })
  }
  return out
}

function signatureStringField(obj: Record<string, unknown>, key: string): string {
  const value = obj[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PluginManifestError(`bakin-plugin.json field "signature.${key}" must be a non-empty string`)
  }
  return value
}

function recordField(obj: Record<string, unknown>, key: string, label: string): Record<string, unknown> | undefined {
  const value = obj[key]
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) {
    throw new PluginManifestError(`${label}.${key} must be an object`)
  }
  return value
}

function recordArrayField(obj: Record<string, unknown>, key: string, label: string): Record<string, unknown>[] | undefined {
  const value = obj[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    throw new PluginManifestError(`${label}.${key} must be an array`)
  }
  return value.map((item, itemIndex) => {
    if (!isRecord(item)) throw new PluginManifestError(`${label}.${key}[${itemIndex}] must be an object`)
    return item
  })
}

function validatePluginRelativePath(path: string, label: string): void {
  if (!path.startsWith('/')) {
    throw new PluginManifestError(`${label} path "${path}" must start with "/"`)
  }
  if (path.startsWith('/api/')) {
    throw new PluginManifestError(`${label} path "${path}" must be plugin-relative, not an absolute API path`)
  }
  if (path.includes('..')) {
    throw new PluginManifestError(`${label} path "${path}" must not contain ".."`)
  }
}

/**
 * Shape check for a route captured from live plugin code (sync-manifest):
 * the SAME rules parseApiRoute enforces at load time, as a message instead of
 * a throw. Returns null when the entry would survive a manifest round-trip.
 */
export function validateCapturedApiRoute(method: string, path: string): string | null {
  if (!HTTP_METHODS.has(method.toUpperCase() as HttpMethod)) {
    return `method "${method}" is not supported (use ${[...HTTP_METHODS].join('/')})`
  }
  try {
    validatePluginRelativePath(path, 'captured route')
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  return null
}

function parseApiRoute(raw: unknown, index: number): ApiRouteContribution {
  if (!isRecord(raw)) throw new PluginManifestError(`contributes.apiRoutes[${index}] must be an object`)
  const label = `contributes.apiRoutes[${index}]`
  const method = stringField(raw, 'method', { required: true })!.toUpperCase()
  if (!HTTP_METHODS.has(method as HttpMethod)) {
    throw new PluginManifestError(`contributes.apiRoutes[${index}].method "${method}" is not supported`)
  }
  const path = stringField(raw, 'path', { required: true })!
  validatePluginRelativePath(path, label)
  const summary = stringField(raw, 'summary', { required: true })!
  return {
    method: method as HttpMethod,
    path,
    summary,
    description: stringField(raw, 'description'),
    operationId: stringField(raw, 'operationId'),
    tags: stringArrayField(raw, 'tags'),
    visibility: stringField(raw, 'visibility') as ApiRouteContribution['visibility'],
    stability: stringField(raw, 'stability') as ApiRouteContribution['stability'],
    parameters: recordArrayField(raw, 'parameters', label) as ApiRouteContribution['parameters'],
    requestBody: recordField(raw, 'requestBody', label) as ApiRouteContribution['requestBody'],
    responses: recordField(raw, 'responses', label) as ApiRouteContribution['responses'],
    permissions: stringArrayField(raw, 'permissions') as PluginPermission[] | undefined,
  }
}

function parseClientRoute(raw: unknown, index: number): ClientRouteContribution {
  if (!isRecord(raw)) throw new PluginManifestError(`contributes.clientRoutes[${index}] must be an object`)
  const path = stringField(raw, 'path', { required: true })!
  if (!path.startsWith('/')) {
    throw new PluginManifestError(`contributes.clientRoutes[${index}].path "${path}" must start with "/"`)
  }
  if (path.startsWith('/api/')) {
    throw new PluginManifestError(`contributes.clientRoutes[${index}].path "${path}" must not be an API path`)
  }
  if (path.includes('..')) {
    throw new PluginManifestError(`contributes.clientRoutes[${index}].path "${path}" must not contain ".."`)
  }
  return {
    path,
    summary: stringField(raw, 'summary', { required: true })!,
    slot: stringField(raw, 'slot'),
  }
}

const NAV_BADGE_TONES = new Set(['error', 'attention', 'info', 'success'])
const NAV_SECTIONS = ['plan-and-automate', 'create', 'operations'] as const satisfies readonly NavSection[]
const NAV_SECTION_SET = new Set<string>(NAV_SECTIONS)

function parseNavItem(raw: unknown, label: string, topLevel: boolean): NavItem {
  if (!isRecord(raw)) throw new PluginManifestError(`${label} must be an object`)
  if (raw.placement !== undefined) {
    throw new PluginManifestError(`${label}.placement was removed; use section for normal destinations. Primary and utility regions are host-owned`)
  }
  if (raw.alwaysExpanded !== undefined) {
    throw new PluginManifestError(`${label}.alwaysExpanded was removed; navigation groups use the standard disclosure behavior`)
  }
  const item: NavItem = {
    id: stringField(raw, 'id', { required: true })!,
    label: stringField(raw, 'label', { required: true })!,
  }
  const icon = stringField(raw, 'icon')
  if (icon !== undefined) item.icon = icon
  const href = stringField(raw, 'href')
  if (href !== undefined) {
    if (!href.startsWith('/') || href.startsWith('/api/') || href.includes('..')) {
      throw new PluginManifestError(`${label}.href "${href}" must be an app path starting with "/" (not /api/, no "..")`)
    }
    item.href = href
  }
  if (raw.order !== undefined) {
    if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) {
      throw new PluginManifestError(`${label}.order must be a finite number`)
    }
    item.order = raw.order
  }
  if (raw.section !== undefined) {
    if (!topLevel) {
      throw new PluginManifestError(`${label}.section is only valid on top-level nav items`)
    }
    if (typeof raw.section !== 'string' || !NAV_SECTION_SET.has(raw.section)) {
      throw new PluginManifestError(`${label}.section must be one of: ${NAV_SECTIONS.join(', ')}`)
    }
    item.section = raw.section as NavSection
  }
  if (raw.badge !== undefined) {
    if (!isRecord(raw.badge)) throw new PluginManifestError(`${label}.badge must be an object`)
    const badge: NavItem['badge'] = {}
    if (raw.badge.count !== undefined) {
      if (typeof raw.badge.count !== 'number' || !Number.isFinite(raw.badge.count)) {
        throw new PluginManifestError(`${label}.badge.count must be a finite number`)
      }
      badge.count = raw.badge.count
    }
    if (raw.badge.tone !== undefined) {
      if (typeof raw.badge.tone !== 'string' || !NAV_BADGE_TONES.has(raw.badge.tone)) {
        throw new PluginManifestError(`${label}.badge.tone must be one of: ${[...NAV_BADGE_TONES].join(', ')}`)
      }
      badge.tone = raw.badge.tone as NonNullable<NavItem['badge']>['tone']
    }
    item.badge = badge
  }
  if (raw.children !== undefined) {
    if (!Array.isArray(raw.children)) throw new PluginManifestError(`${label}.children must be an array`)
    item.children = raw.children.map((child, childIndex) => parseNavItem(child, `${label}.children[${childIndex}]`, false))
  }
  return item
}

function parseRoutePattern(raw: unknown, index: number): ClientRoutePatternContribution {
  if (!isRecord(raw)) throw new PluginManifestError(`contributes.routes[${index}] must be an object`)
  const path = stringField(raw, 'path', { required: true })!
  if (!path.startsWith('/')) {
    throw new PluginManifestError(`contributes.routes[${index}].path "${path}" must start with "/"`)
  }
  if (path.startsWith('/api/')) {
    throw new PluginManifestError(`contributes.routes[${index}].path "${path}" must not be an API path`)
  }
  if (path.includes('..')) {
    throw new PluginManifestError(`contributes.routes[${index}].path "${path}" must not contain ".."`)
  }
  return {
    path,
    summary: stringField(raw, 'summary'),
  }
}

function parseExecTool(raw: unknown, index: number): ExecToolContribution {
  if (!isRecord(raw)) throw new PluginManifestError(`contributes.execTools[${index}] must be an object`)
  return {
    name: stringField(raw, 'name', { required: true })!,
    summary: stringField(raw, 'summary', { required: true })!,
    description: stringField(raw, 'description'),
    permissions: stringArrayField(raw, 'permissions') as PluginPermission[] | undefined,
  }
}

function parseCliCommand(raw: unknown, index: number): CliCommandContribution {
  if (!isRecord(raw)) throw new PluginManifestError(`contributes.cliCommands[${index}] must be an object`)
  // `dispatch` is optional: commands without it are documentation-only —
  // they describe a built-in CLI surface (handled imperatively in
  // cli/bakin.ts) and are never wired through dispatchPluginCliCommand.
  // Only commands with explicit dispatch participate in the manifest-driven
  // dispatcher.
  let parsedDispatch: CliCommandContribution['dispatch']
  if (raw.dispatch !== undefined) {
    const dispatch = raw.dispatch
    if (!isRecord(dispatch)) {
      throw new PluginManifestError(`contributes.cliCommands[${index}].dispatch must be an object`)
    }
    const dispatchType = stringField(dispatch, 'type', { required: true })
    if (dispatchType === 'apiRoute') {
      const method = stringField(dispatch, 'method', { required: true })!.toUpperCase()
      if (!HTTP_METHODS.has(method as HttpMethod)) {
        throw new PluginManifestError(`contributes.cliCommands[${index}].dispatch.method "${method}" is not supported`)
      }
      const path = stringField(dispatch, 'path', { required: true })!
      validatePluginRelativePath(path, `contributes.cliCommands[${index}].dispatch`)
      parsedDispatch = { type: 'apiRoute', method: method as HttpMethod, path }
    } else if (dispatchType === 'execTool') {
      parsedDispatch = { type: 'execTool', name: stringField(dispatch, 'name', { required: true })! }
    } else {
      throw new PluginManifestError(`contributes.cliCommands[${index}].dispatch.type must be "apiRoute" or "execTool"`)
    }
  }
  return {
    name: stringField(raw, 'name', { required: true })!,
    usage: stringField(raw, 'usage', { required: true })!,
    summary: stringField(raw, 'summary', { required: true })!,
    description: stringField(raw, 'description'),
    aliases: stringArrayField(raw, 'aliases'),
    dispatch: parsedDispatch,
  }
}

function parseSettings(raw: unknown, index: number): SettingsContribution {
  if (!isRecord(raw)) throw new PluginManifestError(`contributes.settings[${index}] must be an object`)
  return {
    key: stringField(raw, 'key', { required: true })!,
    summary: stringField(raw, 'summary', { required: true })!,
  }
}

function parseContributions(input: unknown): PluginContributions | undefined {
  if (input === undefined || input === null) return undefined
  if (!isRecord(input)) throw new PluginManifestError(`bakin-plugin.json field "contributes" must be an object`)
  const out: PluginContributions = {}

  if (input.apiRoutes !== undefined) {
    if (!Array.isArray(input.apiRoutes)) throw new PluginManifestError('contributes.apiRoutes must be an array')
    out.apiRoutes = input.apiRoutes.map(parseApiRoute)
  }
  if (input.clientRoutes !== undefined) {
    if (!Array.isArray(input.clientRoutes)) throw new PluginManifestError('contributes.clientRoutes must be an array')
    out.clientRoutes = input.clientRoutes.map(parseClientRoute)
  }
  if (input.execTools !== undefined) {
    if (!Array.isArray(input.execTools)) throw new PluginManifestError('contributes.execTools must be an array')
    out.execTools = input.execTools.map(parseExecTool)
  }
  if (input.cliCommands !== undefined) {
    if (!Array.isArray(input.cliCommands)) throw new PluginManifestError('contributes.cliCommands must be an array')
    out.cliCommands = input.cliCommands.map(parseCliCommand)
  }
  if (input.settings !== undefined) {
    if (!Array.isArray(input.settings)) throw new PluginManifestError('contributes.settings must be an array')
    out.settings = input.settings.map(parseSettings)
  }
  if (input.docs !== undefined) {
    if (!isRecord(input.docs)) throw new PluginManifestError('contributes.docs must be an object')
    out.docs = { slug: stringField(input.docs, 'slug', { required: true })! }
  }
  if (input.nav !== undefined) {
    if (!Array.isArray(input.nav)) throw new PluginManifestError('contributes.nav must be an array')
    const seenNavIds = new Set<string>()
    out.nav = input.nav.map((item, index) => parseNavItem(item, `contributes.nav[${index}]`, true))
    const collectIds = (items: NavItem[]): void => {
      for (const item of items) {
        if (seenNavIds.has(item.id)) {
          throw new PluginManifestError(`contributes.nav declares duplicate nav item id "${item.id}"`)
        }
        seenNavIds.add(item.id)
        if (item.children) collectIds(item.children)
      }
    }
    collectIds(out.nav)
  }
  if (input.routes !== undefined) {
    if (!Array.isArray(input.routes)) throw new PluginManifestError('contributes.routes must be an array')
    out.routes = input.routes.map(parseRoutePattern)
    const seenPaths = new Set<string>()
    for (const route of out.routes) {
      if (seenPaths.has(route.path)) {
        throw new PluginManifestError(`contributes.routes declares duplicate path "${route.path}"`)
      }
      seenPaths.add(route.path)
    }
  }
  if (input.slots !== undefined) {
    if (!Array.isArray(input.slots)) throw new PluginManifestError('contributes.slots must be an array of strings')
    const slots: string[] = []
    for (const slot of input.slots) {
      if (typeof slot !== 'string' || slot.length === 0) {
        throw new PluginManifestError('contributes.slots must contain only non-empty strings')
      }
      if (!slots.includes(slot)) slots.push(slot)
    }
    out.slots = slots
  }
  if (input.eager !== undefined) {
    if (typeof input.eager !== 'boolean') {
      throw new PluginManifestError('contributes.eager must be a boolean')
    }
    out.eager = input.eager
  }

  return out
}

function parseSignature(raw: unknown): PluginManifestSignature | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isRecord(raw)) {
    throw new PluginManifestError('bakin-plugin.json field "signature" must be an object')
  }
  const algorithm = signatureStringField(raw, 'algorithm')
  if (algorithm !== 'ed25519') {
    throw new PluginManifestError('bakin-plugin.json field "signature.algorithm" must be "ed25519"')
  }
  return {
    algorithm,
    signer: signatureStringField(raw, 'signer'),
    publicKey: signatureStringField(raw, 'publicKey'),
    signature: signatureStringField(raw, 'signature'),
  }
}

export function parsePluginManifest(raw: unknown): PluginManifest {
  if (!isRecord(raw)) {
    throw new PluginManifestError('bakin-plugin.json must contain a JSON object')
  }
  const id = stringField(raw, 'id', { required: true })!
  if (!PLUGIN_ID_RE.test(id)) {
    throw new PluginManifestError(`Invalid plugin id "${id}" - must match ${PLUGIN_ID_RE}`)
  }

  // Removed-field tombstones (prelaunch-hardening R10/R15). There is ONE
  // canonical plugin layout — index.ts (server) + optional client.tsx at the
  // plugin root — so entry points are no longer declarable, and no
  // `bakin plugins test` runner ever shipped.
  if (raw.entry !== undefined) {
    throw new PluginManifestError(
      'bakin-plugin.json field "entry" was removed — plugins use the canonical root layout: '
      + 'index.ts (server entry) and optional client.tsx at the plugin root. Delete the "entry" field. '
      + 'For an already-installed plugin: edit ~/.bakin/plugins/<id>/bakin-plugin.json to remove the field '
      + '(the install lockfile will then report manifest drift until you reinstall, which refreshes its manifestSha).',
    )
  }
  if (raw.tests !== undefined) {
    throw new PluginManifestError(
      'bakin-plugin.json field "tests" was removed — there is no "bakin plugins test" runner. Delete the "tests" field.',
    )
  }

  const runtimeCapabilities = stringArrayField(raw, 'runtimeCapabilities') as RuntimeCapability[] | undefined
  if (runtimeCapabilities) {
    for (const capability of runtimeCapabilities) {
      if (!RUNTIME_CAPABILITIES.has(capability)) {
        throw new PluginManifestError(`Unknown runtime capability "${capability}"`)
      }
    }
  }

  return {
    id,
    name: stringField(raw, 'name', { required: true })!,
    version: stringField(raw, 'version', { required: true })!,
    bakin: stringField(raw, 'bakin', { required: true })!,
    description: stringField(raw, 'description', { required: true })!,
    contentFiles: stringArrayField(raw, 'contentFiles'),
    secrets: secretDeclarationsField(raw, 'secrets'),
    dependencies: stringArrayField(raw, 'dependencies'),
    permissions: stringArrayField(raw, 'permissions') as PluginPermission[] | undefined,
    runtimeCapabilities,
    contributes: parseContributions(raw.contributes),
    devWatch: stringArrayField(raw, 'devWatch'),
    signature: parseSignature(raw.signature),
  }
}

export function readPluginManifestJson(text: string): PluginManifest {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new PluginManifestError(`Invalid bakin-plugin.json: ${err instanceof Error ? err.message : String(err)}`)
  }
  return parsePluginManifest(raw)
}
