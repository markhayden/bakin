/**
 * Plugin upgrade orchestration (commit C4).
 *
 * `upgradePlugin(id, opts)` re-pulls a user plugin from its recorded source
 * (github fast-forward or local re-cpSync), rebuilds it via buildUserPlugin,
 * and updates the lockfile entry. No-op detection short-circuits when there
 * are no changes to apply.
 *
 * Consent for permission widening is detected here but the prompt itself
 * lands in C9 — for now, callers receive `awaitingConsent: true` with the
 * diff and decide what to do (CLI surfaces a placeholder; --yes overrides).
 *
 * Hot reload is out of scope (decision 13). On success, the caller is
 * expected to surface the spec'd "Restart Bakin to activate the change"
 * message.
 */
import { existsSync, readFileSync, readdirSync, statSync, cpSync, rmSync } from 'fs'
import { join, relative } from 'path'
import { execFileSync, type ExecFileSyncOptions } from 'child_process'
import { createHash } from 'crypto'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { isCorePlugin } from '@/lib/plugin-registry'
import {
  type PluginLockEntry,
  readPluginLockfile,
  updatePlugin,
  writePluginLockfile,
} from '@bakin/core/plugins/lockfile'
import { buildUserPlugin } from '../../../packages/host/src/plugin-host/user-plugin-builder'

const log = createLogger('plugin-upgrade')

export interface UpgradeOptions {
  /** Skip consent prompt even when permissions widen. */
  yes?: boolean
}

export interface UpgradeResult {
  id: string
  before: { version: string; commitSha: string }
  after: { version: string; commitSha: string }
  /** True when nothing changed and no rebuild ran. */
  noop: boolean
  /** Permissions present in the new manifest that weren't in the lockfile entry. */
  newPermissions: string[]
  /**
   * True when the new manifest declares permissions not present in the
   * lockfile entry AND the caller did not pass `--yes`. Caller is expected
   * to surface a consent prompt (C9) and re-invoke with `yes: true` once
   * the user accepts.
   */
  awaitingConsent: boolean
}

/** Tag for refusal errors so the API layer can map them to HTTP 400. */
export class UpgradeRefusedError extends Error {}

/**
 * Run an external command and return stdout. Wraps execFileSync so the
 * caller doesn't have to repeat the `stdio` boilerplate.
 */
function run(cmd: string, args: string[], cwd: string): string {
  const opts: ExecFileSyncOptions = {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }
  return execFileSync(cmd, args, opts).toString().trim()
}

/**
 * Hash a directory's path+content tree (skipping node_modules / dist / .git).
 * Path-and-content only — mtimes intentionally excluded so the hash is
 * stable across copies of the same source. Captured as decision in
 * .claude/specs/plugin-lifecycle-plan.md C4 OPEN QUESTION.
 */
export function computeSourceTreeSha(rootDir: string): string {
  const SKIP = new Set(['node_modules', 'dist', '.git'])
  const files: Array<{ rel: string; data: Buffer }> = []
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        const data = readFileSync(full)
        files.push({ rel: relative(rootDir, full), data })
      }
    }
  }
  if (statSync(rootDir).isDirectory()) walk(rootDir)
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const hash = createHash('sha256')
  for (const f of files) {
    hash.update(f.rel)
    hash.update('\0')
    hash.update(f.data)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function readManifest(pluginDir: string): { manifest: Record<string, unknown>; manifestSha: string } {
  const path = join(pluginDir, 'bakin-plugin.json')
  if (!existsSync(path)) {
    throw new Error(`Plugin source missing bakin-plugin.json at ${path}`)
  }
  const raw = readFileSync(path)
  const manifest = JSON.parse(raw.toString('utf-8'))
  const manifestSha = createHash('sha256').update(raw).digest('hex')
  return { manifest, manifestSha }
}

function manifestPermissions(manifest: Record<string, unknown>): string[] {
  return Array.isArray(manifest.permissions)
    ? manifest.permissions.filter((p): p is string => typeof p === 'string')
    : []
}

function manifestVersion(manifest: Record<string, unknown>, fallback: string): string {
  if (typeof manifest.version === 'string' && manifest.version.length > 0) {
    return manifest.version
  }
  log.warn('plugin manifest missing version on upgrade; keeping previous', { fallback })
  return fallback
}

/** Permissions present in `next` that weren't in `prev` — used for consent diff. */
function diffNewPermissions(prev: string[], next: string[]): string[] {
  const prevSet = new Set(prev)
  return next.filter(p => !prevSet.has(p))
}

/**
 * Fast-forward `<plugin-dir>` to the remote head of `ref`. Throws an
 * UpgradeRefusedError with the spec's exact message when the local commit
 * is not an ancestor of the remote (force-push or rewrite scenario).
 */
function gitFetchAndFastForward(
  pluginDir: string,
  id: string,
  ref: string,
): { from: string; to: string } {
  run('git', ['fetch', 'origin', ref], pluginDir)
  const from = run('git', ['rev-parse', 'HEAD'], pluginDir)
  const to = run('git', ['rev-parse', `origin/${ref}`], pluginDir)
  if (from === to) return { from, to }
  // Is the local HEAD an ancestor of the remote? If not, history was
  // rewritten — refuse loudly rather than silently hard-resetting.
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', from, to], {
      cwd: pluginDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    throw new UpgradeRefusedError(
      `${id}: cannot fast-forward (remote history rewritten?). Remove and reinstall.`,
    )
  }
  run('git', ['merge', '--ff-only', `origin/${ref}`], pluginDir)
  return { from, to }
}

