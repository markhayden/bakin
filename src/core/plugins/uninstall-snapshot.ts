/**
 * Pre-uninstall snapshot — captures everything Bakin will remove during
 * `bakin plugins remove` into a single tarball under
 * `~/.bakin/.uninstalled/<id>-<ISO>.tar.gz`.
 *
 * Captures only the Bakin-owned set: the plugin dir, the plugin-settings
 * JSON, and the OpenClaw skill dirs we're about to delete. Does NOT
 * capture data the plugin's own onUninstall removed — that's the plugin's
 * responsibility per the contract.
 *
 * No retention here. Tarballs accumulate. Follow-up issue tracks expiry
 * policy. Per design decision 10 (tarball is a "user-did-something-dumb"
 * safety net pre-distribution).
 *
 * Atomic write: tar to `<final>.tmp-<pid>-<ts>`, rename on success.
 * Failure leaves the tmp file for debugging and surfaces the error.
 *
 * Tarball assembled via `Bun.spawn(['tar', '-czf', ...])` — both Linux
 * and macOS ship `tar`; no new npm dep. Resolution captured in
 * .claude/specs/plugin-lifecycle-plan.md C7 OPEN QUESTION.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { join, basename } from 'path'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'

const log = createLogger('uninstall-snapshot')

export interface SnapshotInput {
  pluginId: string
  /** Absolute path to ~/.bakin/plugins/<id>/. */
  pluginDir: string
  /** Absolute path to ~/.bakin/plugin-settings/<id>.json. May not exist. */
  settingsFile?: string
  /** Absolute paths of OpenClaw skill dirs that will be removed. */
  removedSkillDirs: string[]
}

export interface SnapshotResult {
  /** Final absolute path of the tarball under ~/.bakin/.uninstalled/. */
  tarballPath: string
  /** Absolute paths of files/dirs included in the tarball. */
  capturedPaths: string[]
}

/**
 * Build the tarball. Returns the final absolute path on success. Throws
 * on any failure (the caller should surface the error and decide whether
 * to skip cleanup or push through anyway).
 *
 * Implementation: copy each captured path into a staging dir laid out as
 * the desired tarball structure, then `tar -czf` the staging dir with
 * `-C <staging>` so entries inside the tarball land at clean relative
 * paths. Doubles the IO but keeps the on-disk layout inside the tarball
 * unambiguous (much simpler than wrangling tar `-C` for renamed entries
 * across heterogeneous source paths).
 */
export async function snapshotUninstall(input: SnapshotInput): Promise<SnapshotResult> {
  const uninstalledDir = join(getContentDir(), '.uninstalled')
  mkdirSync(uninstalledDir, { recursive: true, mode: 0o700 })
  // chmod after-the-fact in case the dir already existed at a looser mode.
  try {
    chmodSync(uninstalledDir, 0o700)
  } catch {
    // best-effort
  }

  // Sweep stale .tmp-* leftovers from previous failed snapshots so they
  // don't accumulate forever in this sensitive dir.
  cleanupStaleSnapshots(uninstalledDir)

  const isoSafe = new Date().toISOString().replace(/[:.]/g, '-')
  const finalPath = join(uninstalledDir, `${input.pluginId}-${isoSafe}.tar.gz`)
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`
  // mkdtempSync gives us a randomized + atomically-created dir, defeating
  // any TOCTOU symlink race on a predictable name.
  const stagingDir = mkdtempSync(`${finalPath}.tmp-${process.pid}-`)

  const captured: string[] = []
  try {
    if (existsSync(input.pluginDir)) {
      const dest = join(stagingDir, 'plugins', basename(input.pluginDir))
      mkdirSync(join(stagingDir, 'plugins'), { recursive: true })
      cpSync(input.pluginDir, dest, { recursive: true, dereference: false })
      captured.push(input.pluginDir)
    }

    if (input.settingsFile && existsSync(input.settingsFile)) {
      const dest = join(stagingDir, 'plugin-settings', basename(input.settingsFile))
      mkdirSync(join(stagingDir, 'plugin-settings'), { recursive: true })
      cpSync(input.settingsFile, dest)
      captured.push(input.settingsFile)
    }

    for (const dir of input.removedSkillDirs) {
      if (!existsSync(dir)) continue
      const dest = join(stagingDir, 'openclaw-skills', basename(dir))
      mkdirSync(join(stagingDir, 'openclaw-skills'), { recursive: true })
      cpSync(dir, dest, { recursive: true, dereference: false })
      captured.push(dir)
    }

    if (captured.length === 0) {
      // Nothing to archive — write an empty tarball anyway so the audit
      // trail still has a marker file at the final path.
      await spawnTar(['-czf', tmpPath, '-T', '/dev/null'])
    } else {
      // Tar the staging dir contents (not the staging dir itself) so the
      // tarball has clean top-level entries: plugins/, plugin-settings/,
      // openclaw-skills/. `-C <staging>` enters the staging dir; `.` then
      // archives its contents.
      await spawnTar(['-czf', tmpPath, '-C', stagingDir, '.'])
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }

  try {
    renameSync(tmpPath, finalPath)
  } catch (err) {
    // Leave tmp for debugging — but try to surface a useful error.
    throw new Error(`snapshotUninstall: rename failed for ${tmpPath} → ${finalPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
  // Tarball may contain plugin-settings JSON with secrets — restrict to
  // the owner only. Best-effort: never throw on chmod failure.
  try {
    chmodSync(finalPath, 0o600)
  } catch {
    // best-effort
  }

  log.info('plugin uninstall snapshot written', {
    pluginId: input.pluginId,
    tarball: finalPath,
    captured: captured.length,
  })
  return { tarballPath: finalPath, capturedPaths: captured }
}

/**
 * Sweep stale `<id>-<ts>.tar.gz.tmp-*` leftovers that previous failed
 * runs left behind. Anything older than 24h goes; recent files are
 * preserved so a concurrent in-flight snapshot isn't disturbed.
 */
function cleanupStaleSnapshots(uninstalledDir: string): void {
  if (!existsSync(uninstalledDir)) return
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  let cleaned = 0
  try {
    for (const name of readdirSync(uninstalledDir)) {
      if (!name.includes('.tar.gz.tmp-')) continue
      const path = join(uninstalledDir, name)
      try {
        const st = statSync(path)
        if (st.mtimeMs < cutoff) {
          rmSync(path, { recursive: true, force: true })
          cleaned++
        }
      } catch {
        // best-effort per-entry
      }
    }
  } catch {
    // best-effort
  }
  if (cleaned > 0) {
    log.info('cleaned stale uninstall snapshots', { count: cleaned })
  }
}

async function spawnTar(args: string[]): Promise<void> {
  // Use Bun.spawn so we get a real subprocess; node's child_process would
  // also work but Bun's API is what the rest of this codebase reaches for.
  const proc = Bun.spawn(['tar', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const code = await proc.exited
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`tar exited with code ${code}: ${stderr.trim() || '(no stderr)'}`)
  }
}

