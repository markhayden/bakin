/**
 * antfly component — installs the AntflyDB binary via Homebrew.
 *
 * check() reuses `findBinary()` from antfly-server so the discovery
 * logic stays in one place (env var → /opt/homebrew/bin → /usr/local/bin
 * → ~/.antfly/bin). install() shells out to `brew install --cask
 * antflydb/antfly/antfly` via child_process.spawn — never with
 * `shell: true`, arguments always passed as an array.
 *
 * If Homebrew itself is not on the machine we return `failed` with a
 * human-readable message pointing at the upstream install docs rather
 * than silently swallowing the failure. The Antfly install is a large
 * download, so we also refuse to proceed in non-interactive mode unless
 * `autoApprove` is true — keeps `bakin onboard --check` honest.
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { createLogger } from '../logger'
import { findBinary } from '../antfly-server'
import { askYesNo } from './prompts'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

const log = createLogger('onboarding:antfly')

const BREW_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']
const BREW_CASK = 'antflydb/antfly/antfly'
const BREW_INSTALL_DOCS = 'https://brew.sh/'

function findBrew(): string | null {
  for (const candidate of BREW_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function check(): Promise<CheckResult> {
  const binary = findBinary()
  if (binary) {
    return {
      name: 'antfly',
      status: 'ok',
      message: `Antfly is installed at ${binary}`,
      details: { binary },
    }
  }
  return {
    name: 'antfly',
    status: 'missing',
    message: 'Antfly binary not found on any known install path',
    remediation: `Run \`bakin install antfly\` to install via Homebrew (${BREW_CASK}).`,
  }
}

/**
 * Stream a subprocess to completion, forwarding stdout/stderr to the
 * parent TTY when interactive (so the user sees brew's download
 * progress) or collecting them as strings when not. Returns the exit
 * code. Never uses `shell: true`.
 */
function runSpawn(
  cmd: string,
  args: string[],
  opts: { interactive: boolean }
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    if (!opts.interactive) {
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString()
      })
    }
    child.on('error', (err) => reject(err))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function install(opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()

  // Already installed? Short-circuit. The orchestrator calls check() up
  // front anyway, but we re-verify here because an individual CLI
  // invocation (`bakin install antfly`) may be run standalone.
  const existing = findBinary()
  if (existing) {
    return {
      name: 'antfly',
      status: 'noop',
      message: `Antfly is already installed at ${existing}`,
      durationMs: Date.now() - start,
    }
  }

  const brew = findBrew()
  if (!brew) {
    return {
      name: 'antfly',
      status: 'failed',
      message: `Homebrew not found at ${BREW_CANDIDATES.join(' or ')}. Install Homebrew first (${BREW_INSTALL_DOCS}) and rerun, or install Antfly manually.`,
      durationMs: Date.now() - start,
    }
  }

  // Confirm with the user unless they've passed --yes. Bakin should
  // never run a ~25MB download without consent.
  if (opts.interactive && !opts.autoApprove) {
    const proceed = await askYesNo(
      `Install Antfly via Homebrew? This will download ~25MB and run \`brew install --cask ${BREW_CASK}\`.`,
      true
    )
    if (!proceed) {
      return {
        name: 'antfly',
        status: 'skipped',
        message: 'User declined Antfly install.',
        durationMs: Date.now() - start,
      }
    }
  } else if (!opts.autoApprove) {
    // Non-interactive + no --yes = refuse. Keeps `bakin onboard --check`
    // honest — it should never install anything.
    return {
      name: 'antfly',
      status: 'skipped',
      message: 'Non-interactive run without --yes; skipping Antfly install.',
      durationMs: Date.now() - start,
    }
  }

  log.info('Installing Antfly via brew', { brew, cask: BREW_CASK })
  try {
    const { code, stderr } = await runSpawn(
      brew,
      ['install', '--cask', BREW_CASK],
      { interactive: opts.interactive && !opts.json }
    )
    const durationMs = Date.now() - start
    if (code !== 0) {
      return {
        name: 'antfly',
        status: 'failed',
        message: `brew install exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
        durationMs,
      }
    }
    // Verify the binary is now discoverable.
    const installed = findBinary()
    if (!installed) {
      return {
        name: 'antfly',
        status: 'failed',
        message: 'brew install reported success but antfly binary is still not discoverable',
        durationMs,
      }
    }
    log.info('Antfly installed successfully', { binary: installed, durationMs })
    return {
      name: 'antfly',
      status: 'installed',
      message: `Installed Antfly to ${installed}`,
      durationMs,
    }
  } catch (err) {
    log.error('Failed to spawn brew', err)
    return {
      name: 'antfly',
      status: 'failed',
      message: `Failed to run brew install: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
      durationMs: Date.now() - start,
    }
  }
}

export const antflyComponent: OnboardingComponent = {
  name: 'antfly',
  check,
  install,
}

// Exported for testability of the brew discovery path without re-import games.
export const _internals = { findBrew, runSpawn, BREW_CASK, BREW_CANDIDATES }
