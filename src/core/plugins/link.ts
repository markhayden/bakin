/**
 * Plugin link / unlink core logic (Phase 2 P2.C2).
 *
 * `bakin plugins link <localPath>` registers a developer-owned source
 * tree as if it were an installed plugin, but via a `fs.symlink` at
 * `~/.bakin/plugins/<id>/` rather than a copy. The symlink lets the
 * hot-reload coordinator (P2.C8) watch the user's working tree directly
 * without staging or sync.
 *
 * `bakin plugins unlink <id>` removes the symlink + lockfile entry. No
 * tarball backup runs — the source still lives on the user's disk.
 *
 * Both functions are pure of CLI/API concerns: the API endpoint
 * (`/api/plugins/link`) and the CLI command (`bakin plugins link`)
 * thinly forward to here, so coverage on link.test.ts exercises the
 * load-bearing logic without HTTP plumbing.
 *
 * The mutator + IO split mirrors the install flow: validation runs
 * first, then a single `addLinkedPlugin` write to the lockfile after the
 * symlink has been created and the initial build has succeeded.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, resolve, sep } from 'path'
import { createHash } from 'crypto'
import { z } from 'zod'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { appendAudit } from '@/core/audit'
import { isCorePlugin } from '@/lib/plugin-registry'
import { getSettings } from '@bakin/core/settings'
import {
  addLinkedPlugin,
  isLinked as isLinkedEntry,
  readPluginLockfile,
  removePlugin,
  writePluginLockfile,
  type PluginLockEntry,
} from '@bakin/core/plugins/lockfile'
import { parseManifestPermissions } from '@bakin/core/plugins/permissions'
import { verifyPluginManifestSignature } from '@bakin/core/plugins/signatures'
import { buildUserPlugin } from '../../../packages/host/src/plugin-host/user-plugin-builder'
import { checkPluginDependencies } from './dependencies'

const log = createLogger('plugin-link')

/** Tag for refusal errors so the API layer can map them to HTTP 400. */
export class LinkRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinkRefusedError'
  }
}

export interface LinkOptions {
  /**
   * Override id-collision refusal. Allows linking a plugin id that already
   * exists as an installed plugin or even as a core feature module. Rare
   * and opt-in — typically used to dev a fork of a core plugin.
   */
  force?: boolean
}

export interface LinkResult {
  id: string
  /** `~/.bakin/plugins/<id>/` — the path the symlink lives at. */
  pluginDir: string
  /** Resolved absolute path the symlink points to. */
  linkedSource: string
  version: string
}

export interface UnlinkResult {
  id: string
  /** The path the symlink used to point at, for the CLI's success message. */
  linkedSource: string
}

const PLUGIN_ID_REGEX = /^[a-z][a-z0-9-]{0,39}$/

/** Tightest manifest schema this code path needs — id + version mandatory. */
const LinkManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().optional(),
  dependencies: z.array(z.string().min(1)).optional(),
  permissions: z.unknown().optional(),
})

/**
 * Resolve a candidate local path to an absolute realpath and refuse
 * anything that escapes the trusted roots — same containment rule as
 * `packages/host/src/api/plugins/install.ts` so dev-mode link can't be
 * abused to point at, say, `/etc/passwd` and read arbitrary files
 * indirectly via plugin code.
 */
