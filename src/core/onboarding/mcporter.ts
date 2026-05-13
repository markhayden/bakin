/**
 * mcporter component — thin wrapper around the existing src/core/mcporter
 * module. We intentionally do not duplicate the install logic; mcporter.ts
 * already exports `isMcporterInstalled()`, `installMcporter()`, and
 * `syncConfig()` which the server boot path and `bakin install mcporter`
 * both use. This component reuses them so the onboarding flow and the
 * existing code paths stay in sync.
 *
 * What this component adds:
 *   - A CheckResult/InstallResult surface for the T9 orchestrator
 *   - Interactive confirmation + non-interactive-requires-yes guard rails
 *     matching search/search-models
 *   - Post-install verification: the binary must be discoverable AND at
 *     least one per-agent entry must be present in ~/.mcporter/mcporter.json
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../logger'
import { isMcporterInstalled, installMcporterAsync, syncConfig } from '../mcporter'
import { askYesNo } from './prompts'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

const log = createLogger('onboarding:mcporter')

function mcporterConfigPath(): string {
  return join(process.env.HOME || '~', '.mcporter', 'mcporter.json')
}

function getPort(): number {
  return Number(process.env.PORT || 3737)
}

async function check(): Promise<CheckResult> {
  const installed = isMcporterInstalled()
  if (!installed) {
    return {
      name: 'mcporter',
      status: 'missing',
      message: 'mcporter binary not found on PATH',
      remediation: 'Run `bakin install mcporter` to install via `npm install -g mcporter`.',
    }
  }
  const configPath = mcporterConfigPath()
  if (!existsSync(configPath)) {
    return {
      name: 'mcporter',
      status: 'broken',
      message: `mcporter installed but ${configPath} is missing`,
      remediation: 'Run `bakin install mcporter` to seed the per-agent entries.',
      details: { configPath },
    }
  }
  return {
    name: 'mcporter',
    status: 'ok',
    message: `mcporter is installed and configured at ${configPath}`,
    details: { configPath, port: getPort() },
  }
}

async function install(opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()

  // Gate on user consent before shelling out to npm.
  const alreadyInstalled = isMcporterInstalled()
  if (!alreadyInstalled) {
    if (opts.interactive && !opts.autoApprove && opts.approvedComponents?.includes('mcporter') !== true) {
      const proceed = await askYesNo(
        'Install mcporter globally via `npm install -g mcporter`? Requires npm on PATH.',
        true
      )
      if (!proceed) {
        return {
          name: 'mcporter',
          status: 'skipped',
          message: 'User declined mcporter install.',
          durationMs: Date.now() - start,
        }
      }
    } else if (!opts.autoApprove && opts.approvedComponents?.includes('mcporter') !== true) {
      return {
        name: 'mcporter',
        status: 'skipped',
        message: 'Non-interactive run without --yes; skipping mcporter install.',
        durationMs: Date.now() - start,
      }
    }

    opts.onProgress?.('Installing mcporter package')
    log.info('Installing mcporter via npm install -g mcporter')
    const ok = await installMcporterAsync()
    if (!ok) {
      return {
        name: 'mcporter',
        status: 'failed',
        message: 'npm install -g mcporter failed — check that npm is on PATH and rerun.',
        durationMs: Date.now() - start,
      }
    }
    opts.onProgress?.('Verifying mcporter install')
    if (!isMcporterInstalled()) {
      return {
        name: 'mcporter',
        status: 'failed',
        message: 'npm reported success but mcporter is still not discoverable on PATH.',
        durationMs: Date.now() - start,
      }
    }
  }

  // Sync per-agent MCP server entries. syncConfig is already idempotent —
  // it only writes when the computed entries differ from what's on disk,
  // and it returns the list of changes it made.
  const port = getPort()
  let changes: string[]
  try {
    opts.onProgress?.('Syncing mcporter config')
    changes = await syncConfig(port)
  } catch (err) {
    log.error('Failed to sync mcporter config', err)
    return {
      name: 'mcporter',
      status: 'failed',
      message: `mcporter is installed but syncConfig failed: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
      durationMs: Date.now() - start,
    }
  }

  const durationMs = Date.now() - start
  if (alreadyInstalled && changes.length === 0) {
    return {
      name: 'mcporter',
      status: 'noop',
      message: 'mcporter already installed; config already up to date.',
      durationMs,
    }
  }

  log.info('mcporter ready', { changes, port, alreadyInstalled })
  return {
    name: 'mcporter',
    status: 'installed',
    message: alreadyInstalled
      ? `mcporter config synced (${changes.length} change${changes.length === 1 ? '' : 's'})`
      : `Installed mcporter and synced config (${changes.length} change${changes.length === 1 ? '' : 's'})`,
    durationMs,
  }
}

export const mcporterComponent: OnboardingComponent = {
  name: 'mcporter',
  check,
  install,
}

export const _internals = { mcporterConfigPath, getPort }
