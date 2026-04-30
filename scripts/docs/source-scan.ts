import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const repoRoot = new URL('../..', import.meta.url).pathname
const repoSourceRoots = [
  join(repoRoot, 'plugins'),
  join(repoRoot, 'src'),
  join(repoRoot, 'packages'),
  join(repoRoot, 'scripts/lib'),
]

/**
 * Plugins that ship outside this repo. We still document them on the public
 * docs site, so source-scan walks their checkouts when introspecting tool /
 * hook registrations.
 *
 * Resolution order, highest priority first:
 *   1. `BAKIN_DOCS_EXTERNAL_SOURCES` env var (comma-separated absolute paths).
 *   2. `../bakin-bits-official/plugins/<id>` next to the bakin checkout.
 *
 * Each entry maps an extracted plugin id to a list of search paths. The first
 * existing path wins. Used by `check.ts` to render an actionable error when an
 * extracted plugin can't be found and the snippet has no source to render
 * from.
 */
/**
 * Maps the docs:exec-tools marker (the slug between `bakin_exec_` and the
 * action) to the plugin directory in the sibling repo. Only mismatched today
 * is `project` (marker, singular) vs `projects` (sibling-repo dir, plural).
 */
export const EXTRACTED_PLUGINS: Record<string, string> = {
  messaging: 'messaging',
  project: 'projects',
}

function envExternalRoots(): string[] {
  const raw = process.env.BAKIN_DOCS_EXTERNAL_SOURCES
  if (!raw) return []
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(p => resolve(p))
}

function siblingExternalRoot(): string | undefined {
  const candidate = resolve(repoRoot, '..', 'bakin-bits-official', 'plugins')
  return existsSync(candidate) ? candidate : undefined
}

export function externalSourceRoots(): string[] {
  const env = envExternalRoots()
  if (env.length > 0) return env
  const sibling = siblingExternalRoot()
  return sibling ? [sibling] : []
}

export function locateExtractedPlugin(marker: string): string | undefined {
  const dirName = EXTRACTED_PLUGINS[marker]
  if (!dirName) return undefined
  for (const root of externalSourceRoots()) {
    const direct = join(root, dirName)
    if (existsSync(join(direct, 'index.ts'))) return direct
    // env var may already point at the plugin dir, not the plugins parent.
    if (root.endsWith(`/${dirName}`) && existsSync(join(root, 'index.ts'))) return root
  }
  return undefined
}

function walkFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.astro') continue
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) walkFiles(path, files)
    else if (/\.(ts|tsx)$/.test(entry)) files.push(path)
  }
  return files
}

export function sourceFiles(): string[] {
  const repoFiles = repoSourceRoots.flatMap(root => walkFiles(root))
  const externalFiles = externalSourceRoots()
    .filter(root => existsSync(root))
    .flatMap(root => walkFiles(root))
  return [...repoFiles, ...externalFiles]
}