/**
 * Upgrade an installed user plugin in-place. Returns a structured result so
 * callers (CLI, API endpoint) can render the right message and decide
 * whether to re-prompt for permission consent.
 */
export async function upgradePlugin(
  id: string,
  opts: UpgradeOptions = {},
): Promise<UpgradeResult> {
  if (isCorePlugin(id)) {
    throw new UpgradeRefusedError(
      `cannot upgrade core plugin: ${id}. Core plugins ship with Bakin and are managed via the binary itself.`,
    )
  }

  const lock = readPluginLockfile()
  const entry = lock.plugins[id]
  if (!entry) {
    throw new UpgradeRefusedError(
      `plugin "${id}" is not installed (no lockfile entry). Install it first with: bakin plugins install <source>`,
    )
  }

  const pluginsRoot = join(getContentDir(), 'plugins')
  const pluginDir = join(pluginsRoot, id)
  if (!existsSync(pluginDir)) {
    throw new UpgradeRefusedError(
      `plugin "${id}" lockfile entry exists but ~/.bakin/plugins/${id}/ is missing. Reinstall.`,
    )
  }

  const before = { version: entry.version, commitSha: entry.commitSha }

  if (entry.type === 'github') {
    return upgradeGithub(id, entry, pluginDir, opts, before)
  }
  return upgradeLocal(id, entry, pluginDir, opts, before)
}

async function upgradeGithub(
  id: string,
  entry: PluginLockEntry,
  pluginDir: string,
  opts: UpgradeOptions,
  before: { version: string; commitSha: string },
): Promise<UpgradeResult> {
  if (!entry.ref) {
    throw new UpgradeRefusedError(
      `${id}: lockfile is missing the git ref. Reinstall.`,
    )
  }
  const { from, to } = gitFetchAndFastForward(pluginDir, id, entry.ref)
  if (from === to) {
    return {
      id,
      before,
      after: before,
      noop: true,
      newPermissions: [],
      awaitingConsent: false,
    }
  }

  const { manifest, manifestSha } = readManifest(pluginDir)
  const newVersion = manifestVersion(manifest, entry.version)
  const newPerms = manifestPermissions(manifest)
  const widened = diffNewPermissions(entry.permissions, newPerms)

  if (widened.length > 0 && !opts.yes) {
    return {
      id,
      before,
      after: { version: newVersion, commitSha: to },
      noop: false,
      newPermissions: widened,
      awaitingConsent: true,
    }
  }

  await buildUserPlugin(pluginDir)

  const updated = updatePlugin(readPluginLockfile(), id, {
    upgradedAt: new Date().toISOString(),
    version: newVersion,
    commitSha: to,
    manifestSha,
    permissions: newPerms,
  })
  writePluginLockfile(updated)

  return {
    id,
    before,
    after: { version: newVersion, commitSha: to },
    noop: false,
    newPermissions: widened,
    awaitingConsent: false,
  }
}

async function upgradeLocal(
  id: string,
  entry: PluginLockEntry,
  pluginDir: string,
  opts: UpgradeOptions,
  before: { version: string; commitSha: string },
): Promise<UpgradeResult> {
  const sourcePath = entry.source
  if (!existsSync(sourcePath)) {
    throw new UpgradeRefusedError(
      `Original source path ${sourcePath} no longer exists. Reinstall with: bakin plugins install <new-path>`,
    )
  }

  const newTreeSha = computeSourceTreeSha(sourcePath)
  if (entry.sourceTreeSha && entry.sourceTreeSha === newTreeSha) {
    return {
      id,
      before,
      after: before,
      noop: true,
      newPermissions: [],
      awaitingConsent: false,
    }
  }

  // Re-copy source over plugin dir. Wipe first so deletions in the source
  // are reflected (plain cpSync would only overlay, leaving stale files).
  rmSync(pluginDir, { recursive: true, force: true })
  cpSync(sourcePath, pluginDir, { recursive: true, dereference: false })

  const { manifest, manifestSha } = readManifest(pluginDir)
  const newVersion = manifestVersion(manifest, entry.version)
  const newPerms = manifestPermissions(manifest)
  const widened = diffNewPermissions(entry.permissions, newPerms)

  if (widened.length > 0 && !opts.yes) {
    return {
      id,
      before,
      after: { version: newVersion, commitSha: '' },
      noop: false,
      newPermissions: widened,
      awaitingConsent: true,
    }
  }

  await buildUserPlugin(pluginDir)

  const updated = updatePlugin(readPluginLockfile(), id, {
    upgradedAt: new Date().toISOString(),
    version: newVersion,
    manifestSha,
    permissions: newPerms,
    sourceTreeSha: newTreeSha,
  })
  writePluginLockfile(updated)

  return {
    id,
    before,
    after: { version: newVersion, commitSha: '' },
    noop: false,
    newPermissions: widened,
    awaitingConsent: false,
  }
}
