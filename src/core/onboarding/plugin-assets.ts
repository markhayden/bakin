/**
 * plugin-assets onboarding component (S-B in the workflows-plugin spec).
 *
 * Plugins ship runtime skill packages at
 * `defaults/runtime-skills/{name}/SKILL.md` (+ optional `scripts/`,
 * other sibling files). This component installs them through the configured
 * runtime adapter so agents can invoke them.
 *
 * Workflow-step skills (S-A in the spec) are handled in-memory by the
 * plugin-skill-loader (`src/lib/plugin-skill-loader.ts`) — they never
 * touch this path.
 *
 * Drift detection (#898 — verify, never trust a self-asserted file):
 *   - The installed skill's files are compared with the files the plugin
 *     ships (`skillVerdict`, the ONE predicate behind scan AND install).
 *     The `.installedBy` marker records ownership for uninstall; it is
 *     never evidence the content is current.
 *   - `.userEdited` sentinel (empty file the user creates) blocks
 *     overwrite forever — install() skips and reports. A locked skill is
 *     still compared: locked-and-drifted is a warning, never ok.
 *
 * Binaries (spec plugin-managed-binaries §2.7): a plugin manifest's
 * `requires.bins` are scanned with the installer's own verification
 * predicate (`bin-verify.ts`) — installed / drifted / missing — and
 * reinstalled through the shared plugin-bin installer under the install
 * lock. The lockfile's `installedBins` is synced with what landed.
 *
 * Idempotent: re-running install() on identical sources is a noop.
 */
import { createHash } from 'crypto'
import {
  existsSync,
  readFileSync,
} from 'fs'
import { join } from 'path'
import { listPluginDefaultFiles, type PluginResourceFile } from '../plugin-resources'
import { createAppServices, getAppServices, maybeGetAppServices } from '../app-services'
import { createLogger } from '../logger'
import { binPlatformKey, installPluginBins, toInstalledBins } from '../agent-packages/bin-installer'
import { verifyInstalledBin } from '../agent-packages/bin-verify'
import { binTargetPath } from '../plugins/bin-owners'
import type { RuntimeSkill } from '@bakin/core/adapters/runtime'
import type { OperationContext, OperationPlan } from '@bakin/core/operations'
import { type BinRequirement } from '@bakin/core/plugins/bin-requirement'
import { readPluginManifestJson } from '@bakin/core/plugins/manifest'
import {
  type PluginLockfile,
  isLinked,
  readPluginLockfile,
  updatePlugin,
  writePluginLockfile,
} from '../../../packages/core/src/plugins/lockfile'
import { isLoadableUserPluginDir } from '../plugins/install-recovery'
import type { CheckResult, ComponentInstallOptions, InstallableComponent, InstallResult } from './types'

const log = createLogger('onboarding:plugin-assets')

export interface PluginEntry {
  id: string
  path: string
}

export interface SkillRef {
  pluginId: string
  name: string
}

export interface SkillRefSkipped extends SkillRef {
  reason: 'userEdited'
}

export interface BinRef {
  pluginId: string
  name: string
}

export interface BinScanReport {
  /** Declared binaries across all plugins (this platform or not). */
  total: number
  installed: BinRef[]
  missing: BinRef[]
  drifted: BinRef[]
  /** Declared but with no download for this platform — cannot be repaired here. */
  unsupported: BinRef[]
  /**
   * Plugins whose `requires.bins` no longer validates (e.g. an archive bin
   * without `extractedSha256`) — nothing can be verified or installed for
   * them until the plugin is upgraded. Visible, never "no bins" (#898 D).
   */
  invalid: Array<{ pluginId: string; reason: string }>
}

export interface BinInstallReport {
  installed: BinRef[]
  unchanged: BinRef[]
  /** Per-plugin install failures (pin conflict, download, checksum) — the repair fails loudly. */
  failed: Array<BinRef & { error: string }>
  /** Plugins whose `requires.bins` does not validate — nothing was installed for them; the fix is a plugin upgrade (#898 D). */
  invalid: Array<{ pluginId: string; reason: string }>
}

export interface ScanReport {
  /** Runtime skills shipped by plugins. */
  totalAvailable: number
  missing: SkillRef[]
  drifted: SkillRef[]
  installed: SkillRef[]
  /** Locked by `.userEdited` (overwrite blocked), content matching or not. */
  userEdited: SkillRef[]
  /** The locked skills whose content differs from what the plugin ships. */
  userEditedDrifted: SkillRef[]
  /** Skills whose plugin source is not UTF-8 text — the runtime skill contract is text, so they are never installed. */
  invalidSource: Array<SkillRef & { error: string }>
  bins: BinScanReport
}

export interface InstallReport {
  installed: SkillRef[]
  unchanged: SkillRef[]
  skipped: SkillRefSkipped[]
  /** User-edited skills the caller explicitly asked to restore: their edit was released, the shipped copy written. */
  restored: string[]
  /** Skills that could not be laid down verified (non-text source, or still differing after a full rewrite). */
  failed: Array<SkillRef & { error: string }>
  bins: BinInstallReport
}

