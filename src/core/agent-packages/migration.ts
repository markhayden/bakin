/**
 * One-time migration to block-based workspace projection (layered-context
 * spec, C6).
 *
 * Pre-migration state: workspace files are an undifferentiated blend of
 * seeded template, agent edits, lesson-marker blocks, and the legacy
 * `managed-context` rules block; the lockfile records `templateOnly`
 * workspace projections and `lesson-marker` entries.
 *
 * Migration (per the approved full-overwrite decision):
 *   - managed agents: every workspace file a layer contributes to is
 *     REPLACED with freshly composed block-only content. Agent-added prose
 *     is intentionally discarded — a tarball backup is taken first.
 *   - unmanaged agents: only Bakin's legacy blocks are swapped for the new
 *     composed block; everything else in their files is preserved (their
 *     files were never Bakin's to overwrite).
 *   - lockfile: legacy projection shapes dropped; the post-migration sync
 *     rebuilds v2 records (composedSha + inputs).
 *
 * Explicit + confirmed only: this function NEVER runs implicitly. The CLI
 * prompts on first `bakin agents sync`; the doctor offers it as a
 * requiresConfirmation repair item. Idempotent — a second run reports
 * `alreadyMigrated` and touches nothing.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { createLogger } from '../logger'
import { getContentDir } from '../content-dir'
import { appendAudit } from '../audit'
import { getAppServices } from '../app-services'
import {
  type PackageEntry,
  getLockfilePath,
  readLockfile,
  writeLockfile,
} from '../../../packages/core/src/agent-packages/lockfile'
import {
  MANAGED_BLOCK_ID,
  composeFileContent,
} from '../../../packages/core/src/agent-packages/composer'
import { listBlocks, removeBlock } from '../../../packages/core/src/agent-packages/managed-blocks'
import {
  COMPOSABLE_FILES,
  deriveExpectedBlocks,
  mainAgentOf,
  readInstalledManifest,
} from './sync-scanner'
import { syncAgent } from './sync'
import { seedContextFiles } from '../team-context'
import type { SyncReceipt } from './receipts'

const log = createLogger('agent-pkg:migrate')

export interface MigrationAgentResult {
  agentId: string
  state: 'managed' | 'unmanaged'
  /** Files whose content was fully replaced (managed agents). */
  filesOverwritten: string[]
  /** Legacy bakin block ids removed (unmanaged agents / leftovers). */
  legacyBlocksRemoved: string[]
  /** Receipt from the post-migration sync. */
  receipt?: SyncReceipt
  error?: string
}

export interface MigrationResult {
  alreadyMigrated: boolean
  backupPath: string | null
  agents: MigrationAgentResult[]
}

function entryNeedsMigration(entry: PackageEntry): boolean {
  return (entry.projections ?? []).some(
    (p) => p.kind === 'lesson-marker' || p.templateOnly === true
      || (p.kind === 'workspace-file' && !p.composedSha),
  )
}

function legacyBlockIds(content: string): string[] {
  return listBlocks(content)
    .map((b) => b.blockId)
    .filter((id) => id !== MANAGED_BLOCK_ID)
}

/**
 * Capture every agent's composable workspace files + the lockfile into a
 * tarball under ~/.bakin/.backups/. Content is read through the runtime
 * adapter (never raw runtime paths). Returns null when there was nothing
 * to capture.
 */
async function backupWorkspaces(agentIds: string[]): Promise<string | null> {
  const runtime = getAppServices().runtime
  const backupsDir = join(getContentDir(), '.backups')
  mkdirSync(backupsDir, { recursive: true, mode: 0o700 })
  const isoSafe = new Date().toISOString().replace(/[:.]/g, '-')
  const finalPath = join(backupsDir, `agent-migration-${isoSafe}.tar.gz`)
  const stagingDir = mkdtempSync(join(backupsDir, `.staging-${process.pid}-`))

  let captured = 0
  try {
    for (const agentId of agentIds) {
      for (const file of COMPOSABLE_FILES) {
        try {
          const ws = await runtime.agents.readWorkspaceFile(agentId, file)
          if (!ws) continue
          const dest = join(stagingDir, 'workspaces', agentId, file)
          mkdirSync(dirname(dest), { recursive: true })
          writeFileSync(dest, ws.content, 'utf-8')
          captured++
        } catch (err) {
          log.warn('Backup read failed — continuing', { agentId, file, error: String(err) })
        }
      }
    }
    const lockPath = getLockfilePath()
    if (existsSync(lockPath)) {
      const dest = join(stagingDir, 'packages', 'lock.json')
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, await Bun.file(lockPath).text(), 'utf-8')
      captured++
    }
    if (captured === 0) return null

    const proc = Bun.spawn(['tar', '-czf', finalPath, '-C', stagingDir, '.'])
    const exit = await proc.exited
    if (exit !== 0) throw new Error(`tar exited with ${exit}`)
    return finalPath
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}

