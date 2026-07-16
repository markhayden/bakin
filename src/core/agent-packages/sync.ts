/**
 * Agent sync engine (layered-context spec, C5) — the single verb behind
 * `bakin agents sync`, the REST sync route, the doctor repair handler, and
 * lesson toggling.
 *
 * Per-agent sequence:
 *   1. (managed, fetch enabled)  fetch upstream + update installed source
 *      via the updater — the ONLY network step, never run by doctor.
 *   2. reclaim — clear `.userEdited` sentinels for explicitly confirmed
 *      targets so re-projection can take them back.
 *   3. re-project locally from the installed source: recompose every
 *      managed block + re-write skills/assets (sentineled ones skipped).
 *   4. verify — re-run the local drift scanner for this agent.
 *   5. receipt — persist the latest receipt + audit the sync.
 *
 * `check: true` runs steps 1' (read-only upstream check) + 4 only — the
 * no-mutation guarantee is structural: every write lives behind the
 * `!check` branch.
 *
 * Unmanaged agents get steps 3–5 with context layers only (their AGENTS.md
 * block) — "unmanaged" means no package, not no Bakin context.
 *
 * Pre-migration lockfile entries refuse to sync (MigrationRequiredError):
 * composing blocks into un-migrated files would duplicate template content.
 * The migration module (C6) is the one-time path out.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../logger'
import { getContentDir } from '../content-dir'
import { appendAudit } from '../audit'
import { getAppServices } from '../app-services'
import {
  type Lockfile,
  type PackageEntry,
  type ProjectionEntry,
  addPackage,
  findAgentPackage,
  readLockfile,
  writeLockfile,
} from '../../../packages/core/src/agent-packages/lockfile'
import {
  type Manifest,
  parseManifest,
} from '../../../packages/core/src/agent-packages/manifest'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import {
  MANAGED_BLOCK_ID,
  type ComposableFile,
  composeFileContent,
} from '../../../packages/core/src/agent-packages/composer'
import { extractBlock, removeBlock } from '../../../packages/core/src/agent-packages/managed-blocks'
import { unmarkUserEdited } from '../../../packages/core/src/agent-packages/markers'
import { PackageNotInstalledError } from './errors'
import { projectPackage, type ProjectorResult } from './projector'
import { installManifestRequirements } from './requirements-installer'
import { updatePackageById } from './updater'
import { checkPackageUpdateAsync } from './checker'
import {
  COMPOSABLE_FILES,
  type SyncFinding,
  deriveExpectedBlocks,
  mainAgentOf,
  readInstalledManifest,
  scanAgentSync,
} from './sync-scanner'
import {
  type ReceiptBlock,
  type ReceiptProjection,
  type SyncReceipt,
  writeReceipt,
} from './receipts'
import { refreshRoleContextBlocks, seedContextFiles } from '../team-context'

const log = createLogger('agent-pkg:sync')

export class MigrationRequiredError extends Error {
  constructor(public readonly packageId: string) {
    super(
      `Package "${packageId}" predates block-based projection. ` +
        `Run the one-time migration first (\`bakin agents sync\` prompts for it).`,
    )
    this.name = 'MigrationRequiredError'
  }
}

export interface SyncOptions {
  /** Report only — guaranteed zero writes. */
  check?: boolean
  /** Fetch upstream for managed agents (network). Default true; doctor passes false. */
  fetch?: boolean
  /** Targets whose .userEdited sentinels should be cleared ('all' or skill names / paths). */
  reclaim?: string[] | 'all'
  /** Audit source. */
  trigger?: 'cli' | 'rest' | 'system'
}

// ─── Internals ───────────────────────────────────────────────────────────────

function entryNeedsMigration(entry: PackageEntry): boolean {
  return (entry.projections ?? []).some(
    (p) => p.kind === 'lesson-marker' || p.templateOnly === true
      || (p.kind === 'workspace-file' && !p.composedSha),
  )
}

function stripVersionFromKey(key: string): string {
  const at = key.lastIndexOf('@')
  return at === -1 ? key : key.slice(0, at)
}

