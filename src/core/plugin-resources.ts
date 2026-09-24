/**
 * Plugin-shipped resource resolver — the ONE way server code locates a
 * plugin's `defaults/**` files (shipped workflows, workflow-skills,
 * runtime-skills).
 *
 * Why this exists: inside a `bun build --compile` binary every module's
 * `import.meta.url` points at a virtual `/$bunfs/...` path, so
 * `join(moduleDir, 'defaults', 'workflows')` never exists and loaders that
 * bail on a missing directory come up EMPTY — silently. Compiled installs ran
 * for months with zero shipped workflows, zero workflow-step skills and no
 * installable runtime skills before anyone noticed (2026-09-24).
 *
 * Resolution is a two-way switch, decided per plugin root:
 *   - the plugin root exists on disk (source checkouts, user plugins under
 *     ~/.bakin/plugins) → read the real `defaults/<kind>/` directory;
 *   - it does not (compiled binary) → read the copies the build embedded
 *     under `plugin-defaults:<id>/<kind>/<relPath>` keys in the embedded
 *     asset map (scripts/generate-embedded-assets.ts walks every core
 *     plugin's `defaults/` at build time).
 *
 * The embedded keys deliberately carry no leading slash: the static HTTP
 * handler looks assets up by `url.pathname`, so a key that can never equal a
 * pathname can never be served. Embedded values are `/$bunfs/...` file paths
 * that `readFileSync` / `existsSync` / `statSync` read normally — only
 * directory listing is unavailable, which is exactly what the manifest
 * replaces.
 */
