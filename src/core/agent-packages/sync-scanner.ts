/**
 * Agent-sync drift scanner (layered-context spec, C4).
 *
 * Read-only: derives the EXPECTED state of every agent's managed blocks and
 * every package projection, compares against what's actually on disk / in
 * the runtime, and returns structured findings with per-input attribution.
 * No code path here writes anything — repair belongs to the sync engine
 * (C5) and the doctor repair handler (C7).
 *
 * Expected-state derivation:
 *   - context layers (global / role / team) via src/core/team-context
 *   - package template + lessons from the INSTALLED source dir under
 *     ~/.bakin/packages/agents/<id>@<ver>/ (never the network)
 *   - composition via the pure composer; staleness = sha(actual block body)
 *     != sha(expected block body), attributed by comparing each current
 *     input sha against the shas recorded in the lockfile at last
 *     projection.
 *
 * Local-only by design — upstream version drift is deliberately NOT a
 * finding here (user-initiated check/sync covers it).
 */
import { createHash } from 'crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../logger'
import { getContentDir } from '../content-dir'
import { getAppServices } from '../app-services'
import {
  type ComposableFile,
  type ComposeInputs,
  MANAGED_BLOCK_ID,
  composeManagedBlock,
} from '../../../packages/core/src/agent-packages/composer'
import {
  extractBlock,
  getBlockState,
} from '../../../packages/core/src/agent-packages/managed-blocks'
import {
  type Lockfile,
  type PackageEntry,
  PROJECTION_KIND_POLICY,
  type ProjectionEntry,
  type ProjectionInputs,
  readLockfile,
} from '../../../packages/core/src/agent-packages/lockfile'
import {
  computeDirSha,
  computeFileSha,
  isUserEdited,
  readInstalledBy,
} from '../../../packages/core/src/agent-packages/markers'
import {
  type AgentManifest,
  safeParseManifest,
} from '../../../packages/core/src/agent-packages/manifest'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import {
  isRoleContextCurrent,
  resolveContextInputs,
  type ContextAgentVars,
} from '../team-context'
import {
  lessonComposerEntries,
  readPackageLessons,
  resolveEnabledLessons,
} from './lesson-files'
import type { RuntimeAgent } from '@bakin/core/adapters/runtime'

const log = createLogger('agent-pkg:sync-scan')

export const COMPOSABLE_FILES: ComposableFile[] = ['SOUL.md', 'AGENTS.md', 'IDENTITY.md', 'TOOLS.md']

// ─── Finding model ───────────────────────────────────────────────────────────

export type SyncFindingType =
  | 'role-context-stale'
  | 'migration-needed'
  | 'source-missing'
  | 'file-missing'
  | 'block-missing'
  | 'block-stale'
  | 'block-broken'
  | 'skill-missing'
  | 'skill-drifted'
  | 'asset-missing'
  | 'asset-drifted'
  | 'user-edited'
  | 'broken-marker'

export type StaleInput = 'package' | 'global' | 'role' | 'team' | 'lessons' | 'tool-access' | 'in-place-edit'

/** Human-facing label for a stale input — runtime-aware for tool-access (P1.6). */
export function describeStaleInput(input: StaleInput): string {
  return input === 'tool-access' ? 'runtime tool access' : input
}

export interface SyncFinding {
  type: SyncFindingType
  severity: 'warn' | 'error'
  /** True when the local repair path (recompose / re-project) resolves it. */
  autoFixable: boolean
  message: string
  agentId?: string
  packageId?: string
  /** Workspace file name for block findings. */
  file?: string
  /** Projection target for skill/asset findings. */
  target?: string
  /** Which composition inputs changed since last projection (block-stale). */
  staleInputs?: StaleInput[]
  /** Suggested next action for non-auto-fixable findings. */
  hint?: string
}

export interface SyncScanReport {
  findings: SyncFinding[]
  agentsScanned: number
  blocksOk: number
  projectionsOk: number
  /** True when any lockfile entry predates block-based projection. */
  migrationNeeded: boolean
}

export interface SyncScanOptions {
  /** Restrict live workspace and package-projection reads to one agent. */
  agentId?: string
}

// ─── Expected-state derivation ───────────────────────────────────────────────

