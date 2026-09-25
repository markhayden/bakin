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
 *   5. Deletes (under the install lock): runtime skills (honors
 *      .userEdited), settings JSON, plugin dir
 *   6. Remove lockfile entry
 *   7. Delete the binaries this plugin installed that no other owner in
 *      either lockfile still pins (spec plugin-managed-binaries S6);
 *      audit `plugin.uninstall.bins`
 */
import { existsSync, rmSync, readFileSync } from 'fs'
import { readPluginManifestJson } from '@bakin/core/plugins/manifest'
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
import { withInstallLock } from '@/core/install-core/install-lock'
import { deleteBinsWithoutOwners } from '@/core/plugins/bin-owners'

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

  const installedPlugin = pluginRegistry.getPlugin?.(pluginId)
  const manifestPath = join(pluginDir, 'bakin-plugin.json')
  if (existsSync(manifestPath)) {
    try {
      const manifest = readPluginManifestJson(readFileSync(manifestPath, 'utf8'))
      if (manifest.uninstallPreflightRequired && !installedPlugin?.beforeUninstall) {
        return Response.json({ ok: false, error: 'Activate this plugin before removing it so its persistent resources can be checked' }, { status: 409 })
      }
    } catch {
      return Response.json({ ok: false, error: 'Cannot verify plugin removal policy; repair its manifest first' }, { status: 409 })
    }
  }
  if (installedPlugin?.beforeUninstall) {
    try {
      const ctx = pluginRegistry.getPluginContext?.(pluginId)
      if (!ctx) throw new Error('Plugin must be active to verify removal safety')
      await installedPlugin.beforeUninstall(ctx)
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Plugin removal preflight failed' }, { status: 409 })
    }
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

  // ─── 5–7. Filesystem deletes, ledger, bins — one operation under the install lock ─
  let skillsResult: { removed: number; kept: number; missingFromDisk: string[] } = { removed: 0, kept: 0, missingFromDisk: [] }
  const ownedBins = lockBeforeRemove.plugins[pluginId]?.installedBins ?? []
  let binsRemoved: string[] = []
  await withInstallLock(async () => {
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

    // Ledger BEFORE the bin sweep: once the row is gone this plugin no
    // longer counts as an owner, so the zero-owner rule reads true state.
    try {
      const lock = readPluginLockfile()
      if (lock.plugins[pluginId]) {
        writePluginLockfile(removePlugin(lock, pluginId))
      }
    } catch (err) {
      log.warn('lockfile entry removal failed', err, { pluginId })
    }

    try {
      binsRemoved = deleteBinsWithoutOwners(ownedBins)
    } catch (err) {
      log.warn('bin sweep failed — binaries left in ~/.bakin/bin', err, { pluginId })
    }
  })
  const binsKept = ownedBins.map((bin) => bin.name).filter((name) => !binsRemoved.includes(name))
  if (ownedBins.length > 0) {
    appendAudit(getContentDir(), 'plugin.uninstall.bins', 'system', {
      pluginId,
      removed: binsRemoved,
      kept: binsKept,
    }, 'system')
  }

  notifyPluginRemoved(pluginId)

  log.info(`Removed plugin "${pluginId}"`, {
    pluginId,
    sweepReport,
    skillsRemoved: skillsResult.removed,
    skillsKept: skillsResult.kept,
    binsRemoved,
    binsKept,
    snapshot: snapshotPath,
  })
  appendAudit(getContentDir(), 'plugin.uninstall', 'system', {
    pluginId,
    sweepReport,
    skills: skillsResult,
    bins: { removed: binsRemoved, kept: binsKept },
    snapshot: snapshotPath,
  }, 'system')

  return Response.json({
    ok: true,
    id: pluginId,
    skills: { removed: skillsResult.removed, kept: skillsResult.kept },
    skillsMissing: skillsResult.missingFromDisk,
    bins: { removed: binsRemoved, kept: binsKept },
    sweep: sweepReport,
    snapshot: snapshotPath,
    message: `Removed "${pluginId}" and deactivated it.`,
  })
}