import { existsSync, statSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { walkFiles } from '../../packages/core/src/storage/walk'
import { EMBEDDED_ASSETS } from '../../packages/host/src/api/_embedded-assets'

/** Embedded-map key prefix for plugin defaults. NOT a URL path — see header. */
export const PLUGIN_DEFAULTS_KEY_PREFIX = 'plugin-defaults:'

/** True when this module runs from inside a compiled single-file binary. */
export const RUNNING_FROM_BINARY = import.meta.url.startsWith('file:///$bunfs/')

/**
 * Repo root for resolving the RELATIVE plugin paths bakin.config.ts uses
 * (`plugins/<id>`). Null inside the binary — there is no checkout to resolve
 * against, and `process.cwd()` is whatever the daemon happened to start in.
 */
const REPO_ROOT: string | null = RUNNING_FROM_BINARY ? null : resolve(import.meta.dir, '..', '..')

export type PluginResourceSource = 'disk' | 'embedded'

export interface PluginResourceFile {
  /** Path relative to `defaults/<kind>/`, '/'-joined (e.g. `create-image/SKILL.md`). */
  relPath: string
  /** Readable file path — on disk, or a `/$bunfs/...` embedded path. */
  path: string
  source: PluginResourceSource
}

export interface PluginDefaultsQuery {
  pluginId: string
  /** Plugin root: absolute, or relative to the repo root (`plugins/<id>`). Optional for embedded-only lookups. */
  pluginPath?: string
  /** Subdirectory under `defaults/` — `workflows`, `workflow-skills`, `runtime-skills`. */
  kind: string
}

export function pluginDefaultsKey(pluginId: string, relPath: string): string {
  return `${PLUGIN_DEFAULTS_KEY_PREFIX}${pluginId}/${relPath}`
}

/**
 * Absolute plugin root for a bakin.config-style path. Relative paths resolve
 * against the repo root, never `process.cwd()`. Returns null when there is no
 * checkout to resolve a relative path against (compiled binary).
 */
export function resolvePluginRoot(pluginPath: string): string | null {
  if (isAbsolute(pluginPath)) return pluginPath
  if (REPO_ROOT === null) return null
  return join(REPO_ROOT, pluginPath)
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

function byRelPath(a: PluginResourceFile, b: PluginResourceFile): number {
  return a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0
}

/**
 * Which source a plugin's defaults resolve from. `disk` whenever the plugin
 * root exists on disk (even if it ships no `defaults/` at all — a source
 * checkout is authoritative about what it ships); `embedded` otherwise.
 */
export function pluginDefaultsSource(pluginPath: string | undefined): PluginResourceSource {
  if (!pluginPath) return 'embedded'
  const root = resolvePluginRoot(pluginPath)
  return root !== null && isDirectory(root) ? 'disk' : 'embedded'
}

function listEmbedded(pluginId: string, kind: string): PluginResourceFile[] {
  const prefix = `${pluginDefaultsKey(pluginId, kind)}/`
  const out: PluginResourceFile[] = []
  for (const key of EMBEDDED_ASSETS.keys()) {
    if (!key.startsWith(prefix)) continue
    const path = EMBEDDED_ASSETS.get(key)
    if (!path) continue
    out.push({ relPath: key.slice(prefix.length), path, source: 'embedded' })
  }
  return out.sort(byRelPath)
}

function listDisk(root: string, kind: string): PluginResourceFile[] {
  const dir = join(root, 'defaults', kind)
  if (!isDirectory(dir)) return []
  const out: PluginResourceFile[] = []
  for (const file of walkFiles(dir)) {
    if (file.name.endsWith('.map')) continue
    out.push({ relPath: file.relPath, path: file.path, source: 'disk' })
  }
  return out.sort(byRelPath)
}

/** Every file under a plugin's `defaults/<kind>/`, wherever this process can read it from. */
export function listPluginDefaultFiles(query: PluginDefaultsQuery): PluginResourceFile[] {
  if (pluginDefaultsSource(query.pluginPath) === 'disk') {
    return listDisk(resolvePluginRoot(query.pluginPath as string) as string, query.kind)
  }
  return listEmbedded(query.pluginId, query.kind)
}

/** Files under `defaults/<kind>/` whose name has one of `extensions` (e.g. `['.yaml', '.yml']`). */
export function listPluginDefaultFilesWithExtension(
  query: PluginDefaultsQuery,
  extensions: readonly string[],
): PluginResourceFile[] {
  return listPluginDefaultFiles(query).filter(file => extensions.some(ext => file.relPath.endsWith(ext)))
}

export interface PluginDefaultsReport {
  source: PluginResourceSource
  /** Absolute `defaults/` directory when resolving from disk (whether or not it exists). */
  diskDefaultsDir: string | null
  /** Embedded entries this build carries for the plugin (all kinds). */
  embeddedCount: number
}

/** Diagnostic view for health checks: where a plugin's defaults come from and what the build carries. */
export function describePluginDefaults(pluginId: string, pluginPath?: string): PluginDefaultsReport {
  const source = pluginDefaultsSource(pluginPath)
  const root = pluginPath ? resolvePluginRoot(pluginPath) : null
  const prefix = `${PLUGIN_DEFAULTS_KEY_PREFIX}${pluginId}/`
  let embeddedCount = 0
  for (const key of EMBEDDED_ASSETS.keys()) if (key.startsWith(prefix)) embeddedCount++
  return {
    source,
    diskDefaultsDir: source === 'disk' && root ? join(root, 'defaults') : null,
    embeddedCount,
  }
}

/**
 * A plugin module's own directory, for plugins that resolve their defaults
 * from `import.meta.url`. Real on source checkouts; `/$bunfs/...` inside the
 * binary, where `pluginDefaultsSource` correctly reports `embedded`.
 */
export function pluginRootFromModuleUrl(moduleUrl: string): string {
  return dirname(fileURLToPath(moduleUrl))
}

export interface ShippedWorkflowFile {
  /** Definition id — the YAML filename without extension. */
  id: string
  path: string
  source: PluginResourceSource
}

/** The plugin's shipped workflow YAML files (`defaults/workflows/*.yaml|yml`), top level only. */
export function shippedWorkflowFiles(pluginId: string, pluginPath?: string): ShippedWorkflowFile[] {
  return listPluginDefaultFilesWithExtension({ pluginId, pluginPath, kind: 'workflows' }, ['.yaml', '.yml'])
    .filter(file => !file.relPath.includes('/'))
    .map(file => ({ id: file.relPath.replace(/\.(yaml|yml)$/, ''), path: file.path, source: file.source }))
}
