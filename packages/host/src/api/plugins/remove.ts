/**
 * POST /api/plugins/remove — remove an installed user plugin.
 *
 * Full teardown sweep (#119):
 *   1. Refuse if isCorePlugin(id)
 *   2. Call plugin.onUninstall(ctx) if defined — log + continue on error
 *   3. Snapshot Bakin-owned data into ~/.bakin/.uninstalled/<id>-<ISO>.tar.gz
 *   4. Deactivate the plugin in memory: onShutdown, hooks, exec tools,
 *      workflow nodes, notification channels, health checks, search
 *      content types, runtime skills, and registry state
 *   5. Deletes: runtime skills (honors .userEdited), settings
 *      JSON, plugin dir
 *   6. Remove lockfile entry
 */
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { appendAudit } from '@/core/audit'
import {
  isCorePlugin,
  pluginRegistry,
} from '@/core/plugin-registry'
import {
  planPluginAssetsRemoval,
  removePluginAssets,
} from '@/core/onboarding/plugin-assets'
import { snapshotUninstall } from '@/core/plugins/uninstall-snapshot'
import {
  readPluginLockfile,
  removePlugin,
  writePluginLockfile,
} from '@bakin/core/plugins/lockfile'
import { notifyPluginRemoved } from '@/core/plugins/live-lifecycle'

const log = createLogger('plugin-remove')

interface RemoveBody {
  pluginId: string
}

