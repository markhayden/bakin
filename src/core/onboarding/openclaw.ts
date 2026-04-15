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
import { readOpenClawConfig, resetOpenClawConfigCache } from '@bakin/core/openclaw-config'
import type { OpenClawConfig } from '@bakin/core/openclaw-config'
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

/**
 * Reports-only integrity validator for a parsed openclaw.json.
 *
 * After issue #90, we rely on the invariant that OpenClaw's orchestrator
 * lives at `id: "main"` in every install, that agent ids are unique, and
 * that no two agents resolve to the same workspace (otherwise Bakin's
 * adapter cannot distinguish them). This scan collects *every* violation
 * so the user sees the whole picture on one run of `bakin check openclaw`
 * instead of playing whack-a-mole.
 *
 * **Never mutates openclaw.json.** Section 7 of the issue-90 spec is
 * explicit: doctor and migration code must never auto-write OpenClaw's
 * config. The user owns that file and decides how to fix it.
 */
export function validateOpenClawIntegrity(config: OpenClawConfig | null): string[] {
  const issues: string[] = []
  if (!config) return issues

  const list = Array.isArray(config.agents?.list) ? config.agents!.list! : []

  // 1. Missing main — OpenClaw's orchestrator id is always "main" on every
  //    install; Bakin's main-agent resolver depends on that invariant.
  const hasMain = list.some((a) => a?.id === 'main')
  if (!hasMain) {
    issues.push(
      `openclaw.json has no agent with id 'main'. Add an entry like ` +
        `{ "id": "main", "identity": { "name": "<your-agent-name>" } }. ` +
        `OpenClaw's orchestrator id is always 'main' on every install.`
    )
  }

  // 2. Duplicate ids — collect each colliding id exactly once in
  //    encounter order so the report is stable across runs.
  const seen = new Set<string>()
  const reportedDupes = new Set<string>()
  for (const agent of list) {
    const id = agent?.id
    if (typeof id !== 'string' || id.length === 0) continue
    if (seen.has(id)) {
      if (!reportedDupes.has(id)) {
        issues.push(
          `openclaw.json has duplicate agent id '${id}'. Keep one entry; remove the other.`
        )
        reportedDupes.add(id)
      }
    } else {
      seen.add(id)
    }
  }

  // 3. Duplicate resolved workspaces — resolve via `agent.workspace ??
  //    defaults.workspace`. Agents with no resolved workspace are skipped
  //    because there's nothing for them to collide with.
  const defaultWorkspace = config.agents?.defaults?.workspace ?? null
  const firstOwner = new Map<string, string>()
  for (const agent of list) {
    const id = agent?.id
    if (typeof id !== 'string' || id.length === 0) continue
    const resolved = agent?.workspace ?? defaultWorkspace
    if (!resolved) continue
    const existing = firstOwner.get(resolved)
    if (existing && existing !== id) {
      issues.push(
        `openclaw.json has two agents sharing workspace '${resolved}': ` +
          `'${existing}' and '${id}'. Bakin's adapter cannot distinguish ` +
          `them — rename the workspace of one, or remove the duplicate entry.`
      )
    } else if (!existing) {
      firstOwner.set(resolved, id)
    }
  }

  return issues
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

  // Integrity scan — reports-only. Never mutates openclaw.json. We drop
  // the mtime cache first so successive `bakin check openclaw` runs after
  // a manual edit observe the fresh file even on coarse-mtime filesystems.
  resetOpenClawConfigCache()
  const config = readOpenClawConfig()
  const integrityIssues = validateOpenClawIntegrity(config)
  if (integrityIssues.length > 0) {
    return {
      name: 'openclaw',
      status: 'broken',
      message: `openclaw.json has ${integrityIssues.length} integrity issue${integrityIssues.length === 1 ? '' : 's'}:\n  - ${integrityIssues.join('\n  - ')}`,
      remediation: 'Edit openclaw.json to resolve the listed issues, then rerun `bakin check openclaw`. Bakin will not modify openclaw.json for you.',
      details: { binary, configPath, integrityIssues },
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