export async function migrateToManagedBlocks(
  opts: { trigger?: 'cli' | 'rest' | 'system' } = {},
): Promise<MigrationResult> {
  const runtime = getAppServices().runtime
  const lock = readLockfile()
  const roster = await runtime.agents.list()
  const main = mainAgentOf(roster)

  const agentEntryByAgentId = new Map<string, { packageId: string; entry: PackageEntry }>()
  for (const [packageId, entry] of Object.entries(lock.packages)) {
    if (entry.kind === 'agent' && entry.agentId) {
      agentEntryByAgentId.set(entry.agentId, { packageId, entry })
    }
  }

  // Detect legacy state: lockfile shapes + leftover legacy blocks anywhere.
  const legacyPackageAgents = [...agentEntryByAgentId.entries()]
    .filter(([, v]) => entryNeedsMigration(v.entry))
    .map(([agentId]) => agentId)
  const unmanagedWithLegacyBlocks: string[] = []
  for (const agent of roster) {
    if (agentEntryByAgentId.has(agent.id)) continue
    for (const file of COMPOSABLE_FILES) {
      const ws = await runtime.agents.readWorkspaceFile(agent.id, file)
      if (ws && legacyBlockIds(ws.content).length > 0) {
        unmanagedWithLegacyBlocks.push(agent.id)
        break
      }
    }
  }

  if (legacyPackageAgents.length === 0 && unmanagedWithLegacyBlocks.length === 0) {
    return { alreadyMigrated: true, backupPath: null, agents: [] }
  }

  const allAgentIds = [...new Set([...roster.map((a) => a.id), ...agentEntryByAgentId.keys()])].sort()
  const backupPath = await backupWorkspaces(allAgentIds)
  log.info('Migration starting', {
    legacyPackages: legacyPackageAgents,
    unmanagedWithLegacyBlocks,
    backupPath,
  })

  seedContextFiles()
  const results: MigrationAgentResult[] = []

  // ── Managed agents with legacy lockfile shapes: full overwrite ────────────
  for (const agentId of legacyPackageAgents) {
    const { packageId, entry } = agentEntryByAgentId.get(agentId)!
    const result: MigrationAgentResult = {
      agentId,
      state: 'managed',
      filesOverwritten: [],
      legacyBlocksRemoved: [],
    }
    try {
      const pkg = readInstalledManifest(packageId, entry)
      if (!pkg) {
        throw new Error(
          `Installed source missing for "${packageId}" — re-fetch it (bakin agents sync ${agentId}) and re-run the migration.`,
        )
      }

      const agentName = roster.find((a) => a.id === agentId)?.name ?? agentId
      const expected = await deriveExpectedBlocks(
        { agentId, agentName, mainAgentId: main.id, mainAgentName: main.name },
        pkg,
      )

      // Record legacy blocks being destroyed (for the receipt), then
      // full-overwrite every file a layer contributes to.
      for (const exp of expected) {
        if (exp.body === null) continue
        const existing = await runtime.agents.readWorkspaceFile(agentId, exp.file)
        if (existing) result.legacyBlocksRemoved.push(...legacyBlockIds(existing.content))
        await runtime.agents.writeWorkspaceFile(agentId, {
          path: exp.file,
          content: composeFileContent('', exp.body),
        })
        result.filesOverwritten.push(exp.file)
      }

      // Drop legacy projection records; the sync below rebuilds v2 entries.
      const cleanedProjections = (entry.projections ?? []).filter(
        (p) => p.kind !== 'lesson-marker' && p.kind !== 'workspace-file',
      )
      const freshLock = readLockfile()
      writeLockfile({
        ...freshLock,
        packages: {
          ...freshLock.packages,
          [packageId]: { ...freshLock.packages[packageId], projections: cleanedProjections },
        },
      })

      result.receipt = await syncAgent(agentId, { fetch: false, trigger: opts.trigger ?? 'cli' })
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err)
      log.error('Migration failed for agent', err as Error, { agentId, packageId })
    }
    results.push(result)
  }

  // ── Unmanaged agents: swap legacy blocks for the composed block ───────────
  for (const agentId of unmanagedWithLegacyBlocks) {
    const result: MigrationAgentResult = {
      agentId,
      state: 'unmanaged',
      filesOverwritten: [],
      legacyBlocksRemoved: [],
    }
    try {
      for (const file of COMPOSABLE_FILES) {
        const ws = await runtime.agents.readWorkspaceFile(agentId, file)
        if (!ws) continue
        const legacy = legacyBlockIds(ws.content)
        if (legacy.length === 0) continue
        let next = ws.content
        for (const id of legacy) next = removeBlock(next, id)
        await runtime.agents.writeWorkspaceFile(agentId, { ...ws, content: next })
        result.legacyBlocksRemoved.push(...legacy)
      }
      result.receipt = await syncAgent(agentId, { fetch: false, trigger: opts.trigger ?? 'cli' })
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err)
      log.error('Migration failed for unmanaged agent', err as Error, { agentId })
    }
    results.push(result)
  }

  appendAudit(
    getContentDir(),
    'agent_pkg.migration_completed',
    'system',
    {
      backupPath,
      migrated: results.filter((r) => !r.error).map((r) => r.agentId),
      failed: results.filter((r) => r.error).map((r) => ({ agentId: r.agentId, error: r.error })),
    },
    opts.trigger ?? 'cli',
  )

  return { alreadyMigrated: false, backupPath, agents: results }
}