interface InstalledMarker {
  pluginId: string
  sha256: string
}

function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export interface PluginSkillSource {
  name: string
  /** Readable path of the skill's `SKILL.md` (disk or embedded). */
  skillMdPath: string
  /** Every file in the skill directory, `relPath` relative to that directory. */
  files: PluginResourceFile[]
}

/**
 * One entry per `defaults/runtime-skills/<name>/` that has a `SKILL.md`.
 * Skills are 1 directory deep. Resolved through plugin-resources, so a
 * compiled binary (no plugin directory on disk) sees the embedded copies
 * a source checkout reads from disk.
 *
 * Exported so install + upgrade flows can record `installedSkills` into
 * the lockfile (#119 hardening) — the lockfile becomes the canonical
 * record of which skills each plugin installed, so the uninstall flow
 * doesn't have to trust on-disk `.installedBy` markers blindly.
 */
export function findSkillsForPlugin(plugin: PluginEntry): PluginSkillSource[] {
  const groups = new Map<string, PluginResourceFile[]>()
  for (const file of listPluginDefaultFiles({ pluginId: plugin.id, pluginPath: plugin.path, kind: 'runtime-skills' })) {
    const slash = file.relPath.indexOf('/')
    if (slash < 0) continue
    const name = file.relPath.slice(0, slash)
    const list = groups.get(name) ?? []
    list.push({ ...file, relPath: file.relPath.slice(slash + 1) })
    groups.set(name, list)
  }
  const skills: PluginSkillSource[] = []
  for (const [name, files] of groups) {
    const skillMd = files.find(file => file.relPath === 'SKILL.md')
    if (!skillMd) continue
    skills.push({ name, skillMdPath: skillMd.path, files })
  }
  return skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

function isInstalledMarker(value: unknown): value is InstalledMarker {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as InstalledMarker).pluginId === 'string'
    && typeof (value as InstalledMarker).sha256 === 'string'
}

/** Ownership for uninstall (with the lockfile allowlist) — never content evidence. */
function readMarker(skill: RuntimeSkill | null): InstalledMarker | null {
  const marker = skill?.metadata?.installedBy
  return isInstalledMarker(marker) ? marker : null
}

function isUserEditedSkill(skill: RuntimeSkill | null): boolean {
  return skill?.metadata?.userEdited === true
}

/** A plugin skill file that is not UTF-8 text. */
export class SkillSourceNotTextError extends Error {
  constructor(readonly relPath: string, readonly reason = 'is not UTF-8 text') {
    super(`${relPath} ${reason} — runtime skills carry text files only`)
    this.name = 'SkillSourceNotTextError'
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true })

/**
 * Strict decode (review r1/r2): runtimes read installed skill files as
 * lossy UTF-8, so any non-text byte comes back as U+FFFD. A source that is
 * not strict UTF-8, or that itself contains U+FFFD, could compare equal to
 * a changed installed byte — such a skill is refused, never compared.
 */
function readSkillFiles(skill: PluginSkillSource): Record<string, string> {
  const files: Record<string, string> = {}
  for (const file of skill.files) {
    let text: string
    try {
      text = UTF8.decode(readFileSync(file.path))
    } catch (err) {
      if (err instanceof TypeError) throw new SkillSourceNotTextError(file.relPath)
      throw err
    }
    if (text.includes('\uFFFD')) throw new SkillSourceNotTextError(file.relPath, 'contains U+FFFD')
    files[file.relPath] = text
  }
  return files
}

/**
 * Upgrade preflight: every skill the plugin ships must be text BEFORE any
 * is written — the replace transaction restores the plugin directory, not
 * runtime skills, so a refusal halfway would leave earlier skills upgraded.
 */
export function assertPluginSkillsAreText(plugin: PluginEntry): void {
  for (const skill of findSkillsForPlugin(plugin)) {
    try {
      readSkillFiles(skill)
    } catch (err) {
      if (err instanceof SkillSourceNotTextError) throw new SkillSourceNotTextError(`${skill.name}/${err.relPath}`, err.reason)
      throw err
    }
  }
}

function buildRuntimeSkill(skill: PluginSkillSource, marker: InstalledMarker): RuntimeSkill {
  const files = readSkillFiles(skill)
  return {
    name: skill.name,
    instructions: files['SKILL.md'] ?? '',
    files,
    metadata: { installedBy: marker },
  }
}


function sameFiles(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => b[key] === a[key])
}

/**
 * The ONE skill predicate behind scan and install: the installed files
 * must equal the expected build of the plugin's skill, file for file.
 */
