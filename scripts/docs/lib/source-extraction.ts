/**
 * Docs generator — source/manifest extraction.
 *
 * Scans the source tree for `hooks.register` / `registerSlot` registrations and
 * reads core/official plugin manifests off disk. Pure data extraction over the
 * filesystem; the reference renderers and the coverage report consume these.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { externalSourceRoots, relativeSource, sourceFiles } from '../source-scan'

const repoRoot = new URL('../../..', import.meta.url).pathname

export type HookRegistrationDoc = {
  name: string
  file: string
  line: number
  label?: string
  summary?: string
  description?: string
  hookKind?: string
  visibility?: string
  stability?: string
}

export function extractHookRegistrations(): HookRegistrationDoc[] {
  const hooks: HookRegistrationDoc[] = []
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/hooks\.register\(['"`]([^'"`]+)['"`]/)
      if (match) {
        const block = lines.slice(i, Math.min(lines.length, i + 45)).join('\n')
        const label = block.match(/label:\s*(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*)\1/)?.[2]
        const summary = block.match(/summary:\s*(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*)\1/)?.[2]
        const hookKind = block.match(/hookKind:\s*['"`]([^'"`]+)['"`]/)?.[1]
        const visibility = block.match(/visibility:\s*['"`]([^'"`]+)['"`]/)?.[1]
        const stability = block.match(/stability:\s*['"`]([^'"`]+)['"`]/)?.[1]
        hooks.push({
          name: match[1],
          file: relativeSource(file),
          line: i + 1,
          label: label?.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`').trim(),
          summary: summary?.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`').trim(),
          hookKind,
          visibility,
          stability,
        })
      }
    }
  }
  return hooks.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file))
}

export function extractSlotRegistrations(): Array<{ name: string; file: string; line: number }> {
  const slots: Array<{ name: string; file: string; line: number }> = []
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const direct = lines[i].match(/registerSlot\(['"`]([^'"`]+)['"`]/)
      if (direct) slots.push({ name: direct[1], file: relativeSource(file), line: i + 1 })

      const server = lines[i].match(/slot:\s*['"`]([^'"`]+)['"`]/)
      if (server && lines.slice(Math.max(0, i - 8), i + 8).some(line => line.includes('registerSlot'))) {
        slots.push({ name: server[1], file: relativeSource(file), line: i + 1 })
      }
    }
  }
  const byKey = new Map<string, { name: string; file: string; line: number }>()
  for (const slot of slots) byKey.set(`${slot.name}:${slot.file}:${slot.line}`, slot)
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file))
}

export interface PluginManifestDoc {
  id: string
  name: string
  version: string
  description?: string
  bakin?: string
  permissions?: string[]
  dependencies?: string[]
  origin: 'Core' | 'Official'
  file: string
}

export function readPluginManifestDirectory(pluginsDir: string, origin: PluginManifestDoc['origin']): PluginManifestDoc[] {
  const manifests: PluginManifestDoc[] = []
  for (const entry of readdirSync(pluginsDir).sort()) {
    if (entry.startsWith('_')) continue
    const manifestPath = join(pluginsDir, entry, 'bakin-plugin.json')
    try {
      const raw = readFileSync(manifestPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PluginManifestDoc>
      if (!parsed.id || !parsed.name || !parsed.version) continue
      manifests.push({
        id: parsed.id,
        name: parsed.name,
        version: parsed.version,
        description: parsed.description,
        bakin: parsed.bakin,
        permissions: parsed.permissions ?? [],
        dependencies: parsed.dependencies ?? [],
        origin,
        file: relativeSource(manifestPath),
      })
    } catch {
      // Not every directory under plugins/ must be a plugin.
    }
  }
  return manifests
}

export function readCorePluginManifests(): PluginManifestDoc[] {
  return readPluginManifestDirectory(join(repoRoot, 'plugins'), 'Core')
}

export function readOfficialPluginManifests(): PluginManifestDoc[] {
  const seen = new Set<string>()
  const manifests: PluginManifestDoc[] = []
  for (const root of externalSourceRoots()) {
    for (const manifest of readPluginManifestDirectory(root, 'Official')) {
      if (seen.has(manifest.id)) continue
      seen.add(manifest.id)
      manifests.push(manifest)
    }
  }
  return manifests
}

export function readOfficialPluginCatalog(): PluginManifestDoc[] {
  return [...readCorePluginManifests(), ...readOfficialPluginManifests()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
