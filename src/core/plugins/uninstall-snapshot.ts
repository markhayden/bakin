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
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs'
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
  mkdirSync(uninstalledDir, { recursive: true })

  const isoSafe = new Date().toISOString().replace(/[:.]/g, '-')
  const finalPath = join(uninstalledDir, `${input.pluginId}-${isoSafe}.tar.gz`)
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`
  const stagingDir = `${tmpPath}.staging`

  const captured: string[] = []
  mkdirSync(stagingDir, { recursive: true })
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

  log.info('plugin uninstall snapshot written', {
    pluginId: input.pluginId,
    tarball: finalPath,
    captured: captured.length,
  })
  return { tarballPath: finalPath, capturedPaths: captured }
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

/**
 * Best-effort cleanup of a stale tmp file from a previous failed snapshot.
 * Used by tests and by the remove flow to wipe leftovers between attempts.
 */
export function cleanupStaleSnapshotTmp(path: string): void {
  try {
    if (existsSync(path)) rmSync(path, { force: true })
  } catch {
    // best-effort
  }
}