function resolveAndContain(localPath: string): string {
  const candidate = isAbsolute(localPath) ? localPath : resolve(process.cwd(), localPath)
  if (!existsSync(candidate)) {
    throw new LinkRefusedError(`local path does not exist: ${candidate}`)
  }
  let real: string
  try {
    real = realpathSync(candidate)
  } catch (err) {
    throw new LinkRefusedError(
      `cannot resolve local path: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const allowedRoots: string[] = []
  for (const r of [getContentDir(), homedir(), process.cwd()]) {
    try {
      allowedRoots.push(realpathSync(r))
    } catch {
      // skip a root that doesn't exist
    }
  }
  const contained = allowedRoots.some(root => real === root || real.startsWith(root + sep))
  if (!contained) {
    throw new LinkRefusedError(
      `local path is outside the permitted roots (~/.bakin/, $HOME, cwd): ${real}`,
    )
  }
  return real
}

function readManifest(dir: string): {
  id: string
  version: string
  manifestSha: string
  dependencies: string[]
  permissions: PluginLockEntry['permissions']
} {
  const manifestPath = join(dir, 'bakin-plugin.json')
  if (!existsSync(manifestPath)) {
    throw new LinkRefusedError(`source dir is missing bakin-plugin.json: ${dir}`)
  }
  const raw = readFileSync(manifestPath)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf-8'))
  } catch (err) {
    throw new LinkRefusedError(
      `bakin-plugin.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const manifestResult = LinkManifestSchema.safeParse(parsed)
  if (!manifestResult.success) {
    throw new LinkRefusedError(
      `bakin-plugin.json is missing required fields: ${manifestResult.error.message}`,
    )
  }
  const manifest = manifestResult.data
  if (!PLUGIN_ID_REGEX.test(manifest.id)) {
    throw new LinkRefusedError(
      `invalid plugin id "${manifest.id}" — must match /^[a-z][a-z0-9-]{0,39}$/`,
    )
  }
  try {
    verifyPluginManifestSignature(parsed, getSettings().plugins)
  } catch (err) {
    throw new LinkRefusedError(
      `${manifest.id}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  let permissions: PluginLockEntry['permissions']
  try {
    permissions = parseManifestPermissions(manifest.permissions)
  } catch (err) {
    throw new LinkRefusedError(
      `${manifest.id}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const manifestSha = createHash('sha256').update(raw).digest('hex')
  return {
    id: manifest.id,
    version: manifest.version && manifest.version.length > 0 ? manifest.version : '0.0.0',
    manifestSha,
    dependencies: manifest.dependencies ?? [],
    permissions,
  }
}

function auditLinkRejected(reason: string, source: string, extra: Record<string, unknown> = {}): void {
  try {
    appendAudit(getContentDir(), 'plugin.link.rejected', 'system', {
      kind: 'security',
      reason,
      source,
      ...extra,
    }, 'system')
  } catch {
    // best-effort
  }
}

/**
 * Register a local plugin source tree as a linked plugin. The plugin
 * directory at `~/.bakin/plugins/<id>/` becomes a symlink to `localPath`;
 * the hot-reload coordinator (P2.C8) consumes the lockfile entry to set
 * up file watchers.
 */
export async function linkPlugin(
  localPath: string,
  opts: LinkOptions = {},
): Promise<LinkResult> {
  const real = resolveAndContain(localPath)
  const { id, version, manifestSha, dependencies, permissions } = readManifest(real)

  // Refuse collisions with installed user plugins unless force=true.
  // `addLinkedPlugin` would also catch the dup id, but a clear pre-check
  // avoids the partial-state risk of creating a symlink first then
  // realizing the lockfile already had this id.
  const existingLock = readPluginLockfile()
  const existingEntry = existingLock.plugins[id]
  if (existingEntry && isLinkedEntry(existingEntry)) {
    auditLinkRejected('id_collision_linked', localPath, { id, linkedSource: existingEntry.linkedSource })
    throw new LinkRefusedError(
      `plugin id "${id}" is already dev-installed from ${existingEntry.linkedSource}; run \`bakin plugins unlink ${id}\` first`,
    )
  }
  if (existingEntry && opts.force !== true) {
    auditLinkRejected('id_collision_installed', localPath, { id })
    throw new LinkRefusedError(
      `plugin id "${id}" is already installed; pass --force to override or run \`bakin plugins remove ${id}\` first`,
    )
  }

  // Refuse collisions with core feature modules unless force=true. Linking
  // a plugin id of `tasks` would shadow the built-in tasks plugin after
  // restart — useful for dev forks, dangerous if accidental.
  if (isCorePlugin(id) && opts.force !== true) {
    auditLinkRejected('id_collision_core', localPath, { id })
    throw new LinkRefusedError(
      `plugin id "${id}" matches a core feature module; pass --force to intentionally shadow it`,
    )
  }

  const dependencyCheck = checkPluginDependencies({ id, dependencies })
  if (!dependencyCheck.ok) {
    auditLinkRejected('missing_dependencies', localPath, {
      id,
      missing: dependencyCheck.missing,
      self: dependencyCheck.selfDependencies,
    })
    const problems = [
      ...(dependencyCheck.missing.length > 0
        ? [`missing dependencies: ${dependencyCheck.missing.join(', ')}`]
        : []),
      ...(dependencyCheck.selfDependencies.length > 0 ? ['plugin cannot depend on itself'] : []),
    ].join('; ')
    throw new LinkRefusedError(`plugin "${id}" dependency check failed: ${problems}. Install dependencies first, then retry.`)
  }

  const pluginsRoot = join(getContentDir(), 'plugins')
  mkdirSync(pluginsRoot, { recursive: true })
  const pluginDir = join(pluginsRoot, id)

  try {
    await buildUserPlugin(real)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new LinkRefusedError(`linked source failed initial build: ${message}`)
  }

  // If a stale symlink/dir/regular file is sitting at the target, remove
  // it before symlinking. The collision check above already gated us; this
  // covers the case where the lockfile and the on-disk dir diverged.
  if (existsSync(pluginDir) || isBrokenSymlink(pluginDir)) {
    if (lstatSync(pluginDir).isSymbolicLink()) {
      unlinkSync(pluginDir)
    } else {
      rmSync(pluginDir, { recursive: true, force: true })
    }
  }

  symlinkSync(real, pluginDir, 'dir')

  const entry: PluginLockEntry = {
    source: real,
    type: 'local',
    ref: '',
    commitSha: '',
    installedAt: new Date().toISOString(),
    version,
    permissions,
    manifestSha,
    linked: true,
    linkedSource: real,
  }

  // Rewrite the lockfile from a fresh read so a concurrent link of a
  // different id doesn't get clobbered.
  writePluginLockfile(addLinkedPlugin(readPluginLockfile(), id, entry))

  log.info('linked plugin', { id, source: real })
  appendAudit(getContentDir(), 'plugin.link.created', 'system', {
    id,
    source: real,
    version,
  }, 'system')

  return { id, pluginDir, linkedSource: real, version }
}

/**
 * Test whether a path is a symlink whose target no longer exists. Plain
 * `existsSync` returns false in this case, which would skip the cleanup
 * branch above and leave the broken link in place.
 */
function isBrokenSymlink(p: string): boolean {
  try {
    const st = lstatSync(p)
    if (!st.isSymbolicLink()) return false
    return !existsSync(p) // existsSync follows the link; false = target missing
  } catch {
    return false
  }
}

/**
 * Tear down a linked plugin. Removes the symlink at
 * `~/.bakin/plugins/<id>/` and drops the lockfile entry. Refuses to act
 * on installed (non-linked) plugins — the user wants `bakin plugins
 * remove` for those (which runs the snapshot + teardown sweep).
 */
export async function unlinkPlugin(id: string): Promise<UnlinkResult> {
  const lock = readPluginLockfile()
  const entry = lock.plugins[id]
  if (!entry) {
    throw new LinkRefusedError(`plugin "${id}" is not in the lockfile`)
  }
  if (!isLinkedEntry(entry)) {
    throw new LinkRefusedError(
      `plugin "${id}" is installed (not linked); use \`bakin plugins remove ${id}\` instead`,
    )
  }

  const pluginsRoot = join(getContentDir(), 'plugins')
  const pluginDir = join(pluginsRoot, id)
  const linkedSource = entry.linkedSource ?? ''

  // Best-effort cleanup of the symlink. If it's already gone, we still
  // want the lockfile entry to vanish — keeping a stale entry would
  // confuse `bakin plugins list` on next boot.
  try {
    if (existsSync(pluginDir) || isBrokenSymlink(pluginDir)) {
      if (lstatSync(pluginDir).isSymbolicLink()) {
        unlinkSync(pluginDir)
      } else {
        // Defensive: shouldn't be a real dir if the lockfile says linked,
        // but if it is, leave it alone — refuse rather than nuke unknown
        // user data.
        throw new LinkRefusedError(
          `path at ${pluginDir} is not a symlink despite a linked lockfile entry; refusing to unlink`,
        )
      }
    }
  } catch (err) {
    if (err instanceof LinkRefusedError) throw err
    log.warn('unlink: failed to remove symlink', { id, err: String(err) })
  }

  writePluginLockfile(removePlugin(readPluginLockfile(), id))

  log.info('unlinked plugin', { id, source: linkedSource })
  appendAudit(getContentDir(), 'plugin.link.removed', 'system', {
    id,
    source: linkedSource,
  }, 'system')

  return { id, linkedSource }
}