export async function post(req: Request, _url: URL): Promise<Response> {
  void _url
  let body: RemoveBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const pluginId = body.pluginId
  if (!pluginId || typeof pluginId !== 'string') {
    return Response.json({ ok: false, error: 'Missing pluginId' }, { status: 400 })
  }
  // Match install.ts:311 — lowercase letters, digits, hyphen only; must
  // start with a letter. Tightened in C12 to avoid case-insensitive macOS
  // collisions and exec-tool name overlap from underscores; remove was
  // missed at the time (asymmetric API contract). Now consistent.
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(pluginId)) {
    return Response.json({ ok: false, error: `Invalid pluginId "${pluginId}"` }, { status: 400 })
  }

  if (isCorePlugin(pluginId)) {
    return Response.json({
      ok: false,
      core: true,
      error: `cannot remove core plugin: ${pluginId}. Core plugins ship with Bakin and are managed via the binary itself.`,
    }, { status: 400 })
  }

  const pluginDir = join(getContentDir(), 'plugins', pluginId)
  const settingsFile = join(getContentDir(), 'plugin-settings', `${pluginId}.json`)
  const lockBeforeRemove = readPluginLockfile()

  if (!existsSync(pluginDir) && !lockBeforeRemove.plugins[pluginId]) {
    return Response.json({
      ok: false,
      error: `Plugin "${pluginId}" is not installed (no lockfile entry, no plugin dir).`,
    }, { status: 404 })
  }

  // ─── 1. onUninstall hook ───────────────────────────────────────────────────
  // Run BEFORE registry sweep so the plugin still has the full context. Errors
  // logged + audited but do not block the rest of the cleanup — a buggy
  // onUninstall must not trap the user.
  try {
    const plugin = pluginRegistry.getPlugin?.(pluginId)
    if (plugin?.onUninstall) {
      const ctx = pluginRegistry.getPluginContext?.(pluginId)
      if (ctx) {
        await plugin.onUninstall(ctx)
        log.info('plugin onUninstall complete', { pluginId })
      } else {
        log.warn('plugin defined onUninstall but no ctx available — skipping', { pluginId })
      }
    }
  } catch (err) {
    log.error('plugin onUninstall failed', err as Error, { pluginId })
    appendAudit(getContentDir(), 'plugin.uninstall.error', 'system', {
      kind: 'security',
      pluginId,
      error: err instanceof Error ? err.message : String(err),
    }, 'system')
  }

  // ─── 2. Plan runtime skill cleanup BEFORE snapshot ───────────────────────
  // We snapshot the to-remove skill content into the tarball, then actually
  // delete it. Capturing the plan first lets the snapshot include exactly
  // what the cleanup step will delete.
  //
  // Authority: the LOCKFILE entry's installedSkills allowlist, NOT the
  // on-disk `.installedBy` markers. This defeats the fake-marker
  // scorched-earth attack — a malicious plugin that wrote
  // `{pluginId: <self>}` into other plugins' .installedBy can't trick us
  // into deleting them, because the lockfile entry only records skills
  // this plugin actually installed.
  const ownedSkills = lockBeforeRemove.plugins[pluginId]?.installedSkills ?? []
  const assetsPlan = await planPluginAssetsRemoval(pluginId, ownedSkills)

  // ─── 3. Snapshot ───────────────────────────────────────────────────────────
  let snapshotPath: string | null = null
  try {
    const result = await snapshotUninstall({
      pluginId,
      pluginDir,
      settingsFile: existsSync(settingsFile) ? settingsFile : undefined,
      lockEntry: lockBeforeRemove.plugins[pluginId],
      removedSkills: assetsPlan.snapshots,
    })
    snapshotPath = result.tarballPath
  } catch (err) {
    log.error('plugin uninstall snapshot failed', err as Error, { pluginId })
    appendAudit(getContentDir(), 'plugin.uninstall.snapshot_error', 'system', {
      kind: 'security',
      pluginId,
      error: err instanceof Error ? err.message : String(err),
    }, 'system')
    // Snapshot failure is logged but we continue with cleanup — the user
    // asked for the plugin to be removed; refusing to remove it because
    // the safety-net failed would be the wrong tradeoff.
  }

  // ─── 4. Registry deactivation ─────────────────────────────────────────────
  const sweepReport = await pluginRegistry.deactivatePlugin(pluginId, {
    callShutdown: true,
    removeState: true,
  })

  // ─── 5. Filesystem deletes ─────────────────────────────────────────────────
  let skillsResult: { removed: number; kept: number; missingFromDisk: string[] } = { removed: 0, kept: 0, missingFromDisk: [] }
  try {
    const r = await removePluginAssets(pluginId, ownedSkills, assetsPlan)
    skillsResult = { removed: r.removed, kept: r.kept, missingFromDisk: r.missingFromDisk }
    if (r.missingFromDisk.length > 0) {
      log.warn('lockfile claimed ownership of skills not present on disk', {
        pluginId,
        missing: r.missingFromDisk,
      })
    }
  } catch (err) {
    log.warn('removePluginAssets failed', err, { pluginId })
  }

  if (existsSync(settingsFile)) {
    try {
      rmSync(settingsFile, { force: true })
    } catch (err) {
      log.warn('plugin-settings rm failed', err, { pluginId, settingsFile })
    }
  }

  if (existsSync(pluginDir)) {
    try {
      rmSync(pluginDir, { recursive: true, force: true })
    } catch (err) {
      log.warn('plugin dir rm failed', err, { pluginId, pluginDir })
    }
  }

  // ─── 6. Lockfile entry removal ─────────────────────────────────────────────
  try {
    const lock = readPluginLockfile()
    if (lock.plugins[pluginId]) {
      writePluginLockfile(removePlugin(lock, pluginId))
    }
  } catch (err) {
    log.warn('lockfile entry removal failed', err, { pluginId })
  }

  notifyPluginRemoved(pluginId)

  log.info(`Removed plugin "${pluginId}"`, {
    pluginId,
    sweepReport,
    skillsRemoved: skillsResult.removed,
    skillsKept: skillsResult.kept,
    snapshot: snapshotPath,
  })
  appendAudit(getContentDir(), 'plugin.uninstall', 'system', {
    pluginId,
    sweepReport,
    skills: skillsResult,
    snapshot: snapshotPath,
  }, 'system')

  return Response.json({
    ok: true,
    id: pluginId,
    skills: { removed: skillsResult.removed, kept: skillsResult.kept },
    skillsMissing: skillsResult.missingFromDisk,
    sweep: sweepReport,
    snapshot: snapshotPath,
    message: `Removed "${pluginId}" and deactivated it.`,
  })
}
