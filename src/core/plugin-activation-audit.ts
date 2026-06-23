/**
 * Plugin activation audit (#142 layer 1).
 *
 * Extracted from plugin-registry.ts. On every plugin activation, log the
 * plugin's requested permissions to ~/.bakin/audit.jsonl AND an info-level
 * log line, so `jq 'select(.event=="plugin.activate")'` over the audit trail
 * shows the full surface the user authorized.
 *
 * Permission-read failures are tolerated (records empty permissions) —
 * install/upgrade already validate; a malformed manifest at boot shouldn't
 * block the server.
 */
import { existsSync, readFileSync } from 'fs'

import type { BakinPlugin } from '@bakin/core/plugin-types'
import type { PluginManifest as PublicPluginManifest } from '@makinbakin/sdk/types'

import { parseManifestPermissions } from '../../packages/core/src/plugins/permissions'
import { readPluginLockfile } from '../../packages/core/src/plugins/lockfile'
import { getContentDir } from './content-dir'
import { createLogger } from './logger'
import { appendAudit } from './audit'

const log = createLogger('plugin-registry')

export function logPluginActivation(args: {
  plugin: BakinPlugin
  source: 'core' | 'user'
  manifestPath?: string
  manifest?: PublicPluginManifest
}): void {
  const { plugin, source, manifestPath, manifest: embeddedManifest } = args
  let permissions: string[] = []
  let resolvedSource: 'core' | 'github' | 'local' = source === 'core' ? 'core' : 'local'

  if (embeddedManifest) {
    permissions = parseManifestPermissions(embeddedManifest.permissions)
  } else if (manifestPath && existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
      permissions = parseManifestPermissions(manifest.permissions)
    } catch {
      // Already validated at install/upgrade — silently keep permissions empty.
    }
  }

  if (source === 'user') {
    try {
      const entry = readPluginLockfile().plugins[plugin.id]
      if (entry?.type === 'github') resolvedSource = 'github'
      else if (entry?.type === 'local') resolvedSource = 'local'
    } catch {
      // lockfile read failure — leave as 'local'
    }
  }

  log.info('plugin activated', {
    pluginId: plugin.id,
    version: plugin.version,
    permissions,
    source: resolvedSource,
  })
  appendAudit(getContentDir(), 'plugin.activate', 'system', {
    pluginId: plugin.id,
    version: plugin.version,
    permissions,
    source: resolvedSource,
  }, 'system')
}
