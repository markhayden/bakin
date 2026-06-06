import { spawn } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { SearchAdapterSetupOptions } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import { antflyHome } from './paths'

/**
 * Detection + OPTIONAL disk-reclaim for pre-0.2 antfly leftovers.
 *
 * Nothing here is a prerequisite: Bakin's v0.2 world runs from its own
 * private data dir (~/.bakin/antfly) and the consolidated model root, so the
 * legacy dirs are dead weight at worst. Deletion is therefore housekeeping —
 * per-item consent, DEFAULT NO, and never under a blanket --yes:
 * `~/.antfly/data` may hold OTHER projects' tables (the pre-0.2 world shared
 * one global data dir), and silently deleting user data under autoApprove is
 * not a thing Bakin does. The brew-installed binary is only ever a printed
 * suggestion — Bakin does not invoke brew, even to clean up.
 */

export interface LegacyStateOverrides {
  termiteDir?: string
  brewBinaryCandidates?: string[]
}

export interface LegacyFinding {
  kind: 'termite-dir' | 'old-server-state' | 'brew-binary'
  path: string
  sizeHint: string
  /** Concrete paths a consented cleanup deletes (empty for suggestion-only findings). */
  removePaths: string[]
}

function defaultTermiteDir(): string {
  return join(homedir(), '.termite')
}

const DEFAULT_BREW_BINARY_CANDIDATES = [
  '/opt/homebrew/bin/antfly',
  '/usr/local/bin/antfly',
]

function duKb(path: string): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn('du', ['-sk', path], { stdio: ['ignore', 'pipe', 'ignore'] })
      let stdout = ''
      child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
      child.on('error', () => resolve(null))
      child.on('close', (code) => {
        if (code !== 0) return resolve(null)
        const kb = Number(stdout.trim().split(/\s+/)[0])
        resolve(Number.isFinite(kb) ? kb : null)
      })
    } catch {
      resolve(null)
    }
  })
}

function formatKb(kb: number | null): string {
  if (kb === null) return 'unknown size'
  if (kb >= 1024 * 1024) return `~${(kb / 1024 / 1024).toFixed(1)} GB`
  if (kb >= 1024) return `~${Math.round(kb / 1024)} MB`
  return `~${kb} KB`
}

async function sumSizeHint(paths: string[]): Promise<string> {
  let total = 0
  for (const p of paths) {
    const kb = await duKb(p)
    if (kb === null) return 'unknown size'
    total += kb
  }
  return formatKb(total)
}

/**
 * Pre-0.2 server artifacts the old Bakin-spawned antfly left in the shared
 * antfly home. `bakin-managed.yaml` is the config the old adapter wrote —
 * its presence proves the home was Bakin-managed, so the full artifact set
 * is offered for reclaim. Without the marker we stay conservative and only
 * offer the old data dir. bin/ (the new binary) and inference/ (the new
 * model root) are never candidates.
 */
const OLD_SERVER_ARTIFACTS = ['data', 'store', 'metadata', 'bakin-managed.yaml']

function oldServerStatePaths(): string[] {
  const home = antflyHome()
  const marker = join(home, 'bakin-managed.yaml')
  const candidates = existsSync(marker) ? OLD_SERVER_ARTIFACTS : ['data']
  return candidates.map((name) => join(home, name)).filter((p) => existsSync(p))
}

export async function detectLegacyState(overrides: LegacyStateOverrides = {}): Promise<LegacyFinding[]> {
  const findings: LegacyFinding[] = []

  const termiteDir = overrides.termiteDir ?? defaultTermiteDir()
  if (existsSync(termiteDir)) {
    findings.push({
      kind: 'termite-dir',
      path: termiteDir,
      sizeHint: await sumSizeHint([termiteDir]),
      removePaths: [termiteDir],
    })
  }

  // Bakin's v0.2 instance lives under ~/.bakin/antfly; pre-0.2 server state
  // in the shared antfly home predates the migration (or belongs to a
  // separate antfly install — which is exactly why deletion needs explicit
  // consent).
  const serverPaths = oldServerStatePaths()
  if (serverPaths.length > 0) {
    findings.push({
      kind: 'old-server-state',
      path: antflyHome(),
      sizeHint: await sumSizeHint(serverPaths),
      removePaths: serverPaths,
    })
  }

  const brewCandidates = overrides.brewBinaryCandidates ?? DEFAULT_BREW_BINARY_CANDIDATES
  for (const candidate of brewCandidates) {
    if (existsSync(candidate)) {
      findings.push({ kind: 'brew-binary', path: candidate, sizeHint: '', removePaths: [] })
      break
    }
  }

  return findings
}

export interface LegacyCleanupResult {
  findings: LegacyFinding[]
  removed: string[]
  /** Human-readable per-finding outcome lines for the install summary. */
  notes: string[]
}

export async function runLegacyCleanup(
  opts: SearchAdapterSetupOptions,
  logger: AdapterLogger,
  overrides: LegacyStateOverrides = {},
): Promise<LegacyCleanupResult> {
  const findings = await detectLegacyState(overrides)
  const removed: string[] = []
  const notes: string[] = []
  if (findings.length === 0) return { findings, removed, notes }

  // Deletions need a real interactive yes — a blanket --yes/autoApprove run
  // only reports. Default answer is always No.
  const canPrompt = opts.interactive && typeof opts.askYesNo === 'function'

  for (const finding of findings) {
    if (finding.kind === 'brew-binary') {
      notes.push(
        `Found a brew-installed antfly at ${finding.path} - Bakin no longer uses it. Remove it yourself with \`brew uninstall antfly\` (Bakin never runs brew).`,
      )
      continue
    }

    const artifactList = finding.removePaths.map((p) => p.replace(`${finding.path}/`, '')).join(', ')
    const description = finding.kind === 'termite-dir'
      ? `legacy model dir ${finding.path} (${finding.sizeHint})`
      : `pre-0.2 antfly server state under ${finding.path} (${artifactList} - ${finding.sizeHint})`

    if (!canPrompt) {
      notes.push(`Found ${description} - no longer used by Bakin. Re-run \`bakin install search\` interactively to reclaim the disk space.`)
      continue
    }

    const prompt = finding.kind === 'termite-dir'
      ? `Delete ${description}? It is no longer used by anything in the v0.2 world.`
      : `Delete ${description}? Bakin no longer uses it - but it holds ALL antfly data on this machine, not just Bakin's tables. If you use antfly for other projects, answer No and migrate them with antfly's backup/restore first.`

    const proceed = await opts.askYesNo!(prompt, false)
    if (!proceed) {
      notes.push(`Kept ${finding.path} (declined).`)
      continue
    }

    try {
      for (const target of finding.removePaths) {
        rmSync(target, { recursive: true, force: true })
        removed.push(target)
      }
      notes.push(`Removed ${finding.removePaths.length === 1 ? finding.removePaths[0] : `${finding.removePaths.length} paths under ${finding.path}`} (${finding.sizeHint}).`)
      logger.info('Removed legacy antfly state', { paths: finding.removePaths })
    } catch (err) {
      notes.push(`Failed to remove ${finding.path}: ${err instanceof Error ? err.message : String(err)}`)
      logger.warn('Legacy cleanup failed', { path: finding.path, err })
    }
  }

  return { findings, removed, notes }
}