function skillVerdict(source: PluginSkillSource, installed: RuntimeSkill | null): 'missing' | 'installed' | 'drifted' {
  // Read the source first: a skill that is not text is refused whether or
  // not a copy is installed.
  const expected = readSkillFiles(source)
  if (!installed) return 'missing'
  // Runtimes return SKILL.md inside the file map; a map without it means
  // the tree read failed (readSkillTree answers {} on any error) — that is
  // unverified, never rebuilt from `instructions` into a pass (review r3).
  const files = installed.files ?? {}
  if (files['SKILL.md'] === undefined) return 'drifted'
  return sameFiles(expected, files) ? 'installed' : 'drifted'
}

/**
 * `requires.bins` of a plugin's on-disk manifest. Core plugins never declare
 * binaries (they ship inside the Bakin binary), so an entry with no manifest
 * on disk simply has none; an invalid declaration is logged and ignored here
 * — install and upgrade already refused it at their gates.
 */
/** A plugin's declared binaries, or why its declaration cannot be used. */
export type PluginBinDeclaration = { ok: true; bins: BinRequirement[] } | { ok: false; reason: string }

export function findBinsForPlugin(plugin: PluginEntry): PluginBinDeclaration {
  const manifestPath = join(plugin.path, 'bakin-plugin.json')
  if (!existsSync(manifestPath)) return { ok: true, bins: [] }
  // The canonical manifest parser — the one the loader runs — decides; only
  // a VALID manifest that declares no bins means "no bins" (#898 D).
  try {
    const manifest = readPluginManifestJson(readFileSync(manifestPath, 'utf-8'))
    return { ok: true, bins: (manifest.requires?.bins ?? []) as BinRequirement[] }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

function scanPluginBins(plugins: PluginEntry[]): BinScanReport {
  const bins: BinScanReport = { total: 0, installed: [], missing: [], drifted: [], unsupported: [], invalid: [] }
  const platform = binPlatformKey()
  for (const plugin of plugins) {
    const declared = findBinsForPlugin(plugin)
    if (!declared.ok) {
      bins.invalid.push({ pluginId: plugin.id, reason: declared.reason })
      continue
    }
    for (const bin of declared.bins) {
      bins.total++
      const ref: BinRef = { pluginId: plugin.id, name: bin.name }
      const download = platform ? bin.install[platform] : undefined
      if (!download) {
        bins.unsupported.push(ref)
        continue
      }
      // ONE predicate with the installer: whatever it would skip is installed here.
      const verdict = verifyInstalledBin(binTargetPath(bin.name), download)
      if (verdict.status === 'installed') bins.installed.push(ref)
      else if (verdict.status === 'drifted') bins.drifted.push(ref)
      else bins.missing.push(ref)
    }
  }
  return bins
}

export async function scanPluginAssets(plugins: PluginEntry[]): Promise<ScanReport> {
  const report: ScanReport = {
    totalAvailable: 0,
    missing: [],
    drifted: [],
    installed: [],
    userEdited: [],
    userEditedDrifted: [],
    invalidSource: [],
    bins: scanPluginBins(plugins),
  }

  const runtime = getAppServices().runtime
  for (const plugin of plugins) {
    for (const skill of findSkillsForPlugin(plugin)) {
      report.totalAvailable++
      const ref: SkillRef = { pluginId: plugin.id, name: skill.name }
      const installedSkill = await runtime.skills.get(skill.name)
      let verdict: ReturnType<typeof skillVerdict>
      try {
        verdict = skillVerdict(skill, installedSkill)
      } catch (err) {
        if (!(err instanceof SkillSourceNotTextError)) throw err
        report.invalidSource.push({ ...ref, error: err.message })
        continue
      }

      if (installedSkill && isUserEditedSkill(installedSkill)) {
        report.userEdited.push(ref)
        if (verdict === 'drifted') report.userEditedDrifted.push(ref)
        continue
      }
      report[verdict].push(ref)
    }
  }

  return report
}

/**
 * Plugin assets as an operation (#895): skills first (the point of no return —
 * the first runtime write), then binaries, one item per plugin in each.
 */
export const PLUGIN_ASSETS_PLAN: OperationPlan = {
  stages: [
    { id: 'skills', kind: 'installing', label: 'Install plugin skills' },
    { id: 'bins', kind: 'installing', label: 'Install plugin binaries' },
  ],
  pointOfNoReturn: 'skills',
}

export interface InstallPluginAssetsOptions {
  /**
   * User-edited skills to RESTORE to the shipped copy (self-healing 1.4b,
   * row 94's "Restore shipped"): the lock is released by removing the skill
   * (the sentinel goes with it) so the install below writes it fresh. Only
   * an explicit decision names a skill here — the default never overwrites
   * an edit.
   */
  restoreUserEdited?: readonly string[]
}

export async function installPluginAssets(plugins: PluginEntry[], op?: OperationContext, opts: InstallPluginAssetsOptions = {}): Promise<InstallReport> {
  const report: InstallReport = { installed: [], unchanged: [], skipped: [], failed: [], restored: [], bins: { installed: [], unchanged: [], failed: [], invalid: [] } }
  const runtime = getAppServices().runtime

  op?.stage('skills')
  for (const name of opts.restoreUserEdited ?? []) {
    const existing = await runtime.skills.get(name)
    if (!existing || !isUserEditedSkill(existing)) continue
    await runtime.skills.remove(name)
    report.restored.push(name)
    op?.log(`Released the edited copy of ${name}; the plugin's copy is installed below.`)
  }
  for (const plugin of plugins) {
    const skills = findSkillsForPlugin(plugin)
    if (skills.length === 0) continue
    op?.item('skills', { id: plugin.id, label: plugin.id, status: 'active' })
    const before = report.installed.length
    for (const skill of skills) {
      const ref: SkillRef = { pluginId: plugin.id, name: skill.name }
      const installedSkill = await runtime.skills.get(skill.name)

      if (installedSkill && isUserEditedSkill(installedSkill)) {
        report.skipped.push({ ...ref, reason: 'userEdited' })
        log.warn('Skipping user-edited plugin skill', { name: skill.name, pluginId: plugin.id })
        continue
      }

      let built: RuntimeSkill
      let verdict: ReturnType<typeof skillVerdict>
      try {
        built = buildRuntimeSkill(skill, { pluginId: plugin.id, sha256: sha256OfFile(skill.skillMdPath) })
        verdict = skillVerdict(skill, installedSkill)
      } catch (err) {
        if (!(err instanceof SkillSourceNotTextError)) throw err
        report.failed.push({ ...ref, error: err.message })
        log.warn('Refusing a plugin skill that is not text', { name: skill.name, pluginId: plugin.id, error: err.message })
        continue
      }
      // Content proves the skill is current; the marker is still rewritten
      // when it no longer names this plugin, or uninstall would orphan it.
      if (verdict === 'installed' && readMarker(installedSkill)?.pluginId === plugin.id) {
        report.unchanged.push(ref)
        continue
      }

      // Write over the existing copy first — never delete a usable skill
      // before its replacement is down. Only when leftovers keep it drifted
      // (a file the plugin does not ship, a directory without SKILL.md) is
      // it removed and written fresh; a skill that still differs fails.
      await runtime.skills.write(built)
      if (skillVerdict(skill, await runtime.skills.get(skill.name)) !== 'installed') {
        await runtime.skills.remove(skill.name)
        await runtime.skills.write(built)
        if (skillVerdict(skill, await runtime.skills.get(skill.name)) !== 'installed') {
          report.failed.push({ ...ref, error: 'the installed skill still differs from the plugin after a full rewrite' })
          log.warn('Plugin skill did not verify after rewrite', { name: skill.name, pluginId: plugin.id })
          continue
        }
      }
      report.installed.push(ref)
      log.info('Installed plugin skill', { name: skill.name, pluginId: plugin.id })
    }
    const wrote = report.installed.length - before
    op?.item('skills', { id: plugin.id, label: plugin.id, status: 'done', message: wrote > 0 ? `${wrote} skill(s) written` : 'up to date' })
  }

  // Sync lockfile installedSkills with what we just laid down. Without
  // this, skills installed via `bakin install plugin-assets` (the
  // onboarding component) would never appear in the lockfile allowlist
  // — and the C14 uninstall flow would silently leave them as orphans
  // because they wouldn't be in any plugin's `installedSkills`.
  syncLockfileInstalledSkills(plugins)

  // Binaries: the shared installer is idempotent (pinned-sha fast path), so
  // every declared bin goes through it; `created` tells installed from
  // unchanged. Serialized under the install lock like every bin writer;
  // a pin conflict or failed download fails THIS plugin's repair loudly and
  // leaves the others to proceed.
  op?.stage('bins')
  for (const plugin of plugins) {
    const declared = findBinsForPlugin(plugin)
    if (!declared.ok) {
      // Nothing to install against: an invalid declaration is the plugin's
      // to fix (upgrade), never silently "no bins".
      op?.item('bins', { id: plugin.id, label: plugin.id, status: 'failed', message: `invalid requires.bins — upgrade the plugin (${declared.reason})` })
      report.bins.invalid.push({ pluginId: plugin.id, reason: declared.reason })
      continue
    }
    const bins = declared.bins
    if (bins.length === 0) continue
    const platform = binPlatformKey()
    const installable = bins.filter((bin) => platform && bin.install[platform])
    if (installable.length === 0) continue
    const entry = readLockEntry(plugin.id)
    if (!entry) {
      // Core plugins never declare bins; a user plugin without a ledger row
      // was never consented to — the repair does not install for it.
      log.warn('Skipping binaries of a plugin with no lockfile entry', { pluginId: plugin.id })
      op?.item('bins', { id: plugin.id, label: plugin.id, status: 'skipped', message: 'no consented lockfile entry' })
      continue
    }
    op?.item('bins', { id: plugin.id, label: plugin.id, status: 'active' })
    try {
      const results = await installPluginBins(installable, {
        pluginId: plugin.id,
        version: entry.version,
        ref: entry.ref,
        commitSha: entry.commitSha,
      })
      for (const result of results) {
        const ref: BinRef = { pluginId: plugin.id, name: result.name }
        if (result.created) {
          report.bins.installed.push(ref)
          log.info('Installed plugin binary', { ...ref })
        } else {
          report.bins.unchanged.push(ref)
        }
      }
      syncLockfileInstalledBins(plugin.id, toInstalledBins(results) ?? [])
      op?.item('bins', { id: plugin.id, label: plugin.id, status: 'done', message: `${results.filter((r) => r.created).length} installed, ${results.filter((r) => !r.created).length} unchanged` })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.error('Plugin binary install failed', err as Error, { pluginId: plugin.id })
      for (const bin of installable) report.bins.failed.push({ pluginId: plugin.id, name: bin.name, error })
      op?.item('bins', { id: plugin.id, label: plugin.id, status: 'failed', message: error })
    }
  }

  return report
}

function readLockEntry(pluginId: string): PluginLockfile['plugins'][string] | undefined {
  try {
    return readPluginLockfile().plugins[pluginId]
  } catch (err) {
    log.warn('lockfile read failed', { pluginId, err: String(err) })
    return undefined
  }
}

/** Record what the repair laid down — the lockfile is the ownership authority for `~/.bakin/bin`. */
function syncLockfileInstalledBins(pluginId: string, installedBins: Array<{ name: string; sha256: string; member?: string }>): void {
  try {
    const lock = readPluginLockfile()
    if (!lock.plugins[pluginId]) return
    const current = JSON.stringify(lock.plugins[pluginId].installedBins ?? [])
    if (current === JSON.stringify(installedBins)) return
    writePluginLockfile(updatePlugin(lock, pluginId, { installedBins: installedBins.length > 0 ? installedBins : undefined }))
  } catch (err) {
    log.warn('syncLockfileInstalledBins failed', { pluginId, err: String(err) })
  }
}

/**
 * Discover the set of plugin entries to scan. Defaults to the built-in
 * plugins from `bakin.config.ts` plus any user plugins under
 * `~/.bakin/plugins/`. Tests inject their own list directly.
 */
/** Discovery could not establish which plugins exist — the check must report it, not a clean slate. */
export class PluginDiscoveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginDiscoveryError'
  }
}

