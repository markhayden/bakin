/**
 * openclaw component — detects that OpenClaw is installed.
 *
 * OpenClaw is a **hard prerequisite**, not something Bakin manages. This
 * component is check-only — `install()` is a noop that always returns a
 * message pointing at the OpenClaw install docs. The orchestrator is
 * responsible for using the `missing`/`error` status from `check()` to
 * abort the remaining onboarding steps: without OpenClaw there is no
 * agent runtime, and everything downstream of this point (LLM keys,
 * channel config, credential discovery) would be meaningless.
 *
 * Detection criteria (all must hold for status: ok):
 * 1. The OpenClaw home directory exists (`$OPENCLAW_HOME` or ~/.openclaw/)
 * 2. The openclaw binary is discoverable on a well-known path
 * 3. `openclaw.json` parses as JSON
 *
 * If any one of those is missing we report `missing` (not `error`) and
 * leave the hard-stop decision to the orchestrator — a single `bakin check
 * openclaw` invocation should still be able to surface the same result
 * without hard-exiting the process.
 */
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createLogger } from '../logger'
import { getOpenClawHome, getOpenClawPath } from '@bakin/core/openclaw-home'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

const log = createLogger('onboarding:openclaw')

const INSTALL_URL = 'https://openclaw.ai/'
const INSTALL_MESSAGE = `OpenClaw is required. Install it from ${INSTALL_URL} and rerun onboarding.`

/**
 * Candidate paths for the openclaw binary, in order. Mirrors
 * `antfly-server.findBinary()` — same shape, different binary name.
 * Exported for tests so we can verify the candidate ordering without
 * touching the real filesystem.
 */
export function openClawBinaryCandidates(): string[] {
  return [
    process.env.OPENCLAW_PATH,
    '/opt/homebrew/bin/openclaw',
    '/usr/local/bin/openclaw',
    join(homedir(), '.openclaw', 'bin', 'openclaw'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
}

function findBinary(): string | null {
  for (const candidate of openClawBinaryCandidates()) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function check(): Promise<CheckResult> {
  const home = getOpenClawHome()
  if (!existsSync(home)) {
    return {
      name: 'openclaw',
      status: 'missing',
      message: `OpenClaw home directory not found at ${home}`,
      remediation: INSTALL_MESSAGE,
      details: { homeChecked: home, installUrl: INSTALL_URL },
    }
  }

  const binary = findBinary()
  if (!binary) {
    return {
      name: 'openclaw',
      status: 'missing',
      message: 'OpenClaw binary not found on any known install path',
      remediation: INSTALL_MESSAGE,
      details: {
        candidatesChecked: openClawBinaryCandidates(),
        homeChecked: home,
        installUrl: INSTALL_URL,
      },
    }
  }

  // openclaw.json is the file OpenClaw's own setup populates with channel
  // config, guild IDs, etc. Its presence is a good signal that OpenClaw
  // has been at least minimally configured, even if individual keys are
  // still empty (that's the `llm` and `channels` components' problem).
  const configPath = getOpenClawPath('openclaw.json')
  if (!existsSync(configPath)) {
    return {
      name: 'openclaw',
      status: 'broken',
      message: `OpenClaw is installed at ${binary} but ${configPath} is missing`,
      remediation: 'Run OpenClaw once to generate its default config, then rerun onboarding.',
      details: { binary, configPath, installUrl: INSTALL_URL },
    }
  }

  try {
    JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch (err) {
    return {
      name: 'openclaw',
      status: 'broken',
      message: `openclaw.json at ${configPath} is not valid JSON`,
      remediation: 'Fix or regenerate the file via OpenClaw, then rerun onboarding.',
      details: { binary, configPath, parseError: String(err) },
    }
  }

  return {
    name: 'openclaw',
    status: 'ok',
    message: `OpenClaw is installed at ${binary}`,
    details: { binary, home, configPath },
  }
}

async function install(_opts: OnboardingOptions): Promise<InstallResult> {
  // OpenClaw is never auto-installed by Bakin. Emit a noop with a helpful
  // message so the orchestrator can log it and exit cleanly.
  log.info('openclaw.install() is a noop — OpenClaw is a user-managed prerequisite')
  return {
    name: 'openclaw',
    status: 'noop',
    message: INSTALL_MESSAGE,
    durationMs: 0,
  }
}

export const openclawComponent: OnboardingComponent = {
  name: 'openclaw',
  check,
  install,
}

export const OPENCLAW_INSTALL_URL = INSTALL_URL
export const OPENCLAW_INSTALL_MESSAGE = INSTALL_MESSAGE
