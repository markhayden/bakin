import { PLUGIN_ID_RE } from '@bakin/core/plugins/manifest'
import {
  readPluginLockfile,
  type PluginLockEntry,
  type PluginLockfile,
  type PluginType,
} from '@bakin/core/plugins/lockfile'

export interface PluginExportEntry {
  id: string
  source: string
  type: PluginType
  ref: string
  commitSha: string
  version?: string
  linked?: boolean
  linkedSource?: string
}

export interface PluginExportManifest {
  version: 1
  plugins: PluginExportEntry[]
}

export interface PluginImportInstallRequest {
  id: string
  source: string
  type: PluginType
  ref?: string
  dev: boolean
}

export interface PluginImportFailure {
  id: string
  source: string
  error: string
}

export interface PluginImportResult {
  ok: boolean
  installed: string[]
  failed: PluginImportFailure[]
}

export type PluginImportInstaller = (request: PluginImportInstallRequest) => Promise<void>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inferPluginType(source: string): PluginType {
  return source.startsWith('github:') || (source.includes('/') && !source.startsWith('.') && !source.startsWith('/'))
    ? 'github'
    : 'local'
}

function normalizeEntry(id: string, entry: PluginLockEntry): PluginExportEntry {
  return {
    id,
    source: entry.source,
    type: entry.type,
    ref: entry.ref,
    commitSha: entry.commitSha,
    version: entry.version,
    ...(entry.linked === true ? { linked: true } : {}),
    ...(entry.linkedSource ? { linkedSource: entry.linkedSource } : {}),
  }
}

export function createPluginExportManifest(lockfile: PluginLockfile = readPluginLockfile()): PluginExportManifest {
  return {
    version: 1,
    plugins: Object.entries(lockfile.plugins).map(([id, entry]) => normalizeEntry(id, entry)),
  }
}

export function serializePluginExportManifest(manifest: PluginExportManifest = createPluginExportManifest()): string {
  return JSON.stringify(manifest, null, 2) + '\n'
}

function fieldError(id: string, field: string, expected: string): Error {
  return new Error(`Invalid plugin export manifest entry "${id}": ${field} must be ${expected}`)
}

function parseStringField(id: string, raw: Record<string, unknown>, field: string, fallback = ''): string {
  const value = raw[field]
  if (value === undefined) return fallback
  if (typeof value !== 'string') throw fieldError(id, field, 'a string')
  return value
}

function parseBooleanField(id: string, raw: Record<string, unknown>, field: string): boolean | undefined {
  const value = raw[field]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw fieldError(id, field, 'a boolean')
  return value
}

function parsePluginType(id: string, raw: Record<string, unknown>, source: string): PluginType {
  const value = raw.type
  if (value === undefined) return inferPluginType(source)
  if (value !== 'github' && value !== 'local') throw fieldError(id, 'type', '"github" or "local"')
  return value
}

function parseEntry(idFromKey: string | undefined, raw: unknown): PluginExportEntry {
  if (!isRecord(raw)) {
    throw new Error('Invalid plugin export manifest: each plugin entry must be an object')
  }
  const rawId = raw.id
  if (idFromKey && rawId !== undefined && rawId !== idFromKey) {
    throw new Error(`Invalid plugin export manifest entry "${idFromKey}": id field must match object key`)
  }
  const id = idFromKey ?? parseStringField('<unknown>', raw, 'id')
  if (!PLUGIN_ID_RE.test(id)) {
    throw new Error(`Invalid plugin export manifest entry id "${id}" - must match ${PLUGIN_ID_RE}`)
  }
  const source = parseStringField(id, raw, 'source')
  if (source.length === 0) throw fieldError(id, 'source', 'a non-empty string')
  const type = parsePluginType(id, raw, source)
  const ref = parseStringField(id, raw, 'ref')
  const commitSha = parseStringField(id, raw, 'commitSha')
  if (commitSha && !/^[a-f0-9]{40}$/.test(commitSha)) {
    throw fieldError(id, 'commitSha', 'empty or a 40-character lowercase hex SHA')
  }
  const version = parseStringField(id, raw, 'version', '')
  const linked = parseBooleanField(id, raw, 'linked')
  const linkedSource = parseStringField(id, raw, 'linkedSource', '')
  if (linked === true && linkedSource.length === 0) {
    throw fieldError(id, 'linkedSource', 'a non-empty string when linked is true')
  }
  if (linked === true && type !== 'local') {
    throw fieldError(id, 'type', '"local" when linked is true')
  }
  if (linked !== true && linkedSource.length > 0) {
    throw fieldError(id, 'linkedSource', 'omitted unless linked is true')
  }
  return {
    id,
    source,
    type,
    ref,
    commitSha,
    ...(version ? { version } : {}),
    ...(linked === true ? { linked: true } : {}),
    ...(linkedSource ? { linkedSource } : {}),
  }
}

export function parsePluginExportManifest(raw: string): PluginExportManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Plugin export manifest is not valid JSON: ${message}`)
  }

  if (!isRecord(parsed) || parsed.version !== 1) {
    throw new Error('Invalid plugin export manifest: version must be 1')
  }

  const rawPlugins = parsed.plugins
  let plugins: PluginExportEntry[]
  if (Array.isArray(rawPlugins)) {
    plugins = rawPlugins.map(entry => parseEntry(undefined, entry))
  } else if (isRecord(rawPlugins)) {
    plugins = Object.entries(rawPlugins).map(([id, entry]) => parseEntry(id, entry))
  } else {
    throw new Error('Invalid plugin export manifest: plugins must be an array or object')
  }

  const seen = new Set<string>()
  for (const plugin of plugins) {
    if (seen.has(plugin.id)) {
      throw new Error(`Invalid plugin export manifest: duplicate plugin id "${plugin.id}"`)
    }
    seen.add(plugin.id)
  }

  return { version: 1, plugins }
}

export function toPluginImportInstallRequest(entry: PluginExportEntry): PluginImportInstallRequest {
  const dev = entry.linked === true
  return {
    id: entry.id,
    source: dev ? (entry.linkedSource ?? entry.source) : entry.source,
    type: entry.type,
    ref: entry.type === 'github' ? (entry.commitSha || entry.ref || undefined) : undefined,
    dev,
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function installPluginExportManifest(
  manifest: PluginExportManifest,
  install: PluginImportInstaller,
): Promise<PluginImportResult> {
  let pending = [...manifest.plugins]
  const installed: string[] = []
  const errors = new Map<string, string>()

  for (let pass = 0; pass < Math.max(1, manifest.plugins.length); pass++) {
    const next: PluginExportEntry[] = []
    let progress = false

    for (const entry of pending) {
      const request = toPluginImportInstallRequest(entry)
      try {
        await install(request)
        installed.push(entry.id)
        errors.delete(entry.id)
        progress = true
      } catch (err) {
        errors.set(entry.id, errorMessage(err))
        next.push(entry)
      }
    }

    if (next.length === 0) {
      return { ok: true, installed, failed: [] }
    }
    pending = next
    if (!progress) break
  }

  return {
    ok: false,
    installed,
    failed: pending.map(entry => ({
      id: entry.id,
      source: entry.source,
      error: errors.get(entry.id) ?? 'install failed',
    })),
  }
}
