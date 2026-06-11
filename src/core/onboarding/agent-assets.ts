/**
 * agent-assets onboarding component.
 *
 * Mirrors the plugin-assets component (S-B in the workflows-plugin spec)
 * but for installed agent-packages. Detects:
 *   - Missing projections — lockfile says X exists at Y, filesystem says
 *     it doesn't. Common after a hand-edit that wiped a workspace dir.
 *   - Drifted projections — sha mismatch between recorded `.installedBy`
 *     marker and the file's actual sha. Common when a process other than
 *     Bakin (the agent itself, an editor, sync software) modified a
 *     projected file.
 *   - User-edited projections — files marked `.userEdited`. Reported but
 *     never repaired.
 *
 * `check()` reports per-package counts. `install()` repairs missing +
 * drifted via the projector's update-mode path; `.userEdited` is honored
 * always. Repair never touches workspace files unless --refresh-template
 * was passed (which this component doesn't support — re-installs that
 * via `bakin agents update <id> --refresh-template` instead).
 *
 * Phase F-3 surface: this is the user-facing entry point. Phase I-1's
 * doctor sweep will lift the same drift-detection helpers into
 * `bakin doctor` so the same data backs both views.
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../logger'
import { getContentDir } from '../content-dir'
import {
  computeDirSha,
  computeFileSha,
  isUserEdited,
  readInstalledBy,
} from '../../../packages/core/src/agent-packages/markers'
import {
  type Lockfile,
  type ProjectionEntry,
  readLockfile,
} from '../../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import {
  hasBlock,
} from '../../../packages/core/src/agent-packages/managed-blocks'
import { updatePackageById } from '../agent-packages/updater'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

const log = createLogger('onboarding:agent-assets')

interface ProjectionFinding {
  packageId: string
  projection: ProjectionEntry
  status: 'ok' | 'missing' | 'drifted' | 'userEdited' | 'broken-marker'
}

interface ScanReport {
  totalProjections: number
  ok: ProjectionFinding[]
  missing: ProjectionFinding[]
  drifted: ProjectionFinding[]
  userEdited: ProjectionFinding[]
  brokenMarker: ProjectionFinding[]
  /** Lockfile entries whose source dir under ~/.bakin/packages/ is gone. */
  packagesWithMissingSource: string[]
}

function emptyReport(): ScanReport {
  return {
    totalProjections: 0,
    ok: [],
    missing: [],
    drifted: [],
    userEdited: [],
    brokenMarker: [],
    packagesWithMissingSource: [],
  }
}

function isRuntimeWorkspaceTarget(target: string): boolean {
  return target.startsWith('runtime:workspace-file:')
}

/**
 * Walk every projection in the lockfile and classify each. Pure read —
 * never mutates the filesystem. Drift checks honor `.userEdited` so a
 * user-locked file is reported as 'userEdited', not 'drifted'.
 */
export function scanAgentAssets(lockfile?: Lockfile): ScanReport {
  const report = emptyReport()
  const lock = lockfile ?? readLockfile()

  for (const [pkgId, entry] of Object.entries(lock.packages)) {
    // Per-package source-dir presence check — informational, not a per-projection finding.
    const installDir = getPackageSourceDir(getContentDir(), entry.kind, stripVersionFromKey(pkgId), entry.version)
    if (!existsSync(installDir)) {
      report.packagesWithMissingSource.push(pkgId)
    }

    for (const p of entry.projections ?? []) {
      report.totalProjections++
      const finding: ProjectionFinding = { packageId: pkgId, projection: p, status: 'ok' }

      // Lesson-marker projections live inside SOUL.md; classified by
      // marker presence rather than sha.
      if (p.kind === 'lesson-marker') {
        if (isRuntimeWorkspaceTarget(p.target)) {
          report.ok.push(finding)
          continue
        }
        if (!existsSync(p.target)) {
          finding.status = 'missing'
          report.missing.push(finding)
          continue
        }
        if (isUserEdited(p.target)) {
          finding.status = 'userEdited'
          report.userEdited.push(finding)
          continue
        }
        const blockId = p.blockId ?? ''
        const content = readFileSync(p.target, 'utf-8')
        if (!hasBlock(content, blockId)) {
          finding.status = 'missing'
          report.missing.push(finding)
        } else {
          report.ok.push(finding)
        }
        continue
      }

      // Runtime workspace-file projections (legacy templateOnly AND the new
      // composed-block shape) are verified by the sync scanner, not here —
      // this component is superseded by `agent-sync` in C7.
      if (p.kind === 'workspace-file' && isRuntimeWorkspaceTarget(p.target)) {
        report.ok.push(finding)
        continue
      }

      if (!existsSync(p.target)) {
        finding.status = 'missing'
        report.missing.push(finding)
        continue
      }

      if (isUserEdited(p.target)) {
        finding.status = 'userEdited'
        report.userEdited.push(finding)
        continue
      }

      // Workspace-file projections with templateOnly=true are inherently
      // agent-mutable — SOUL.md gets lesson markers injected after the
      // initial template write, IDENTITY.md/AGENTS.md/TOOLS.md are owned
      // by the agent after install. We only check existence + sidecar
      // presence for these; sha drift is expected and managed by other
      // tools (`bakin agents update --refresh-template` for explicit
      // template refresh).
      if (p.kind === 'workspace-file' && p.templateOnly) {
        const marker = readInstalledBy(p.target)
        if (!marker) {
          finding.status = 'broken-marker'
          report.brokenMarker.push(finding)
        } else {
          report.ok.push(finding)
        }
        continue
      }

      const marker = readInstalledBy(p.target)
      if (!marker) {
        finding.status = 'broken-marker'
        report.brokenMarker.push(finding)
        continue
      }

      const isDir = statSync(p.target).isDirectory()
      const actualSha = isDir ? computeDirSha(p.target) : computeFileSha(p.target)
      if (p.sha256 && actualSha !== p.sha256) {
        finding.status = 'drifted'
        report.drifted.push(finding)
      } else if (marker.sha256 !== actualSha) {
        // Marker sha mismatches the actual file — drift between marker
        // and content. Treat as drift; doctor will fix.
        finding.status = 'drifted'
        report.drifted.push(finding)
      } else {
        report.ok.push(finding)
      }
    }
  }

  return report
}

