/**
 * Pi extension discovery — the adapter side of the trust lane (#670/#626).
 *
 * Discovery is INERT: it enumerates what the resource loader WOULD load
 * (top-level entries of `~/.pi/agent/extensions/` + the settings.json
 * `packages[]` installs) without ever importing extension code. Status comes
 * from the same policy + allow predicate the messaging loader applies, so
 * what this reports as `allowed` is exactly what loads into agent turns.
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { RuntimeExtensionInfo, RuntimeExtensionsAccess } from '@bakin/core/adapters/runtime'
import { getPiPath } from './home'
import { extensionAllowed, extensionsPolicy } from './messaging'

const EXTENSION_FILE_RE = /\.(ts|js|mjs|cjs)$/

function discoverDirEntries(): Array<Pick<RuntimeExtensionInfo, 'id' | 'label' | 'source' | 'path'>> {
  const dir = getPiPath('agent', 'extensions')
  if (!existsSync(dir)) return []
  const out: Array<Pick<RuntimeExtensionInfo, 'id' | 'label' | 'source' | 'path'>> = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.endsWith('.d.ts')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push({ id: entry.name, label: entry.name, source: 'extensions dir', path })
    } else if (entry.isFile() && EXTENSION_FILE_RE.test(entry.name)) {
      const id = entry.name.replace(EXTENSION_FILE_RE, '')
      out.push({ id, label: id, source: 'extensions dir', path })
    }
  }
  return out
}

function discoverPackageEntries(): Array<Pick<RuntimeExtensionInfo, 'id' | 'label' | 'source' | 'path'>> {
  const settingsPath = getPiPath('agent', 'settings.json')
  if (!existsSync(settingsPath)) return []
  let packages: unknown
  try {
    packages = (JSON.parse(readFileSync(settingsPath, 'utf-8')) as { packages?: unknown }).packages
  } catch {
    return [] // unreadable settings.json is the runtime's problem, not discovery's
  }
  if (!Array.isArray(packages)) return []
  return packages
    .filter((p): p is string => typeof p === 'string')
    .map((spec) => {
      // e.g. "npm:@scope/pkg" or "git:github.com/user/repo" — the bare name
      // is both the id and the allowlist pattern (the loader's resolved path
      // contains it under node_modules).
      const name = spec.replace(/^(npm|git):/, '')
      return { id: name, label: name, source: spec.startsWith('git:') ? `git package` : 'npm package', path: name }
    })
}

/**
 * The surface is created with the Bakin-side adapter settings getter — the
 * SAME policy source the messaging loader reads, so list() status can never
 * disagree with what actually loads.
 */
export function createExtensionsSurface(
  getSettings: () => Record<string, unknown> | undefined,
): RuntimeExtensionsAccess {
  return {
    async list(): Promise<RuntimeExtensionInfo[]> {
      const policy = extensionsPolicy(getSettings())
      const entries = [...discoverDirEntries(), ...discoverPackageEntries()]
      return entries.map((entry) => ({
        ...entry,
        status: policy.mode === 'none'
          ? 'blocked'
          : policy.mode === 'all' || extensionAllowed(entry.path, policy.allow)
            ? 'allowed'
            : 'pending',
      }))
    },
  }
}