function discoverPlugins(): PluginEntry[] {
  const plugins: PluginEntry[] = []
  // Built-in plugins from bakin.config.ts. We require() it lazily so
  // onboarding can run before the bundler resolves the workspace.
  try {
    const mod = require('../../../bakin.config') as Record<string, unknown>
    const cfg = (mod.default ?? mod) as { plugins?: Array<{ path: string; enabled?: boolean }> }
    for (const p of cfg.plugins ?? []) {
      if (p.enabled === false) continue
      const id = p.path.split('/').pop() || p.path
      // Config-relative root; plugin-resources resolves it against the repo
      // root on a checkout and against the embedded copies in a binary —
      // never against process.cwd(), which is wherever the daemon started.
      plugins.push({ id, path: p.path })
    }
  } catch (err) {
    log.warn('Failed to read bakin.config for plugin discovery', { error: String(err) })
  }

  // User plugins: ONLY committed installs — a lockfile row (provenance) AND a
  // loadable directory (no sentinel, not a dot-prefixed backup/staging dir).
  // Anything else under ~/.bakin/plugins/ (an abandoned `.staging-*`, a
  // half-written install, a stray copy) was never consented to and must
  // never feed the repair's bin installer.
  // A ledger that cannot be read is a FAILED inspection, never "no user
  // plugins": the caller reports error/unknown instead of a false healthy.
  const { getContentDir } = require('../content-dir') as typeof import('../content-dir')
  const userPluginsDir = join(getContentDir(), 'plugins')
  let lock: PluginLockfile
  try {
    lock = readPluginLockfile()
  } catch (err) {
    throw new PluginDiscoveryError(`plugin lockfile could not be read: ${err instanceof Error ? err.message : String(err)}`)
  }
  for (const [id, entry] of Object.entries(lock.plugins)) {
    if (isLinked(entry)) continue // dev-linked source trees are the author's territory
    if (!isLoadableUserPluginDir(userPluginsDir, id)) continue
    if (!existsSync(join(userPluginsDir, id, 'bakin-plugin.json'))) continue
    plugins.push({ id, path: join(userPluginsDir, id) })
  }

  return plugins
}