function stripVersionFromKey(key: string): string {
  const at = key.lastIndexOf('@')
  return at === -1 ? key : key.slice(0, at)
}

// ─── OnboardingComponent surface ─────────────────────────────────────────────

async function check(): Promise<CheckResult> {
  let report: ScanReport
  try {
    report = scanAgentAssets()
  } catch (err) {
    return {
      name: 'agent-assets',
      status: 'error',
      message: `Failed to scan agent assets: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (report.totalProjections === 0) {
    return {
      name: 'agent-assets',
      status: 'ok',
      message: '0 agent-package projections (no agent or pack installed yet)',
      details: { totalProjections: 0 },
    }
  }

  const pending = report.missing.length + report.drifted.length + report.brokenMarker.length

  if (pending === 0) {
    const userEditedNote = report.userEdited.length > 0
      ? ` (${report.userEdited.length} user-edited, locked)`
      : ''
    return {
      name: 'agent-assets',
      status: 'ok',
      message: `All ${report.totalProjections} agent-package projection(s) installed${userEditedNote}`,
      details: report as unknown as Record<string, unknown>,
    }
  }

  const parts: string[] = []
  if (report.missing.length > 0) parts.push(`${report.missing.length} missing`)
  if (report.drifted.length > 0) parts.push(`${report.drifted.length} drifted`)
  if (report.brokenMarker.length > 0) parts.push(`${report.brokenMarker.length} broken markers`)

  return {
    name: 'agent-assets',
    status: 'warn',
    message: `${pending} agent-package projection(s) need repair (${parts.join(', ')})`,
    remediation: 'Run `bakin install agent-assets` to repair drift. User-edited files stay untouched.',
    details: report as unknown as Record<string, unknown>,
  }
}

async function install(_opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()
  const report = scanAgentAssets()

  if (report.totalProjections === 0) {
    return {
      name: 'agent-assets',
      status: 'noop',
      message: '0 agent-package projections to install',
      durationMs: Date.now() - start,
    }
  }

  const needsRepair = new Set([
    ...report.missing.map((f) => f.packageId),
    ...report.drifted.map((f) => f.packageId),
    ...report.brokenMarker.map((f) => f.packageId),
  ])

  if (needsRepair.size === 0) {
    return {
      name: 'agent-assets',
      status: 'noop',
      message: `All ${report.totalProjections} agent-package projection(s) already up to date`,
      durationMs: Date.now() - start,
    }
  }

  const repaired: string[] = []
  const failed: { packageId: string; error: string }[] = []

  for (const packageId of needsRepair) {
    try {
      // Run the standard update flow. With local-source packages it
      // re-projects unconditionally; with github-source packages it
      // re-projects when the recorded commit SHA matches a forced fresh
      // re-fetch (which it won't — but the side effect of re-projection
      // is what we want). For a simpler V1 path, the doctor sweep in
      // Phase I-1 will gain a dedicated drift-repair helper that doesn't
      // depend on update-mode semantics.
      await updatePackageById({ packageId })
      repaired.push(packageId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failed.push({ packageId, error: message })
      log.warn('agent-assets repair failed for package', { packageId, error: message })
    }
  }

  const durationMs = Date.now() - start
  if (failed.length > 0 && repaired.length === 0) {
    return {
      name: 'agent-assets',
      status: 'failed',
      message: `Failed to repair ${failed.length} package(s): ${failed.map((f) => f.packageId).join(', ')}`,
      durationMs,
      error: failed,
    }
  }

  const failedNote = failed.length > 0 ? ` (failed: ${failed.length})` : ''
  return {
    name: 'agent-assets',
    status: 'installed',
    message: `Repaired ${repaired.length} agent-package projection(s)${failedNote}`,
    durationMs,
  }
}

void join // silence unused-import warning (types-only)
export const agentAssetsComponent: OnboardingComponent = {
  name: 'agent-assets',
  check,
  install,
}