function blockSections(body: string): string[] {
  return [...body.matchAll(/<!-- bakin-section: ([^ ]+) -->/g)].map((m) => m[1])
}

async function readBlockBodies(agentId: string): Promise<Map<ComposableFile, string | null>> {
  const runtime = getAppServices().runtime
  const out = new Map<ComposableFile, string | null>()
  for (const file of COMPOSABLE_FILES) {
    const ws = await runtime.agents.readWorkspaceFile(agentId, file)
    out.set(file, ws ? extractBlock(ws.content, MANAGED_BLOCK_ID) : null)
  }
  return out
}

function diffBlocks(
  before: Map<ComposableFile, string | null>,
  after: Map<ComposableFile, string | null>,
): ReceiptBlock[] {
  const blocks: ReceiptBlock[] = []
  for (const file of COMPOSABLE_FILES) {
    const b = before.get(file) ?? null
    const a = after.get(file) ?? null
    if (a === null && b === null) continue
    blocks.push({
      file,
      action: a === null ? 'removed' : a === b ? 'unchanged' : 'recomposed',
      sections: a ? blockSections(a) : [],
      bytes: a?.length ?? 0,
    })
  }
  return blocks
}

function targetMatchesReclaim(target: string, reclaim: string[] | 'all'): boolean {
  if (reclaim === 'all') return true
  return reclaim.some((r) => target === r || target.endsWith(`:${encodeURIComponent(r)}`) || target.endsWith(`/${r}`) || target.includes(r))
}

/**
 * Clear `.userEdited` sentinels for the requested targets so the upcoming
 * re-projection can reclaim them. Runtime skills: removing the skill drops
 * the sentinel with it (the projector writes it back fresh). Disk assets:
 * remove the sidecar.
 */
async function reclaimTargets(
  entry: PackageEntry,
  reclaim: string[] | 'all',
): Promise<string[]> {
  const runtime = getAppServices().runtime
  const reclaimed: string[] = []
  for (const p of entry.projections ?? []) {
    if (p.kind === 'workspace-file' || p.kind === 'lesson-marker') continue
    if (!targetMatchesReclaim(p.target, reclaim)) continue

    if (p.target.startsWith('runtime:agent-skill:') || p.target.startsWith('runtime:global-skill:')) {
      const parts = p.target.split(':')
      const isAgentSkill = parts[1] === 'agent-skill'
      const name = decodeURIComponent(parts[isAgentSkill ? 3 : 2])
      const agentId = isAgentSkill ? decodeURIComponent(parts[2]) : undefined
      const skill = await runtime.skills.get(name, agentId)
      if (skill?.metadata?.userEdited === true) {
        await runtime.skills.remove(name, agentId)
        reclaimed.push(p.target)
      }
      continue
    }

    if (existsSync(p.target)) {
      unmarkUserEdited(p.target)
      reclaimed.push(p.target)
    }
  }
  return reclaimed
}

/**
 * Re-project a package from its INSTALLED source dir (no fetch of the
 * package source): recompose blocks + re-write skills/assets, then update
 * the lockfile's projection records. Skipped (sentineled) targets keep
 * their previous lockfile entries so they stay tracked. The one exception
 * to "no network": a capability pack's MISSING pinned binary is
 * re-downloaded best-effort (bytes that aren't on disk can't be restored
 * locally); an unchanged on-disk bin never touches the network.
 */
