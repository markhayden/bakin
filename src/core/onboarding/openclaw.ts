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
 * 1. The configured runtime adapter initializes
 * 2. The runtime responds to ping()
 * 3. Runtime agent/config integrity checks pass
 *
 * If any one of those is missing we report `missing` (not `error`) and
 * leave the hard-stop decision to the orchestrator — a single `bakin check
 * openclaw` invocation should still be able to surface the same result
 * without hard-exiting the process.
 */
import { selectRuntimeMainAgent, type AgentRuntimeAdapter, type RuntimeAgent } from '@bakin/core/adapters/runtime'
import { createLogger } from '../logger'
import { createAppServices, maybeGetAppServices } from '../app-services'
import type { CheckResult, InstallResult, OnboardingComponent } from './types'

const log = createLogger('onboarding:openclaw')

const INSTALL_URL = 'https://openclaw.ai/'
const INSTALL_MESSAGE = `OpenClaw is required. Install it from ${INSTALL_URL} and rerun onboarding.`

interface RuntimeConfigForIntegrity {
  agents?: {
    defaults?: { workspace?: string | null }
    list?: Array<{ id?: string | null; workspace?: string | null }>
  }
}

async function getRuntimeForOnboarding(): Promise<AgentRuntimeAdapter> {
  const existing = maybeGetAppServices()?.runtime
  if (existing) return existing
  return (await createAppServices()).runtime
}

function configFromRuntimeAgents(agents: RuntimeAgent[]): RuntimeConfigForIntegrity {
  return {
    agents: {
      list: agents.map((agent) => ({
        id: agent.id,
        workspace: typeof agent.metadata?.workspace === 'string' ? agent.metadata.workspace : undefined,
      })),
    },
  }
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
export function validateOpenClawIntegrity(config: RuntimeConfigForIntegrity | null): string[] {
  const issues: string[] = []
  if (!config) return issues

  const list = Array.isArray(config.agents?.list) ? config.agents!.list! : []

  // 1. Missing main — OpenClaw's orchestrator id is always "main" on every
  //    install; Bakin's runtime helpers depend on that invariant.
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
  let runtime: AgentRuntimeAdapter
  try {
    runtime = await getRuntimeForOnboarding()
  } catch (err) {
    return {
      name: 'openclaw',
      status: 'missing',
      message: `Runtime adapter could not initialize: ${err instanceof Error ? err.message : String(err)}`,
      remediation: INSTALL_MESSAGE,
      details: { installUrl: INSTALL_URL },
    }
  }

  const available = await runtime.ping().catch(() => false)
  if (!available) {
    return {
      name: 'openclaw',
      status: 'missing',
      message: `${runtime.name} runtime adapter is not reachable`,
      remediation: INSTALL_MESSAGE,
      details: { runtime: runtime.name, installUrl: INSTALL_URL },
    }
  }

  let agents: RuntimeAgent[]
  try {
    agents = await runtime.agents.list()
  } catch (err) {
    return {
      name: 'openclaw',
      status: 'broken',
      message: `Runtime agent roster could not be read: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Fix the configured runtime adapter, then rerun onboarding.',
      details: { runtime: runtime.name, installUrl: INSTALL_URL },
    }
  }

  const mainAgent = selectRuntimeMainAgent(agents)
  if (!mainAgent) {
    return {
      name: 'openclaw',
      status: 'broken',
      message: 'Runtime adapter returned no agents',
      remediation: 'Create at least one orchestrator agent, then rerun onboarding.',
      details: { runtime: runtime.name, installUrl: INSTALL_URL },
    }
  }

  let config: RuntimeConfigForIntegrity | null
  try {
    config = await runtime.config.raw<RuntimeConfigForIntegrity | null>('*', 'onboarding.openclaw.integrity')
  } catch (err) {
    return {
      name: 'openclaw',
      status: 'broken',
      message: `Runtime config could not be read: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Fix or regenerate the runtime config, then rerun onboarding.',
      details: { runtime: runtime.name, parseError: String(err) },
    }
  }

  const integrityIssues = validateOpenClawIntegrity(config ?? configFromRuntimeAgents(agents))
  if (integrityIssues.length > 0) {
    return {
      name: 'openclaw',
      status: 'broken',
      message: `openclaw.json has ${integrityIssues.length} integrity issue${integrityIssues.length === 1 ? '' : 's'}:\n  - ${integrityIssues.join('\n  - ')}`,
      remediation: 'Edit the runtime config to resolve the listed issues, then rerun `bakin check openclaw`. Bakin will not modify runtime config for you.',
      details: { runtime: runtime.name, integrityIssues },
    }
  }

  return {
    name: 'openclaw',
    status: 'ok',
    message: `${runtime.name} runtime adapter is available`,
    details: { runtime: runtime.name, mainAgentId: mainAgent.id },
  }
}

async function install(): Promise<InstallResult> {
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
