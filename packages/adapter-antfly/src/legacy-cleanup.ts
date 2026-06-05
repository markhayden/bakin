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
  kind: 'termite-dir' | 'old-data-dir' | 'brew-binary'
  path: string
  sizeHint: string
}

function defaultTermiteDir(): string {
  return join(homedir(), '.termite')
}

const DEFAULT_BREW_BINARY_CANDIDATES = [
  '/opt/homebrew/bin/antfly',
  '/usr/local/bin/antfly',
]

function duSizeHint(dir: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const child = spawn('du', ['-sk', dir], { stdio: ['ignore', 'pipe', 'ignore'] })
      let stdout = ''
      child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
      child.on('error', () => resolve('unknown size'))
      child.on('close', (code) => {
        if (code !== 0) return resolve('unknown size')
        const kb = Number(stdout.trim().split(/\s+/)[0])
        if (!Number.isFinite(kb)) return resolve('unknown size')
        if (kb >= 1024 * 1024) return resolve(`~${(kb / 1024 / 1024).toFixed(1)} GB`)
        if (kb >= 1024) return resolve(`~${Math.round(kb / 1024)} MB`)
        return resolve(`~${kb} KB`)
      })
    } catch {
      resolve('unknown size')
    }
  })
}

export async function detectLegacyState(overrides: LegacyStateOverrides = {}): Promise<LegacyFinding[]> {
  const findings: LegacyFinding[] = []

  const termiteDir = overrides.termiteDir ?? defaultTermiteDir()
  if (existsSync(termiteDir)) {
    findings.push({ kind: 'termite-dir', path: termiteDir, sizeHint: await duSizeHint(termiteDir) })
  }

  // Bakin's v0.2 instance lives under ~/.bakin/antfly; anything in the old
  // shared ~/.antfly/data predates the migration (or belongs to a separate
  // antfly install — which is exactly why deletion needs explicit consent).
  const oldDataDir = join(antflyHome(), 'data')
  if (existsSync(oldDataDir)) {
    findings.push({ kind: 'old-data-dir', path: oldDataDir, sizeHint: await duSizeHint(oldDataDir) })
  }

  const brewCandidates = overrides.brewBinaryCandidates ?? DEFAULT_BREW_BINARY_CANDIDATES
  for (const candidate of brewCandidates) {
    if (existsSync(candidate)) {
      findings.push({ kind: 'brew-binary', path: candidate, sizeHint: '' })
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

    const description = finding.kind === 'termite-dir'
      ? `legacy model dir ${finding.path} (${finding.sizeHint})`
      : `pre-0.2 antfly data dir ${finding.path} (${finding.sizeHint})`

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
      rmSync(finding.path, { recursive: true, force: true })
      removed.push(finding.path)
      notes.push(`Removed ${finding.path} (${finding.sizeHint}).`)
      logger.info('Removed legacy antfly state', { path: finding.path })
    } catch (err) {
      notes.push(`Failed to remove ${finding.path}: ${err instanceof Error ? err.message : String(err)}`)
      logger.warn('Legacy cleanup failed', { path: finding.path, err })
    }
  }

  return { findings, removed, notes }
}