async function applyLocalProjection(packageId: string): Promise<ProjectorResult> {
  const lock = readLockfile()
  const entry = lock.packages[packageId]
  if (!entry) throw new PackageNotInstalledError(packageId)

  const sourceDir = getPackageSourceDir(
    getContentDir(), entry.kind, stripVersionFromKey(packageId), entry.version,
  )
  const manifestPath = join(sourceDir, 'bakin-package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Installed source missing for "${packageId}" (${sourceDir}) — run a fetching sync to restore it.`,
    )
  }
  const manifest: Manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))

  const installedBy = {
    package: stripVersionFromKey(packageId),
    version: entry.version,
    ref: entry.ref,
    commitSha: entry.commitSha,
    installedAt: new Date().toISOString(),
  }
  const result = await projectPackage({
    manifest,
    stagingDir: sourceDir,
    agentId: entry.agentId,
    enabledLessons: entry.kind === 'agent' ? entry.lessonsEnabled : undefined,
    installedBy,
  })
  // Requirement legs (bins/npm payloads/models) are part of the projected
  // surface — re-adding them here keeps the lockfile honest AND makes local
  // repair restore deleted artifacts (idempotent: on-disk state matching the
  // pins is skipped, no network). Restoring MISSING bytes needs the network,
  // so the pass is best-effort: offline, skills still repair and previous
  // requirement rows stay tracked — readiness keeps reporting the missing
  // leg with its remediation.
  const REQUIREMENT_KINDS = new Set(['bin', 'npm-payload', 'model'])
  try {
    await installManifestRequirements({
      manifest,
      packId: stripVersionFromKey(packageId),
      sourceDir,
      installedBy,
      result,
    })
  } catch (err) {
    log.warn('Requirement restore failed during local re-projection — previous rows kept', {
      packageId, error: err instanceof Error ? err.message : String(err),
    })
    const restored = new Set(result.projections.filter((p) => REQUIREMENT_KINDS.has(p.kind)).map((p) => p.target))
    result.projections.push(
      ...(entry.projections ?? []).filter((p) => REQUIREMENT_KINDS.has(p.kind) && !restored.has(p.target)),
    )
  }

  // Preserve lockfile records for targets the projector skipped (.userEdited)
  // — they're still package projections, just locally locked.
  const skippedTargets = new Set(result.skipped.map((s) => s.target))
  const preserved = (entry.projections ?? []).filter((p) => skippedTargets.has(p.target))
  const nextProjections: ProjectionEntry[] = [...result.projections, ...preserved]

  writeLockfile(addPackage(lock, packageId, { ...entry, projections: nextProjections }))
  return result
}