export function relativeSource(path: string): string {
  if (path.startsWith(repoRoot)) {
    return path.replace(repoRoot, '').replace(/^\//, '')
  }
  for (const root of externalSourceRoots()) {
    // Walk up one to keep the repo name as a prefix (`bakin-bits-official/...`)
    // so paths in the generated catalog stay unambiguous when extracted plugins
    // live in a sibling repo.
    const repoParent = resolve(root, '..', '..')
    if (path.startsWith(repoParent)) {
      return path.replace(repoParent, '').replace(/^\//, '')
    }
  }
  return path
}

export interface ExecTool {
  name: string
  label?: string
  description?: string
  parameters: ExecToolParameter[]
  file: string
  line: number
}

export interface ExecToolParameter {
  name: string
  type: string
  required: boolean
  description?: string
}

function extractBalancedBlock(text: string, startIndex: number): string {
  const open = text.indexOf('{', startIndex)
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const char = text[i]
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return ''
}

function extractExecToolParameters(block: string): ExecToolParameter[] {
  const parametersIndex = block.indexOf('parameters:')
  if (parametersIndex === -1) return []
  const parametersBlock = extractBalancedBlock(block, parametersIndex)
  if (!parametersBlock.trim()) return []
  const params: ExecToolParameter[] = []
  const paramPattern = /([A-Za-z0-9_]+):\s*z\.([A-Za-z]+)([\s\S]*?)(?=\n\s*[A-Za-z0-9_]+:\s*z\.|\n\s*handler:|\n\s*},|\n\s*}\s*,|(?![\s\S]))/g
  for (const match of parametersBlock.matchAll(paramPattern)) {
    const [, name, rawType, expression] = match
    const desc = expression.match(/\.describe\(\s*(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*)\1\s*,?\s*\)/)?.[2]
    params.push({
      name,
      type: rawType === 'enum' ? 'choice' : rawType,
      required: !expression.includes('.optional()') && !expression.includes('.default('),
      description: desc?.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`').trim(),
    })
  }
  return params
}

export function extractExecTools(): ExecTool[] {
  const tools: ExecTool[] = []
  const seen = new Set<string>()
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const nameMatch = lines[i].match(/name:\s*['"`](bakin_exec_[^'"`]+)['"`]/)
      if (!nameMatch) continue
      const name = nameMatch[1]
      const key = `${name}:${file}`
      if (seen.has(key)) continue
      seen.add(key)
      const block = lines.slice(i, Math.min(lines.length, i + 95)).join('\n')
      const labelMatch = block.match(/label:\s*(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*)\1/)
      const descMatch = block.match(/description:\s*(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*)\1/)
      const label = labelMatch?.[2]?.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`')
      const description = descMatch?.[2]?.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`')
      const parameters = extractExecToolParameters(block)
      tools.push({ name, label, description, parameters, file: relativeSource(file), line: i + 1 })
    }
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file))
}

export function renderExecToolsSnippet(marker: string): string {
  const tools = extractExecTools().filter(t => t.name.startsWith(`bakin_exec_${marker}_`))
  if (!tools.length) return ''
  const lines = [`<!-- docs:exec-tools ${marker} -->`]
  for (const tool of tools) {
    const desc = tool.description?.trim()
    lines.push(`- \`${tool.name}\`${desc ? `: ${desc}` : ''}`)
  }
  lines.push('<!-- /docs:exec-tools -->')
  return lines.join('\n')
}

// ─── Plugin manifest scanning ────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

export interface ApiRouteContribution {
  method: HttpMethod
  path: string
  summary: string
  permissions?: string[]
}

export interface ExecToolContribution {
  name: string
  summary: string
  description?: string
  permissions?: string[]
}

export interface CliCommandContribution {
  name: string
  usage: string
  summary: string
  description?: string
  aliases?: string[]
  dispatch?: { type: 'apiRoute'; method: HttpMethod; path: string } | { type: 'execTool'; name: string }
}

export interface PluginContributes {
  apiRoutes?: ApiRouteContribution[]
  cliCommands?: CliCommandContribution[]
  execTools?: ExecToolContribution[]
  settings?: { key: string; summary: string }[]
  docs?: { slug: string }
}

export interface PluginManifestRecord {
  id: string
  name: string
  version: string
  description?: string
  contributes?: PluginContributes
  /** Where the manifest came from — useful for source-line citations and the catalog. */
  manifestPath: string
}

function readManifestFile(path: string): PluginManifestRecord | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PluginManifestRecord>
    if (!parsed.id || !parsed.name || !parsed.version) return undefined
    return {
      id: parsed.id,
      name: parsed.name,
      version: parsed.version,
      description: parsed.description,
      contributes: parsed.contributes,
      manifestPath: relativeSource(path),
    }
  } catch {
    return undefined
  }
}