export function sha256OfString(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

export interface ExpectedBlock {
  file: ComposableFile
  /** Expected managed-block body; null = no block expected for this file. */
  body: string | null
  inputs: ProjectionInputs
}

export interface InstalledPackageSource {
  packageId: string
  manifest: AgentManifest
  sourceDir: string
  lessonsEnabled?: string[]
}

/** Read + validate the installed manifest for a lockfile entry, or null. */
export function readInstalledManifest(
  packageId: string,
  entry: PackageEntry,
): InstalledPackageSource | null {
  const id = packageId.includes('@') ? packageId.slice(0, packageId.lastIndexOf('@')) : packageId
  const sourceDir = getPackageSourceDir(getContentDir(), entry.kind, id, entry.version)
  const manifestPath = join(sourceDir, 'bakin-package.json')
  if (!existsSync(manifestPath)) return null
  const parsed = safeParseManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
  if (!parsed.success || parsed.data.kind !== 'agent') return null
  return {
    packageId,
    manifest: parsed.data,
    sourceDir,
    lessonsEnabled: entry.lessonsEnabled,
  }
}

function packageTemplateFor(
  pkg: InstalledPackageSource,
  file: ComposableFile,
): string | null {
  const rel = (pkg.manifest.contributions.workspaceFiles ?? []).find(
    (r) => r.split('/').pop() === file,
  )
  if (!rel) return null
  const abs = join(pkg.sourceDir, rel)
  if (!existsSync(abs)) return null
  return readFileSync(abs, 'utf-8')
}

/**
 * Derive the expected managed block for every workspace file of one agent.
 * `pkg` is undefined for unmanaged agents (context layers only).
 */
export async function deriveExpectedBlocks(
  vars: ContextAgentVars,
  pkg?: InstalledPackageSource,
): Promise<ExpectedBlock[]> {
  const context = await resolveContextInputs(vars)
  const out: ExpectedBlock[] = []

  for (const file of COMPOSABLE_FILES) {
    const inputs: ComposeInputs = {}
    const inputShas: ProjectionInputs = {}

    if (file === 'AGENTS.md') {
      if (context.global) {
        inputs.global = context.global
        inputShas.globalSha = sha256OfString(context.global)
      }
      if (context.role) {
        inputs.role = context.role
        inputShas.roleSha = sha256OfString(context.role.content)
      }
      if (context.toolAccess) {
        inputs.toolAccess = context.toolAccess
        inputShas.toolAccessSha = sha256OfString(context.toolAccess)
      }
      if (context.team) {
        inputs.team = context.team
        inputShas.teamSha = sha256OfString(context.team.content)
      }
    }

    if (pkg) {
      const template = packageTemplateFor(pkg, file)
      if (template !== null) {
        inputs.packageTemplate = { packageId: pkg.packageId, content: template }
        inputShas.packageSha = sha256OfString(template)
      }
      if (file === 'SOUL.md') {
        const lessons = readPackageLessons(pkg.manifest, pkg.sourceDir)
        if (lessons.length > 0) {
          const enabled = resolveEnabledLessons(pkg.manifest, lessons, pkg.lessonsEnabled)
          const entries = lessonComposerEntries(lessons, enabled)
          inputs.lessons = { packageId: pkg.manifest.id, entries }
          inputShas.lessonsSha = sha256OfString(
            JSON.stringify(entries.map((e) => [e.id, e.enabled, sha256OfString(e.body ?? '')])),
          )
        }
      }
    }

    out.push({ file, body: composeManagedBlock(file, inputs), inputs: inputShas })
  }

  return out
}

// ─── Per-finding helpers ─────────────────────────────────────────────────────

function attributeStaleness(
  recorded: ProjectionInputs | undefined,
  current: ProjectionInputs,
  recordedComposedSha: string | undefined,
  actualBodySha: string,
): StaleInput[] {
  if (!recorded) return []
  const stale: StaleInput[] = []
  const keys: Array<[keyof ProjectionInputs, StaleInput]> = [
    ['packageSha', 'package'],
    ['globalSha', 'global'],
    ['roleSha', 'role'],
    ['teamSha', 'team'],
    ['lessonsSha', 'lessons'],
    ['toolAccessSha', 'tool-access'],
  ]
  for (const [key, label] of keys) {
    if ((recorded[key] ?? null) !== (current[key] ?? null)) stale.push(label)
  }
  if (stale.length === 0 && recordedComposedSha && recordedComposedSha !== actualBodySha) {
    // No input changed, but the block on disk differs from what we last
    // wrote — something edited inside the managed block.
    stale.push('in-place-edit')
  }
  return stale
}

interface RuntimeSkillFiles {
  [rel: string]: string
}

/**
 * Recompute the projector's directory sha from a runtime skill's in-memory
 * files map. Component-wise path sort reproduces computeDirSha's walk order.
 */
export function computeFilesMapSha(files: RuntimeSkillFiles): string {
  const rels = Object.keys(files).sort((a, b) => {
    const as = a.split('/')
    const bs = b.split('/')
    for (let i = 0; i < Math.max(as.length, bs.length); i++) {
      if (as[i] === undefined) return -1
      if (bs[i] === undefined) return 1
      const cmp = as[i].localeCompare(bs[i])
      if (cmp !== 0) return cmp
    }
    return 0
  })
  const lines = rels.map((rel) => `${rel}\n${sha256OfString(files[rel])}\n`)
  return createHash('sha256').update(lines.join('')).digest('hex')
}

type ParsedRuntimeTarget =
  | { kind: 'workspace-file'; agentId: string; path: string }
  | { kind: 'agent-skill'; agentId: string; name: string }
  | { kind: 'global-skill'; name: string }
  | null

function parseRuntimeTarget(target: string): ParsedRuntimeTarget {
  const parts = target.split(':')
  if (parts[0] !== 'runtime') return null
  if (parts[1] === 'workspace-file' && parts.length === 4) {
    return { kind: 'workspace-file', agentId: decodeURIComponent(parts[2]), path: decodeURIComponent(parts[3]) }
  }
  if (parts[1] === 'agent-skill' && parts.length === 4) {
    return { kind: 'agent-skill', agentId: decodeURIComponent(parts[2]), name: decodeURIComponent(parts[3]) }
  }
  if (parts[1] === 'global-skill' && parts.length === 3) {
    return { kind: 'global-skill', name: decodeURIComponent(parts[2]) }
  }
  return null
}

function entryNeedsMigration(entry: PackageEntry): boolean {
  return (entry.projections ?? []).some(
    (p) => p.kind === 'lesson-marker' || p.templateOnly === true
      || (p.kind === 'workspace-file' && !p.composedSha),
  )
}

export function mainAgentOf(agents: RuntimeAgent[]): { id: string; name: string } {
  const main = agents.find((a) => a.id === 'main')
    ?? agents.find((a) => a.role?.toLowerCase() === 'orchestrator')
    ?? agents[0]
  return { id: main?.id ?? 'main', name: main?.name ?? 'Main' }
}

// ─── Scanner ─────────────────────────────────────────────────────────────────

export async function scanAgentSync(
  lockfile?: Lockfile,
  options: SyncScanOptions = {},
): Promise<SyncScanReport> {
  const report: SyncScanReport = {
    findings: [],
    agentsScanned: 0,
    blocksOk: 0,
    projectionsOk: 0,
    migrationNeeded: false,
  }
  const lock = lockfile ?? readLockfile()
  const runtime = getAppServices().runtime
  const packageEntries = Object.entries(lock.packages)
  const scoped = options.agentId !== undefined
  const entriesToScan = scoped
    ? packageEntries.filter(([, entry]) => entry.kind === 'agent' && entry.agentId === options.agentId)
    : packageEntries

  // 1. Role context files current vs shipped defaults.
  // These findings are fleet-wide and have no agent attribution, so they do
  // not belong in a single-agent Diagnostics response.
  if (!scoped) {
    for (const role of ['orchestrator', 'subagent'] as const) {
      if (!isRoleContextCurrent(role)) {
        report.findings.push({
          type: 'role-context-stale',
          severity: 'warn',
          autoFixable: true,
          message: `Role context roles/${role}.md is missing or its managed block differs from the shipped defaults`,
        })
      }
    }
  }

  // 2. Lockfile-level checks: migration shape + installed source presence.
  const agentEntryByAgentId = new Map<string, { packageId: string; entry: PackageEntry }>()
  for (const [packageId, entry] of entriesToScan) {
    if (entry.kind === 'agent' && entry.agentId) {
      agentEntryByAgentId.set(entry.agentId, { packageId, entry })
    }

    if (entryNeedsMigration(entry)) {
      report.migrationNeeded = true
      report.findings.push({
        type: 'migration-needed',
        severity: 'warn',
        autoFixable: false,
        packageId,
        agentId: entry.agentId,
        message: `Package "${packageId}" predates block-based projection — one-time migration required`,
        hint: 'Run `bakin agents sync` and confirm the migration prompt.',
      })
    }

    const id = packageId.includes('@') ? packageId.slice(0, packageId.lastIndexOf('@')) : packageId
    const sourceDir = getPackageSourceDir(getContentDir(), entry.kind, id, entry.version)
    if (!existsSync(sourceDir)) {
      report.findings.push({
        type: 'source-missing',
        severity: 'error',
        autoFixable: false,
        packageId,
        agentId: entry.agentId,
        message: `Installed source dir missing for "${packageId}" (${sourceDir})`,
        hint: `Run \`bakin agents sync ${entry.agentId ?? packageId}\` to re-fetch.`,
      })
    }
  }

  // 3. Per-agent managed-block checks.
  let agents: RuntimeAgent[] = []
  try {
    agents = await runtime.agents.list()
  } catch (err) {
    report.findings.push({
      type: 'file-missing',
      severity: 'error',
      autoFixable: false,
      agentId: options.agentId,
      message: `Failed to list runtime agents: ${err instanceof Error ? err.message : String(err)}`,
    })
    return report
  }

  const main = mainAgentOf(agents)
  const agentsToScan = scoped
    ? agents.filter((agent) => agent.id === options.agentId)
    : agents

  for (const agent of agentsToScan) {
    report.agentsScanned++
    const owner = agentEntryByAgentId.get(agent.id)

    // Pre-migration packages are EXPECTED to be stale block-wise — the
    // migration finding already covers them; per-file noise helps nobody.
    if (owner && entryNeedsMigration(owner.entry)) continue

    const pkg = owner ? readInstalledManifest(owner.packageId, owner.entry) ?? undefined : undefined
    const vars: ContextAgentVars = {
      agentId: agent.id,
      agentName: agent.name ?? agent.id,
      mainAgentId: main.id,
      mainAgentName: main.name,
    }

    const recordedByFile = new Map<string, ProjectionEntry>()
    for (const p of owner?.entry.projections ?? []) {
      if (p.kind !== 'workspace-file') continue
      const parsed = parseRuntimeTarget(p.target)
      if (parsed?.kind === 'workspace-file') recordedByFile.set(parsed.path, p)
    }

    const expected = await deriveExpectedBlocks(vars, pkg)
    for (const exp of expected) {
      if (exp.body === null) continue // nothing expected for this file

      const file = await runtime.agents.readWorkspaceFile(agent.id, exp.file)
      if (!file) {
        report.findings.push({
          type: 'file-missing',
          severity: owner ? 'error' : 'warn',
          autoFixable: true,
          agentId: agent.id,
          packageId: owner?.packageId,
          file: exp.file,
          message: `${agent.id}/${exp.file} is missing (managed block expected)`,
        })
        continue
      }

      const state = getBlockState(file.content, MANAGED_BLOCK_ID)
      if (state === 'orphan-start' || state === 'orphan-end') {
        report.findings.push({
          type: 'block-broken',
          severity: 'error',
          autoFixable: false,
          agentId: agent.id,
          packageId: owner?.packageId,
          file: exp.file,
          message: `${agent.id}/${exp.file} has malformed managed-block markers (${state}) — manual fix required`,
        })
        continue
      }
      if (state === 'absent') {
        report.findings.push({
          type: 'block-missing',
          severity: 'warn',
          autoFixable: true,
          agentId: agent.id,
          packageId: owner?.packageId,
          file: exp.file,
          message: `${agent.id}/${exp.file} has no managed block yet`,
        })
        continue
      }

      const actual = extractBlock(file.content, MANAGED_BLOCK_ID) ?? ''
      if (actual === exp.body.trim()) {
        report.blocksOk++
        continue
      }

      const recorded = recordedByFile.get(exp.file)
      const staleInputs = attributeStaleness(
        recorded?.inputs,
        exp.inputs,
        recorded?.composedSha,
        sha256OfString(actual),
      )
      report.findings.push({
        type: 'block-stale',
        severity: 'warn',
        autoFixable: true,
        agentId: agent.id,
        packageId: owner?.packageId,
        file: exp.file,
        staleInputs,
        message: staleInputs.length > 0
          ? `${agent.id}/${exp.file} managed block is stale (changed: ${staleInputs.map(describeStaleInput).join(', ')})`
          : `${agent.id}/${exp.file} managed block differs from expected composition`,
      })
    }
  }

  // 4. Skill + asset projections from the lockfile.
  for (const [packageId, entry] of entriesToScan) {
    for (const p of entry.projections ?? []) {
      if (p.kind === 'workspace-file' || p.kind === 'lesson-marker') continue
      // npm payloads + models are OWNED by the capability-readiness engine
      // (presence + remediation; doctor inherits) — content-hashing them
      // here is a permanent false positive: a payload contains node_modules
      // + a generated package.json the pack source never had, and re-hashing
      // ~GB models every scan is real cost. Bins stay: tamper detection
      // belongs here (repair self-heals), with archive bins compared against
      // the marker's extractedSha256 below.
      if (p.kind === 'npm-payload' || p.kind === 'model') continue

      // Seed-once kinds (personas today) are user-owned after projection: no
      // .installedBy sidecar, edits are expected, uninstall leaves them
      // behind. Only their absence is actionable (sync re-seeds per the
      // only-when-missing contract) — marker and drift checks would be
      // permanent false positives. Policy lives in PROJECTION_KIND_POLICY.
      if (PROJECTION_KIND_POLICY[p.kind].seedOnce) {
        if (!existsSync(p.target)) {
          report.findings.push({
            type: 'asset-missing',
            severity: 'warn',
            autoFixable: true,
            packageId,
            agentId: entry.agentId,
            target: p.target,
            message: `Seed-once file missing (sync will re-seed it): ${p.target}`,
          })
        } else {
          report.projectionsOk++
        }
        continue
      }

      const parsed = parseRuntimeTarget(p.target)
      if (parsed?.kind === 'agent-skill' || parsed?.kind === 'global-skill') {
        const agentId = parsed.kind === 'agent-skill' ? parsed.agentId : undefined
        let skill = null
        try {
          skill = await runtime.skills.get(parsed.name, agentId)
        } catch (err) {
          log.warn('Skill read failed during scan', { target: p.target, error: String(err) })
        }
        if (!skill) {
          report.findings.push({
            type: 'skill-missing',
            severity: 'error',
            autoFixable: true,
            packageId,
            agentId: agentId ?? entry.agentId,
            target: p.target,
            message: `Skill "${parsed.name}" is missing from the runtime skill store`,
          })
          continue
        }
        if (skill.metadata?.userEdited === true) {
          report.findings.push({
            type: 'user-edited',
            severity: 'warn',
            autoFixable: false,
            packageId,
            agentId: agentId ?? entry.agentId,
            target: p.target,
            message: `Skill "${parsed.name}" is user-edited — sync will skip it`,
            hint: `Reclaim with \`bakin agents sync ${entry.agentId ?? packageId} --reclaim ${parsed.name}\` to discard local edits.`,
          })
          continue
        }
        // Strict verbatim hash of the adapter-reported files map — the map
        // MUST include SKILL.md (adapters guarantee it; Pi's exclusion was
        // the bug, fixed adapter-side so every skill.files consumer heals).
        const actualSha = computeFilesMapSha((skill.files ?? {}) as RuntimeSkillFiles)
        if (p.sha256 && actualSha !== p.sha256) {
          report.findings.push({
            type: 'skill-drifted',
            severity: 'warn',
            autoFixable: true,
            packageId,
            agentId: agentId ?? entry.agentId,
            target: p.target,
            message: `Skill "${parsed.name}" differs from the installed package source`,
          })
          continue
        }
        report.projectionsOk++
        continue
      }

      // Disk assets (and any legacy disk-path projections).
      if (!existsSync(p.target)) {
        report.findings.push({
          type: 'asset-missing',
          severity: 'error',
          autoFixable: true,
          packageId,
          agentId: entry.agentId,
          target: p.target,
          message: `Projected file missing: ${p.target}`,
        })
        continue
      }
      if (isUserEdited(p.target)) {
        report.findings.push({
          type: 'user-edited',
          severity: 'warn',
          autoFixable: false,
          packageId,
          agentId: entry.agentId,
          target: p.target,
          message: `${p.target} is user-edited — sync will skip it`,
          hint: `Reclaim with \`bakin agents sync ${entry.agentId ?? packageId} --reclaim ${p.target}\` to discard local edits.`,
        })
        continue
      }
      const marker = readInstalledBy(p.target)
      if (!marker) {
        report.findings.push({
          type: 'broken-marker',
          severity: 'warn',
          autoFixable: true,
          packageId,
          agentId: entry.agentId,
          target: p.target,
          message: `${p.target} lost its .installedBy provenance marker`,
        })
        continue
      }
      const actualSha = statSync(p.target).isDirectory() ? computeDirSha(p.target) : computeFileSha(p.target)
      // Archive-sourced bins: the projection/marker sha pins the TARBALL —
      // the on-disk binary compares against the marker's extracted hash.
      const expectedSha = p.kind === 'bin' && marker.extractedSha256 ? marker.extractedSha256 : marker.sha256
      const rowShaMismatch = p.kind === 'bin' && marker.extractedSha256 ? false : Boolean(p.sha256 && actualSha !== p.sha256)
      if (rowShaMismatch || expectedSha !== actualSha) {
        report.findings.push({
          type: 'asset-drifted',
          severity: 'warn',
          autoFixable: true,
          packageId,
          agentId: entry.agentId,
          target: p.target,
          message: `${p.target} differs from the installed package source`,
        })
        continue
      }
      report.projectionsOk++
    }
  }

  return report
}