async function verifyAgent(agentId: string, packageId?: string): Promise<SyncFinding[]> {
  const report = await scanAgentSync(undefined, { agentId })
  return report.findings.filter(
    (f) => f.agentId === agentId || (packageId !== undefined && f.packageId === packageId),
  )
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function syncAgent(agentId: string, opts: SyncOptions = {}): Promise<SyncReceipt> {
  const check = opts.check === true
  const fetch = opts.fetch !== false
  const trigger = opts.trigger ?? 'cli'

  if (!check) {
    seedContextFiles()
    // Refresh the Bakin-shipped role-default blocks BEFORE composing — a
    // sync that composes from stale seeded roles keeps obsolete guidance
    // alive forever (the mcporter incident: retired CLI-shim syntax
    // survived in roles/*.md and re-projected into every AGENTS.md).
    refreshRoleContextBlocks()
  }

  const lock = readLockfile()
  const owner = findAgentPackage(lock, agentId)

  const blocksBefore = await readBlockBodies(agentId)
  let receipt: SyncReceipt

  if (owner) {
    if (entryNeedsMigration(owner.entry)) throw new MigrationRequiredError(owner.id)

    const versionBefore = owner.entry.version
    const commitBefore = owner.entry.commitSha
    let versionAfter = versionBefore
    let commitAfter = commitBefore
    let changed = false
    const projections: ReceiptProjection[] = []
    let skipped: Array<{ target: string; reason: string; hint?: string }> = []
    let reclaimed: string[] = []

    if (check) {
      if (fetch) {
        try {
          const status = await checkPackageUpdateAsync(owner.id)
          versionAfter = status.latestVersion ?? versionBefore
          commitAfter = status.latestCommitSha ?? commitBefore
          changed = status.upgradeAvailable === true
        } catch (err) {
          log.warn('Upstream check failed during --check', { packageId: owner.id, error: String(err) })
        }
      }
    } else {
      if (opts.reclaim) reclaimed = await reclaimTargets(owner.entry, opts.reclaim)

      if (fetch) {
        const update = await updatePackageById({ packageId: owner.id })
        versionAfter = update.toVersion
        commitAfter = update.toCommitSha
        changed = update.changed
      }
      // Always re-project locally: context layers / lessons / reclaims can
      // change without the package source moving, and the updater no-ops on
      // an unchanged commit.
      const result = await applyLocalProjection(owner.id)
      for (const p of result.projections) {
        if (p.kind !== 'skill' && p.kind !== 'asset') continue
        projections.push({
          target: p.target,
          kind: p.kind,
          action: reclaimed.includes(p.target) ? 'reclaimed' : 'written',
        })
      }
      skipped = result.skipped.map((s) => ({
        target: s.target,
        reason: s.reason,
        hint: `bakin agents sync ${agentId} --reclaim ${s.target}`,
      }))

      // Identity drift: the manifest owns a MANAGED agent's display name.
      // Creation seeds it once; a rename in the package must land on sync
      // (through the adapter — the runtime still owns the record itself).
      const installed = readInstalledManifest(owner.id, owner.entry)
      const wantName = installed?.manifest.kind === 'agent' ? installed.manifest.agent.identity.name : undefined
      if (wantName) {
        try {
          const runtime = getAppServices().runtime
          const live = await runtime.agents.get(agentId)
          if (live && live.name !== wantName) {
            await runtime.agents.update(agentId, { name: wantName })
            projections.push({ target: `runtime:agent:${agentId}:name`, kind: 'identity', action: 'written' })
          }
        } catch (err) {
          log.warn('Identity refresh failed — projections applied, name unchanged', {
            agentId, wantName, error: String(err),
          })
          skipped.push({ target: `runtime:agent:${agentId}:name`, reason: `identity refresh failed: ${String(err)}` })
        }
      }
    }

    const findings = await verifyAgent(agentId, owner.id)
    receipt = {
      agentId,
      syncedAt: new Date().toISOString(),
      state: 'managed',
      checkOnly: check,
      package: {
        id: owner.id,
        versionBefore,
        versionAfter,
        commitBefore,
        commitAfter,
        fetched: fetch,
        changed,
      },
      blocks: diffBlocks(blocksBefore, await readBlockBodies(agentId)),
      projections,
      skipped,
      verification: { status: findings.length === 0 ? 'ok' : 'issues', findings },
    }
  } else {
    // Unmanaged agent — maintain the context-layer AGENTS.md block only.
    if (!check) await recomposeUnmanagedAgent(agentId)
    const findings = await verifyAgent(agentId)
    receipt = {
      agentId,
      syncedAt: new Date().toISOString(),
      state: 'unmanaged',
      checkOnly: check,
      blocks: diffBlocks(blocksBefore, await readBlockBodies(agentId)),
      projections: [],
      skipped: [],
      verification: { status: findings.length === 0 ? 'ok' : 'issues', findings },
    }
  }

  if (!check) {
    writeReceipt(receipt)
    appendAudit(
      getContentDir(),
      'agent_pkg.synced',
      agentId,
      {
        state: receipt.state,
        packageId: receipt.package?.id,
        changed: receipt.package?.changed ?? false,
        blocksRecomposed: receipt.blocks.filter((b) => b.action === 'recomposed').length,
        skipped: receipt.skipped.length,
        verification: receipt.verification.status,
      },
      trigger,
    )
  }

  return receipt
}

/**
 * Recompose the context-layer AGENTS.md block for an agent with no package.
 * Writes only when the composed content changed; removes the block when no
 * context layer contributes anything.
 */
export async function recomposeUnmanagedAgent(agentId: string): Promise<void> {
  const runtime = getAppServices().runtime
  const agents = await runtime.agents.list()
  const main = mainAgentOf(agents)
  const agentName = agents.find((a) => a.id === agentId)?.name ?? agentId

  const expected = await deriveExpectedBlocks({
    agentId,
    agentName,
    mainAgentId: main.id,
    mainAgentName: main.name,
  })

  for (const exp of expected) {
    const existing = await runtime.agents.readWorkspaceFile(agentId, exp.file)
    if (exp.body === null) {
      if (!existing) continue
      const next = removeBlock(existing.content, MANAGED_BLOCK_ID)
      if (next !== existing.content) {
        await runtime.agents.writeWorkspaceFile(agentId, { ...existing, content: next })
      }
      continue
    }
    const next = composeFileContent(existing?.content ?? '', exp.body)
    if (existing && next === existing.content) continue
    await runtime.agents.writeWorkspaceFile(
      agentId,
      existing ? { ...existing, content: next } : { path: exp.file, content: next },
    )
  }
}

/**
 * Sync every runtime agent (managed: full sequence; unmanaged: context
 * block only) plus any lockfile-only orphans. Errors are captured per
 * agent so one failure doesn't strand the rest.
 */
export async function syncAllAgents(
  opts: SyncOptions = {},
): Promise<Array<{ agentId: string; receipt?: SyncReceipt; error?: string }>> {
  const runtime = getAppServices().runtime
  const lock = readLockfile()
  const ids = new Set<string>()
  for (const agent of await runtime.agents.list()) ids.add(agent.id)
  for (const entry of Object.values(lock.packages)) {
    if (entry.kind === 'agent' && entry.agentId) ids.add(entry.agentId)
  }

  const results: Array<{ agentId: string; receipt?: SyncReceipt; error?: string }> = []
  for (const agentId of [...ids].sort()) {
    try {
      results.push({ agentId, receipt: await syncAgent(agentId, opts) })
    } catch (err) {
      results.push({ agentId, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return results
}

export interface PackSyncReceipt {
  packageId: string
  kind: string
  syncedAt: string
  checkOnly: boolean
  versionBefore: string
  versionAfter: string
  commitBefore: string
  commitAfter: string
  changed: boolean
}

/** Lockfile lookup shared by the standalone-pack verbs — packs only. */
function requirePackEntry(packageKey: string): PackageEntry {
  const entry = readLockfile().packages[packageKey]
  if (!entry) throw new PackageNotInstalledError(packageKey)
  if (entry.kind === 'agent') {
    throw new Error(`"${packageKey}" is an agent package — use \`bakin agents sync ${entry.agentId ?? packageKey}\`.`)
  }
  return entry
}

/**
 * Local-only pack repair: re-project a standalone pack from its INSTALLED
 * source dir — no fetch, no version movement. This is the pack counterpart
 * of the always-local re-projection agents get in syncAgent.
 * userEdited skills are skipped by the projector, reported in `skipped`.
 */
export async function repairPackLocally(packageKey: string): Promise<ProjectorResult> {
  requirePackEntry(packageKey)
  return applyLocalProjection(packageKey)
}

/**
 * Sync symmetry for standalone packs (skill/workflow/lesson packs): fetch +
 * re-project via the updater, then ALWAYS re-project locally — the updater
 * no-ops on an unchanged commit, so without the local pass a plain
 * `bakin packages sync` could never repair drift (agent-sync symmetry).
 * Report-only with --check. Packs have no workspace blocks or receipts
 * file — the response IS the receipt.
 */
export async function syncPack(
  packageId: string,
  opts: { check?: boolean } = {},
): Promise<PackSyncReceipt> {
  const entry = requirePackEntry(packageId)

  if (opts.check) {
    const status = await checkPackageUpdateAsync(packageId)
    return {
      packageId,
      kind: entry.kind,
      syncedAt: new Date().toISOString(),
      checkOnly: true,
      versionBefore: entry.version,
      versionAfter: status.latestVersion ?? entry.version,
      commitBefore: entry.commitSha,
      commitAfter: status.latestCommitSha ?? entry.commitSha,
      changed: status.upgradeAvailable === true,
    }
  }

  const update = await updatePackageById({ packageId })
  await applyLocalProjection(packageId)
  return {
    packageId,
    kind: entry.kind,
    syncedAt: new Date().toISOString(),
    checkOnly: false,
    versionBefore: update.fromVersion,
    versionAfter: update.toVersion,
    commitBefore: update.fromCommitSha,
    commitAfter: update.toCommitSha,
    changed: update.changed,
  }
}

/** True when ANY lockfile entry still has the pre-block projection shape. */
export function lockfileNeedsMigration(lockfile?: Lockfile): boolean {
  const lock = lockfile ?? readLockfile()
  return Object.values(lock.packages).some(entryNeedsMigration)
}