/**
 * Walks every plugin manifest reachable from the docs build:
 *   - in-repo `plugins/<id>/bakin-plugin.json`
 *   - sibling `bakin-bits-official/plugins/<id>/bakin-plugin.json` (or whatever
 *     `BAKIN_DOCS_EXTERNAL_SOURCES` points at)
 *
 * Skips scaffold directories whose id begins with `_` (e.g. `_template`).
 */
export function listPluginManifests(): PluginManifestRecord[] {
  const records: PluginManifestRecord[] = []
  const inRepoDir = join(repoRoot, 'plugins')
  if (existsSync(inRepoDir)) {
    for (const entry of readdirSync(inRepoDir).sort()) {
      if (entry.startsWith('_')) continue
      const manifestPath = join(inRepoDir, entry, 'bakin-plugin.json')
      if (!existsSync(manifestPath)) continue
      const record = readManifestFile(manifestPath)
      if (record) records.push(record)
    }
  }
  for (const root of externalSourceRoots()) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root).sort()) {
      if (entry.startsWith('_')) continue
      const manifestPath = join(root, entry, 'bakin-plugin.json')
      if (!existsSync(manifestPath)) continue
      const record = readManifestFile(manifestPath)
      if (record) records.push(record)
    }
  }
  return records
}

export function getPluginManifest(pluginId: string): PluginManifestRecord | undefined {
  return listPluginManifests().find(m => m.id === pluginId)
}

// ─── Source-side route extraction ────────────────────────────────────────────

export interface ApiRouteRegistration extends ApiRouteContribution {
  pluginId: string
  file: string
  line: number
}

const HTTP_METHOD_LITERALS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])

