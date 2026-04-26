/**
 * POST /api/plugins/remove — remove an installed user plugin.
 *
 * Full teardown sweep (#119):
 *   1. Refuse if isCorePlugin(id)
 *   2. Call plugin.onUninstall(ctx) if defined — log + continue on error
 *   3. Snapshot Bakin-owned data into ~/.bakin/.uninstalled/<id>-<ISO>.tar.gz
 *   4. Sweep registries: hooks, exec tools, workflow nodes, notification
 *      channels, health checks, search content types
 *   5. Filesystem deletes: OpenClaw skills (honors .userEdited), settings
 *      JSON, plugin dir
 *   6. Remove lockfile entry
 *
 * A Bakin restart is still required for the plugin's modules to be
 * released from the JS module cache; the registry sweep ensures no new
 * invocations land while the in-memory state is being torn down.
 */
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { appendAudit } from '@/core/audit'
import {
  getHookRegistry,
  isCorePlugin,
  pluginRegistry,
} from '@/lib/plugin-registry'
import { removeExecToolsByPlugin } from '../../../../../scripts/lib/registry'
import { unregisterPluginNodeTypes } from '../../../../../plugins/workflows/lib/node-type-registry'
import { unregisterPluginNotificationChannels } from '../../../../../plugins/workflows/lib/notification-channel-registry'
import { unregisterPluginHealthChecks } from '../../../../../plugins/health/lib/health-check-registry'
import {
  getContentTypes,
  purgeContentType,
} from '@/core/search-registry'
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

const log = createLogger('plugin-remove')

interface RemoveBody {
  pluginId: string
}

export async function post(req: Request, _url: URL): Promise<Response> {
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
  if (!/^[a-z0-9][a-z0-9-_]{0,39}$/i.test(pluginId)) {
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

  if (!existsSync(pluginDir) && !readPluginLockfile().plugins[pluginId]) {
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
      pluginId,
      error: err instanceof Error ? err.message : String(err),
    }, 'system')
  }

  // ─── 2. Plan OpenClaw skill cleanup BEFORE snapshot ──────────────────────
  // We snapshot the to-remove skill dirs into the tarball, then actually
  // delete them. Capturing the plan first lets the snapshot include the
  // exact paths the cleanup step will delete.
  //
  // Authority: the LOCKFILE entry's installedSkills allowlist, NOT the
  // on-disk `.installedBy` markers. This defeats the fake-marker
  // scorched-earth attack — a malicious plugin that wrote
  // `{pluginId: <self>}` into other plugins' .installedBy can't trick us
  // into deleting them, because the lockfile entry only records skills
  // this plugin actually installed.
  const ownedSkills = readPluginLockfile().plugins[pluginId]?.installedSkills ?? []
  const assetsPlan = planPluginAssetsRemoval(pluginId, ownedSkills)

  // ─── 3. Snapshot ───────────────────────────────────────────────────────────
  let snapshotPath: string | null = null
  try {
    const result = await snapshotUninstall({
      pluginId,
      pluginDir,
      settingsFile: existsSync(settingsFile) ? settingsFile : undefined,
      removedSkillDirs: assetsPlan.toRemove,
    })
    snapshotPath = result.tarballPath
  } catch (err) {
    log.error('plugin uninstall snapshot failed', err as Error, { pluginId })
    appendAudit(getContentDir(), 'plugin.uninstall.snapshot_error', 'system', {
      pluginId,
      error: err instanceof Error ? err.message : String(err),
    }, 'system')
    // Snapshot failure is logged but we continue with cleanup — the user
    // asked for the plugin to be removed; refusing to remove it because
    // the safety-net failed would be the wrong tradeoff.
  }

  // ─── 4. Registry sweep ─────────────────────────────────────────────────────
  const sweepReport = {
    hooks: 0,
    execTools: 0,
    contentTypes: 0,
  }
  try {
    sweepReport.hooks = getHookRegistry().unregisterByPlugin(pluginId)
  } catch (err) {
    log.warn('hook unregisterByPlugin failed', err, { pluginId })
  }
  try {
    sweepReport.execTools = removeExecToolsByPlugin(pluginId)
  } catch (err) {
    log.warn('removeExecToolsByPlugin failed', err, { pluginId })
  }
  try {
    unregisterPluginNodeTypes(pluginId)
  } catch (err) {
    log.warn('unregisterPluginNodeTypes failed', err, { pluginId })
  }
  try {
    unregisterPluginNotificationChannels(pluginId)
  } catch (err) {
    log.warn('unregisterPluginNotificationChannels failed', err, { pluginId })
  }
  try {
    unregisterPluginHealthChecks(pluginId)
  } catch (err) {
    log.warn('unregisterPluginHealthChecks failed', err, { pluginId })
  }
  // Purge every content type the plugin owned. Iterate a snapshot of the
  // map so we don't mutate while iterating.
  const ownedTables = [...getContentTypes().entries()]
    .filter(([, def]) => def.pluginId === pluginId)
    .map(([table]) => table)
  for (const table of ownedTables) {
    try {
      await purgeContentType(table)
      sweepReport.contentTypes++
    } catch (err) {
      log.warn('purgeContentType failed', err, { pluginId, table })
    }
  }

  // ─── 5. Filesystem deletes ─────────────────────────────────────────────────
  let skillsResult = { removed: 0, kept: 0 }
  try {
    const r = await removePluginAssets(pluginId, ownedSkills)
    skillsResult = { removed: r.removed, kept: r.kept }
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

  // Drop the in-memory plugin state too — same shape `loadUserPlugins`
  // does on override. Best-effort; the next restart re-bootstraps anyway.
  try {
    pluginRegistry.deletePlugin?.(pluginId)
  } catch {
    /* best-effort */
  }

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
    skills: skillsResult,
    sweep: sweepReport,
    snapshot: snapshotPath,
    message: `Removed "${pluginId}". Restart Bakin to fully release the plugin's modules.`,
  })
}
