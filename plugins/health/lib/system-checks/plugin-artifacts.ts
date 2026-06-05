/**
 * System check — installed Whiskin plugin artifacts. Surfaces plugins whose
 * provenance no longer matches this host (needs-update after a Bakin upgrade)
 * or is invalid, so a plugin that startup skipped isn't silently missing. The
 * repair is to reinstall (fetch a compatible published artifact); never
 * auto-fixed.
 */
import { existsSync, readdirSync, type Dirent } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../../src/core/content-dir'
import { verifyInstalledArtifact } from '../../../../src/core/whiskin/verify'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

const CHECK = 'plugin-artifacts'

export function checkPluginArtifacts(): HealthCheckResult[] {
  const pluginsDir = join(getContentDir(), 'plugins')
  if (!existsSync(pluginsDir)) {
    return [{ check: CHECK, status: 'ok', message: 'No installed plugins.', autoFixable: false }]
  }

  let entries: Dirent[]
  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true }) as Dirent[]
  } catch (err) {
    return [{ check: CHECK, status: 'warn', message: `Could not read plugins dir: ${err}`, autoFixable: false }]
  }

  const problems: string[] = []
  for (const entry of entries) {
    const name = String(entry.name)
    if (!entry.isDirectory() || name.startsWith('.')) continue
    const verification = verifyInstalledArtifact(join(pluginsDir, name))
    if (verification.status === 'needs-update') {
      problems.push(`${name}: needs update (${verification.reason})`)
    } else if (verification.status === 'invalid') {
      problems.push(`${name}: invalid provenance (${verification.reason})`)
    }
  }

  if (problems.length === 0) {
    return [{ check: CHECK, status: 'ok', message: 'All installed plugin artifacts are compatible.', autoFixable: false }]
  }
  return [{
    check: CHECK,
    status: 'warn',
    message:
      `${problems.length} plugin artifact(s) inactive — reinstall to fetch a compatible build. ` +
      problems.join('; '),
    autoFixable: false,
  }]
}