function pluginIdFromFile(file: string): string | undefined {
  const rel = relativeSource(file)
  const match = rel.match(/^(?:[\w.-]+\/)?plugins\/([^/]+)\//)
  return match?.[1]
}

/**
 * Scans every plugin source file for route definitions and extracts the
 * documented surface (method, path, summary). Used as a fallback for plugins
 * that don't declare `contributes.apiRoutes` in their manifest yet.
 *
 * Two registration patterns covered:
 *   1. Inline literal: `ctx.registerRoute({ path: ..., method: ..., ... })`
 *   2. Named export pattern: `export const fooRoute: APIRoute = { path: ..., method: ..., ... }`
 *      (the memory plugin uses this to organize routes into separate files)
 */
export function extractApiRoutes(): ApiRouteRegistration[] {
  const routes: ApiRouteRegistration[] = []
  for (const file of sourceFiles()) {
    if (!file.includes('/plugins/')) continue
    const pluginId = pluginIdFromFile(file)
    if (!pluginId) continue
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const isInline = /ctx\.registerRoute\s*\(\s*\{/.test(lines[i])
      const isNamedRoute = /(?:export\s+)?const\s+\w+\s*:\s*APIRoute\s*=\s*\{/.test(lines[i])
      if (!isInline && !isNamedRoute) continue
      const block = lines.slice(i, Math.min(lines.length, i + 30)).join('\n')
      const path = block.match(/path:\s*['"`]([^'"`]+)['"`]/)?.[1]
      const method = block.match(/method:\s*['"`]([A-Z]+)['"`]/)?.[1]
      if (!path || !method || !HTTP_METHOD_LITERALS.has(method)) continue
      const summary =
        block.match(/summary:\s*(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*)\1/)?.[2] ??
        block.match(/description:\s*(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*)\1/)?.[2]
      const cleanedSummary = summary?.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`')
      routes.push({
        pluginId,
        method: method as HttpMethod,
        path,
        summary: cleanedSummary?.trim() || `${method} ${path}`,
        file: relativeSource(file),
        line: i + 1,
      })
    }
  }
  // Dedupe — a route exported from a lib file then registered in index.ts
  // should appear once. Prefer the lib definition (more authoritative).
  const seen = new Set<string>()
  const deduped: ApiRouteRegistration[] = []
  for (const route of routes) {
    const key = `${route.pluginId}:${route.method}:${route.path}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(route)
  }
  return deduped.sort((a, b) =>
    a.pluginId.localeCompare(b.pluginId) ||
    a.path.localeCompare(b.path) ||
    a.method.localeCompare(b.method),
  )
}

// ─── Manifest-first contribution accessors ───────────────────────────────────

/**
 * Returns the API routes for `pluginId`, manifest-first with source-scan as
 * fallback. Manifest declarations win because they're the contract; source is
 * a safety net while in-repo plugins finish backfilling.
 */
export function getApiRoutes(pluginId: string): ApiRouteContribution[] {
  const manifest = getPluginManifest(pluginId)
  if (manifest?.contributes?.apiRoutes?.length) return manifest.contributes.apiRoutes
  return extractApiRoutes()
    .filter(r => r.pluginId === pluginId)
    .map(({ method, path, summary, permissions }) => ({ method, path, summary, permissions }))
}

/**
 * Manifest-first exec-tool contributions. Falls back to the source scan, which
 * also covers the legacy `bakin_exec_*_*` global helpers (e.g., the workflow
 * step helpers that aren't tied to the plugin's marker prefix).
 */
export function getExecTools(pluginId: string, marker?: string): ExecToolContribution[] {
  const manifest = getPluginManifest(pluginId)
  if (manifest?.contributes?.execTools?.length) return manifest.contributes.execTools
  const prefix = `bakin_exec_${marker ?? pluginId}_`
  return extractExecTools()
    .filter(t => t.name.startsWith(prefix))
    .map(t => ({ name: t.name, summary: t.description?.trim() || t.name, description: t.description }))
}

/**
 * Manifest-first CLI contributions. Returns the manifest's declared commands
 * if present; otherwise returns nothing — in-repo plugins that haven't
 * backfilled their manifest fall back to the `commandSnippets` const in the
 * docs scripts (see `check.ts` / `generate.ts`).
 */
export function getCliCommands(pluginId: string): CliCommandContribution[] {
  const manifest = getPluginManifest(pluginId)
  return manifest?.contributes?.cliCommands ?? []
}

// ─── Settings schema extraction ──────────────────────────────────────────────

export interface PluginSettingField {
  key: string
  type: string
  label?: string
  description?: string
  default?: string
}

function findMatchingBrace(text: string, openIdx: number, open: string, close: string): number {
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function extractFieldsArrayBody(source: string): string | null {
  const schemaMatch = source.match(/settingsSchema:\s*\{/)
  if (!schemaMatch || schemaMatch.index === undefined) return null
  const schemaOpen = schemaMatch.index + schemaMatch[0].length - 1
  const schemaClose = findMatchingBrace(source, schemaOpen, '{', '}')
  if (schemaClose === -1) return null
  const schemaBody = source.slice(schemaOpen + 1, schemaClose)
  const fieldsMatch = schemaBody.match(/fields:\s*\[/)
  if (!fieldsMatch || fieldsMatch.index === undefined) return null
  const arrOpen = fieldsMatch.index + fieldsMatch[0].length - 1
  const arrClose = findMatchingBrace(schemaBody, arrOpen, '[', ']')
  if (arrClose === -1) return null
  return schemaBody.slice(arrOpen + 1, arrClose)
}

function splitFieldObjects(arrayBody: string): string[] {
  const objects: string[] = []
  let depth = 0
  let start = -1
  let inString: string | null = null
  for (let i = 0; i < arrayBody.length; i++) {
    const ch = arrayBody[i]
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        objects.push(arrayBody.slice(start + 1, i))
        start = -1
      }
    }
  }
  return objects
}

function parseDefaultsConst(source: string): Map<string, string> {
  const map = new Map<string, string>()
  const match = source.match(/const\s+DEFAULTS(?::\s*[^=]+)?\s*=\s*\{/)
  if (!match || match.index === undefined) return map
  const open = match.index + match[0].length - 1
  const close = findMatchingBrace(source, open, '{', '}')
  if (close === -1) return map
  const body = source.slice(open + 1, close)
  // Match each "key: value," pair at depth 0.
  let depth = 0
  let entryStart = 0
  let inString: string | null = null
  const pushEntry = (entry: string) => {
    const colon = entry.indexOf(':')
    if (colon === -1) return
    const key = entry.slice(0, colon).trim().replace(/^['"`]|['"`]$/g, '')
    const value = entry.slice(colon + 1).trim().replace(/,$/, '').trim()
    if (key) map.set(key, value)
  }
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue }
    if (ch === '{' || ch === '[' || ch === '(') depth++
    else if (ch === '}' || ch === ']' || ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      pushEntry(body.slice(entryStart, i))
      entryStart = i + 1
    }
  }
  pushEntry(body.slice(entryStart))
  return map
}

function parseTopLevelStringConsts(source: string): Map<string, string> {
  const map = new Map<string, string>()
  // Matches: const FOO = 'bar' or const FOO: T = "bar"
  const re = /(?:^|\n)\s*const\s+([A-Z_][A-Z0-9_]*)\s*(?::[^=\n]+)?\s*=\s*(['"`])((?:\\.|(?!\2).)*)\2/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    map.set(match[1], match[3])
  }
  return map
}

function resolveDefault(
  raw: string | undefined,
  defaults: Map<string, string>,
  topLevelConsts: Map<string, string>,
): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim().replace(/,$/, '').trim()
  // DEFAULTS.foo or DEFAULTS['foo']
  const refMatch = trimmed.match(/^DEFAULTS\.([A-Za-z_][\w]*)/) ??
    trimmed.match(/^DEFAULTS\[['"`]([^'"`]+)['"`]\]/)
  if (refMatch) {
    const resolved = defaults.get(refMatch[1])
    if (resolved !== undefined) return resolved
  }
  // Bare top-level const reference (e.g. `default: DEFAULT_CHANNEL`).
  const constMatch = trimmed.match(/^([A-Z_][A-Z0-9_]*)$/)
  if (constMatch) {
    const resolved = topLevelConsts.get(constMatch[1])
    if (resolved !== undefined) return resolved
  }
  return trimmed
}

function extractFieldKV(block: string, key: string): string | undefined {
  // Capture: key: 'value' or key: "value" or key: `value`
  const re = new RegExp(`${key}:\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`, 's')
  const m = block.match(re)
  if (m) return m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`')
  // Capture: key: <bare-value> up to comma-or-end
  const bare = block.match(new RegExp(`${key}:\\s*([^,}\\n]+)`, 's'))
  return bare?.[1]?.trim()
}

/**
 * Extracts the `settingsSchema.fields` declaration from a plugin's `index.ts`
 * and returns rich field metadata. Resolves `DEFAULTS.foo`-style references
 * against the same file's `const DEFAULTS` declaration when present.
 */
export function extractPluginSettings(pluginId: string): PluginSettingField[] {
  const indexPaths: string[] = [join(repoRoot, 'plugins', pluginId, 'index.ts')]
  for (const root of externalSourceRoots()) {
    indexPaths.push(join(root, pluginId, 'index.ts'))
  }
  const indexPath = indexPaths.find(p => existsSync(p))
  if (!indexPath) return []
  const source = readFileSync(indexPath, 'utf8')
  const arrayBody = extractFieldsArrayBody(source)
  if (!arrayBody) return []
  const defaults = parseDefaultsConst(source)
  const topLevelConsts = parseTopLevelStringConsts(source)
  const fields: PluginSettingField[] = []
  for (const block of splitFieldObjects(arrayBody)) {
    const key = extractFieldKV(block, 'key')
    if (!key) continue
    const type = extractFieldKV(block, 'type') ?? 'string'
    const label = extractFieldKV(block, 'label')
    const description = extractFieldKV(block, 'description')
    const rawDefault = extractFieldKV(block, 'default')
    fields.push({
      key,
      type,
      label,
      description,
      default: resolveDefault(rawDefault, defaults, topLevelConsts),
    })
  }
  return fields
}