/**
 * The scanner talks to the runtime adapter. In the server process AppServices
 * already exist; the CLI's `bakin check/install plugin-assets` path runs in
 * its own process and must create them first (same pattern as agent-sync +
 * credentials components).
 */
async function ensureAppServices(): Promise<void> {
  if (maybeGetAppServices()) return
  await createAppServices()
}

const binLabel = (ref: BinRef): string => `${ref.name} (${ref.pluginId})`
const invalidBinsMessage = (invalid: BinScanReport['invalid']): string =>
  `${invalid.length} plugin(s) declare binaries this Bakin cannot verify: ${invalid.map((row) => `${row.pluginId} (${row.reason})`).join('; ')}`
const invalidBinsRemediation = (invalid: BinScanReport['invalid']): string =>
  `Upgrade ${invalid.length === 1 ? 'the plugin' : 'each plugin'}: ${invalid.map((row) => `\`bakin plugins upgrade ${row.pluginId}\``).join(', ')}.`

async function check(): Promise<CheckResult> {
  await ensureAppServices()
  let plugins: PluginEntry[]
  try {
    plugins = discoverPlugins()
  } catch (err) {
    if (!(err instanceof PluginDiscoveryError)) throw err
    return {
      name: 'plugin-assets',
      status: 'error',
      message: `Plugin assets could not be inspected — ${err.message}`,
      remediation: 'Repair ~/.bakin/plugins/lock.json, then re-run the check.',
    }
  }
  const report = await scanPluginAssets(plugins)
  const { bins } = report
  const skillsPending = report.missing.length + report.drifted.length
  const binsPending = bins.missing.length + bins.drifted.length
  const pending = skillsPending + binsPending
  const total = report.totalAvailable + bins.total
  const details = report as unknown as Record<string, unknown>

  if (total === 0 && bins.invalid.length === 0) {
    return {
      name: 'plugin-assets',
      status: 'ok',
      message: '0 plugin assets to install (no plugin ships runtime skills or declares binaries)',
      details: { totalAvailable: 0, bins },
    }
  }

  if (pending === 0 && bins.unsupported.length === 0 && (report.userEditedDrifted.length > 0 || report.invalidSource.length > 0 || bins.invalid.length > 0)) {
    // Nothing the repair can fix: the user locked these, or the plugin
    // ships a skill that is not text. Still never ok.
    const label = (ref: SkillRef) => `${ref.name} (${ref.pluginId})`
    const messages: string[] = []
    const remediations: string[] = []
    if (report.userEditedDrifted.length > 0) {
      messages.push(`${report.userEditedDrifted.length} user-edited skill(s) differ from what the plugin ships: ${report.userEditedDrifted.map(label).join(', ')}`)
      remediations.push('Keep the edit, or delete the skill\'s .userEdited file and run `bakin install plugin-assets` to restore the plugin\'s version.')
    }
    if (report.invalidSource.length > 0) {
      messages.push(`${report.invalidSource.length} plugin skill(s) are not text and cannot be installed: ${report.invalidSource.map(label).join(', ')}`)
      remediations.push('Update or remove the plugin that ships them.')
    }
    if (bins.invalid.length > 0) {
      messages.push(invalidBinsMessage(bins.invalid))
      remediations.push(invalidBinsRemediation(bins.invalid))
    }
    return {
      name: 'plugin-assets',
      status: 'warn',
      message: messages.join('; '),
      remediation: remediations.join(' '),
      details,
    }
  }

  if (pending === 0 && bins.unsupported.length === 0 && bins.invalid.length === 0) {
    const userEditedNote = report.userEdited.length > 0
      ? ` (${report.userEdited.length} user-edited, locked)`
      : ''
    const binNote = bins.total > 0 ? ` incl. ${bins.total} binar${bins.total === 1 ? 'y' : 'ies'}` : ''
    return {
      name: 'plugin-assets',
      status: 'ok',
      message: `All ${total} plugin asset(s) installed${binNote}${userEditedNote}`,
      details,
    }
  }

  const parts: string[] = []
  if (report.missing.length > 0) parts.push(`${report.missing.length} skill(s) missing`)
  if (report.drifted.length > 0) parts.push(`${report.drifted.length} skill(s) drifted`)
  if (report.userEditedDrifted.length > 0) parts.push(`${report.userEditedDrifted.length} user-edited skill(s) differ and stay locked`)
  if (report.invalidSource.length > 0) parts.push(`${report.invalidSource.length} skill(s) are not text and cannot be installed`)
  if (bins.missing.length > 0) parts.push(`${bins.missing.length} binar${bins.missing.length === 1 ? 'y' : 'ies'} missing: ${bins.missing.map(binLabel).join(', ')}`)
  if (bins.drifted.length > 0) parts.push(`${bins.drifted.length} binar${bins.drifted.length === 1 ? 'y' : 'ies'} drifted: ${bins.drifted.map(binLabel).join(', ')}`)
  if (bins.invalid.length > 0) parts.push(invalidBinsMessage(bins.invalid))
  if (bins.unsupported.length > 0) parts.push(`${bins.unsupported.length} binar${bins.unsupported.length === 1 ? 'y has' : 'ies have'} no build for this platform: ${bins.unsupported.map(binLabel).join(', ')}`)
  return {
    name: 'plugin-assets',
    status: 'warn',
    message: pending > 0
      ? `${pending} plugin asset(s) need install (${parts.join('; ')})`
      : `Plugin binaries cannot run here (${parts.join('; ')})`,
    remediation: pending > 0
      ? 'Run `bakin install plugin-assets` (or the Health repair) to apply.'
      : 'Remove the plugin, or install it on a supported platform.',
    details,
  }
}

/**
 * The onboarding component's install owns install-state through a local
 * operation (#895) — the bin writers assert it. PR6's onboarding switch
 * replaces this with the component's declared resources.
 */
async function install(_opts: ComponentInstallOptions, op: OperationContext): Promise<InstallResult> {
  return applyPluginAssets(op)
}

/** The component's install, reporting through `op` when run as an operation (the Health repair). */
export async function applyPluginAssets(op?: OperationContext, opts: InstallPluginAssetsOptions = {}): Promise<InstallResult & { restored: string[] }> {
  await ensureAppServices()
  const start = Date.now()
  let plugins: PluginEntry[]
  try {
    plugins = discoverPlugins()
  } catch (err) {
    if (!(err instanceof PluginDiscoveryError)) throw err
    return { name: 'plugin-assets', status: 'failed', message: `Plugin assets could not be inspected — ${err.message}`, error: err, durationMs: Date.now() - start, restored: [] }
  }
  const report = await installPluginAssets(plugins, op, opts)
  const durationMs = Date.now() - start
  const { bins } = report

  if (bins.failed.length > 0 || report.failed.length > 0 || bins.invalid.length > 0) {
    const failures = [
      ...report.failed.map((f) => `skill ${f.name} (${f.pluginId}): ${f.error}`),
      ...bins.failed.map((f) => `${binLabel(f)}: ${f.error}`),
      ...(bins.invalid.length > 0 ? [`${invalidBinsMessage(bins.invalid)} — ${invalidBinsRemediation(bins.invalid)}`] : []),
    ]
    const counts = [
      report.failed.length > 0 ? `${report.failed.length} plugin skill(s)` : null,
      bins.failed.length > 0 ? `${bins.failed.length} plugin binar${bins.failed.length === 1 ? 'y' : 'ies'}` : null,
      bins.invalid.length > 0 ? `the binaries of ${bins.invalid.length} plugin(s)` : null,
    ].filter(Boolean).join(' and ')
    return {
      name: 'plugin-assets',
      restored: report.restored,
      status: 'failed',
      message: `${counts} could not be installed — ${failures.join('; ')}`,
      error: failures,
      durationMs,
    }
  }

  const installedCount = report.installed.length + bins.installed.length
  if (installedCount === 0 && report.skipped.length === 0) {
    const unchanged = report.unchanged.length + bins.unchanged.length
    return {
      name: 'plugin-assets',
      restored: report.restored,
      status: 'noop',
      message: unchanged === 0
        ? '0 plugin assets to install'
        : `All ${unchanged} plugin asset(s) already up to date`,
      durationMs,
    }
  }

  const parts: string[] = []
  if (report.installed.length > 0) parts.push(`${report.installed.length} skill(s)`)
  if (bins.installed.length > 0) parts.push(`${bins.installed.length} binar${bins.installed.length === 1 ? 'y' : 'ies'}: ${bins.installed.map(binLabel).join(', ')}`)
  const skippedNote = report.skipped.length > 0
    ? ` (skipped ${report.skipped.length} user-edited)`
    : ''
  return {
    name: 'plugin-assets',
      restored: report.restored,
    status: 'installed',
    message: `Installed ${parts.join(' and ') || '0 plugin asset(s)'}${skippedNote}`,
    durationMs,
  }
}

export const pluginAssetsComponent: InstallableComponent = {
  plan: PLUGIN_ASSETS_PLAN,
  resources: ['install-state'],
  name: 'plugin-assets',
  check,
  install,
}

/**
 * Reconcile the lockfile's per-plugin `installedSkills` field with what's
 * actually in `defaults/runtime-skills/` for each plugin entry. Best-
 * effort — failures are logged but never throw. Called from
 * `installPluginAssets` so the onboarding-driven install path keeps the
 * lockfile in sync with what was projected to the runtime skill store.
 *
 * Only touches lockfile entries that ALREADY exist (i.e., user plugins
 * that were installed via `bakin plugins install`). Core plugins have no
 * lockfile entry; they're skipped.
 *
 * Static-import (not lazy `require`) so test mocks targeting the
 * lockfile module actually intercept these calls. The previous lazy
 * require silently bypassed `mock.module` and the function ran against
 * the real production code path during tests — which then tripped the
 * content-dir safety guard and silently aborted via the swallow-all
 * catch below. The "circular import" the lazy form claimed to dodge
 * doesn't actually exist (lockfile only depends on content-dir).
 */
export function syncLockfileInstalledSkills(plugins: PluginEntry[]): void {
  let lock: PluginLockfile
  try {
    lock = readPluginLockfile()
  } catch (err) {
    log.warn('syncLockfileInstalledSkills: lockfile read failed', { err: String(err) })
    return
  }
  let mutated = false
  for (const plugin of plugins) {
    if (!lock.plugins[plugin.id]) continue
    const skillNames = findSkillsForPlugin(plugin).map(s => s.name).sort()
    const current = (lock.plugins[plugin.id].installedSkills ?? []).slice().sort()
    if (skillNames.length === current.length && skillNames.every((n, i) => n === current[i])) continue
    try {
      lock = updatePlugin(lock, plugin.id, { installedSkills: skillNames })
      mutated = true
    } catch (err) {
      log.warn('syncLockfileInstalledSkills: updatePlugin failed', { id: plugin.id, err: String(err) })
    }
  }
  if (mutated) {
    try {
      writePluginLockfile(lock)
    } catch (err) {
      log.warn('syncLockfileInstalledSkills: write failed', { err: String(err) })
    }
  }
}

// ─── Removal (#119) ──────────────────────────────────────────────────────────

export interface PluginAssetsRemovalPlan {
  /** Runtime skill names that will be removed. */
  toRemove: string[]
  /** Runtime skill names left in place because of `.userEdited`. */
  toKeep: string[]
  /**
   * Skills that the lockfile says this plugin installed but which are
   * not present (or no longer carry the matching .installedBy marker).
   * Surfaced for diagnostics; not deleted.
   */
  missingFromDisk: string[]
  /** Content snapshot for skills that will be removed, used by uninstall archives. */
  snapshots: PluginSkillSnapshot[]
}

export interface PluginSkillSnapshot {
  name: string
  files: Record<string, string>
}

/**
 * Ask the runtime to partition skills owned by `pluginId`
 * into "remove" vs "keep" (`.userEdited` locked).
 *
 * `ownedSkills` is the authoritative allowlist — the set of skill names
 * the LOCKFILE recorded this plugin installed at install/upgrade time.
 * A skill is only removable if it appears in BOTH the allowlist AND carries a
 * matching `.installedBy.pluginId` marker.
 *
 * This defeats the fake-marker scorched-earth attack (security HIGH #2):
 * a malicious plugin that writes `{pluginId: "evil"}` into a victim's
 * `.installedBy` cannot trick uninstall into deleting the victim's
 * skills, because the lockfile entry for "evil" never recorded
 * ownership of them.
 */
export async function planPluginAssetsRemoval(
  pluginId: string,
  ownedSkills: readonly string[],
): Promise<PluginAssetsRemovalPlan> {
  const plan: PluginAssetsRemovalPlan = { toRemove: [], toKeep: [], missingFromDisk: [], snapshots: [] }
  if (ownedSkills.length === 0) return plan

  const runtime = getAppServices().runtime
  for (const skillName of ownedSkills) {
    const skill = await runtime.skills.get(skillName)
    if (!skill) {
      plan.missingFromDisk.push(skillName)
      continue
    }
    const marker = readMarker(skill)
    if (!marker || marker.pluginId !== pluginId) {
      // Lockfile claims ownership but the runtime marker disagrees —
      // either the plugin lost ownership (manual edit) or another plugin
      // overwrote it. Don't delete; surface as missing so operators can
      // investigate.
      plan.missingFromDisk.push(skillName)
      continue
    }
    if (isUserEditedSkill(skill)) {
      plan.toKeep.push(skillName)
    } else {
      plan.toRemove.push(skillName)
      plan.snapshots.push({
        name: skillName,
        files: skill.files ?? { 'SKILL.md': skill.instructions ?? '' },
      })
    }
  }
  return plan
}

/**
 * Tear down runtime skills owned by `pluginId`. Skips any skill with a
 * `.userEdited` sentinel and reports counts. Used by
 * `bakin plugins remove` (#119).
 *
 * `ownedSkills` is the lockfile-recorded allowlist — see
 * `planPluginAssetsRemoval` for the authority model.
 */
export async function removePluginAssets(
  pluginId: string,
  ownedSkills: readonly string[],
  existingPlan?: PluginAssetsRemovalPlan,
): Promise<{
  removed: number
  kept: number
  removedSkills: string[]
  keptSkills: string[]
  missingFromDisk: string[]
}> {
  const plan = existingPlan ?? await planPluginAssetsRemoval(pluginId, ownedSkills)
  if (plan.toRemove.length === 0) {
    return {
      removed: 0,
      kept: plan.toKeep.length,
      removedSkills: [],
      keptSkills: plan.toKeep,
      missingFromDisk: plan.missingFromDisk,
    }
  }

  const runtime = getAppServices().runtime
  for (const skillName of plan.toRemove) {
    await runtime.skills.remove(skillName)
    log.info('Removed runtime skill on plugin uninstall', { skillName, pluginId })
  }
  return {
    removed: plan.toRemove.length,
    kept: plan.toKeep.length,
    removedSkills: plan.toRemove,
    keptSkills: plan.toKeep,
    missingFromDisk: plan.missingFromDisk,
  }
}
