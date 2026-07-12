/**
 * runtime component - detects that the configured agent runtime is available.
 *
 * The runtime is a **hard prerequisite**, not something Bakin manages. This
 * component is check-only — `install()` is a noop that always returns a
 * message pointing at the active runtime adapter setup path. The orchestrator is
 * responsible for using the `missing`/`error` status from `check()` to
 * abort the remaining onboarding steps: without a runtime there is no
 * agent runtime, and everything downstream of this point (LLM keys,
 * channel config, credential discovery) would be meaningless.
 *
 * Detection criteria (all must hold for status: ok):
 * 1. The configured runtime adapter initializes
 * 2. The runtime responds to ping()
 * 3. Runtime roster integrity checks pass
 *
 * If any one of those is missing we report `missing` (not `error`) and
 * leave the hard-stop decision to the orchestrator — a single `bakin check
 * runtime` invocation should still be able to surface the same result
 * without hard-exiting the process.
 *
 * P2.5: integrity validates the runtime-neutral ROSTER (`agents.list()` — the
 * adapter resolves each agent's effective workspace into metadata), never raw
 * runtime config. The config surface is gone from the contract.
 */
import { selectRuntimeMainAgent, type AgentRuntimeAdapter, type RuntimeAgent } from '@bakin/core/adapters/runtime'
import { createLogger } from '../logger'
import { createAppServices, maybeGetAppServices } from '../app-services'
import { DEFAULT_RUNTIME_ADAPTER_SUPPORT } from '../runtime-adapter-factory'
import type { CheckResult, InstallResult, OnboardingComponent } from './types'

const log = createLogger('onboarding:runtime')

const SETUP_URL = DEFAULT_RUNTIME_ADAPTER_SUPPORT.setupUrl
const SETUP_MESSAGE = `Bakin requires an active agent runtime such as OpenClaw. Review the prerequisites and setup guide, then rerun onboarding: ${SETUP_URL}`

async function getRuntimeForOnboarding(): Promise<AgentRuntimeAdapter> {
  const existing = maybeGetAppServices()?.runtime
  if (existing) return existing
  return (await createAppServices()).runtime
}

function agentWorkspace(agent: RuntimeAgent): string | null {
  const value = agent.metadata?.workspacePath ?? agent.metadata?.workspace
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Reports-only integrity validator over the runtime roster.
 *
 * Bakin relies on the invariant that every runtime DECLARES an orchestrator
 * (id 'main' or role 'orchestrator' — P2.6: a declared fact, not a baked
 * constant), that agent ids are unique, and that no two agents resolve to
 * the same workspace. This scan collects *every* violation so the user sees
 * the whole picture on one run of `bakin check runtime` instead of playing
 * whack-a-mole.
 *
 * **Never mutates runtime state.** The user owns the runtime and decides how
 * to fix it.
 */
export function validateRuntimeIntegrity(agents: RuntimeAgent[]): string[] {
  const issues: string[] = []

  // 1. No DECLARED orchestrator. selectRuntimeMainAgent would still fall
  //    back to the first agent, but dispatch/prompts/permissions all key on
  //    the orchestrator — an implicit pick is a footgun worth surfacing.
  const hasDeclaredOrchestrator = agents.some(
    (a) => a?.id === 'main' || a?.role?.toLowerCase() === 'orchestrator',
  )
  if (!hasDeclaredOrchestrator) {
    issues.push(
      `Runtime roster declares no orchestrator. Add an agent with id 'main' ` +
        `or role 'orchestrator' — Bakin resolves its orchestrator from that declaration.`
    )
  }

  // 2. Duplicate ids — collect each colliding id exactly once in
  //    encounter order so the report is stable across runs.
  const seen = new Set<string>()
  const reportedDupes = new Set<string>()
  for (const agent of agents) {
    const id = agent?.id
    if (typeof id !== 'string' || id.length === 0) continue
    if (seen.has(id)) {
      if (!reportedDupes.has(id)) {
        issues.push(
          `Runtime roster has duplicate agent id '${id}'. Keep one entry; remove the other.`
        )
        reportedDupes.add(id)
      }
    } else {
      seen.add(id)
    }
  }

  // 3. Duplicate resolved workspaces. The adapter resolves each agent's
  //    effective workspace into metadata (workspacePath); agents without one
  //    are skipped rather than treated as collisions.
  const firstOwner = new Map<string, string>()
  for (const agent of agents) {
    const id = agent?.id
    if (typeof id !== 'string' || id.length === 0) continue
    const resolved = agentWorkspace(agent)
    if (!resolved) continue
    const existing = firstOwner.get(resolved)
    if (existing && existing !== id) {
      issues.push(
        `Runtime roster has two agents sharing workspace '${resolved}': ` +
          `'${existing}' and '${id}'. Bakin's adapter cannot distinguish ` +
          `them - rename the workspace of one, or remove the duplicate entry.`
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
      name: 'runtime',
      status: 'missing',
      message: `Runtime adapter could not initialize: ${err instanceof Error ? err.message : String(err)}`,
      remediation: SETUP_MESSAGE,
      details: { installUrl: SETUP_URL },
    }
  }

  const available = await runtime.ping().catch(() => false)
  if (!available) {
    return {
      name: 'runtime',
      status: 'missing',
      message: `${runtime.name} runtime adapter cannot serve turns (gateway down or credentials missing)`,
      remediation: SETUP_MESSAGE,
      details: { runtime: runtime.name, installUrl: SETUP_URL },
    }
  }

  let agents: RuntimeAgent[]
  try {
    agents = await runtime.agents.list()
  } catch (err) {
    return {
      name: 'runtime',
      status: 'broken',
      message: `Runtime agent roster could not be read: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Fix the configured runtime adapter, then rerun onboarding.',
      details: { runtime: runtime.name, installUrl: SETUP_URL },
    }
  }

  const mainAgent = selectRuntimeMainAgent(agents)
  if (!mainAgent) {
    // A completely empty roster is the FIRST-RUN state, not user breakage:
    // initialize() is write-free by conformance pin, so a runtime that has
    // never been provisioned has no agents yet. The check stays read-only
    // (`bakin check runtime` never mutates); the onboarding orchestrator
    // keys on `emptyRoster` to provision — the sanctioned seeding path —
    // and re-check. Integrity-broken rosters below never get this marker.
    return {
      name: 'runtime',
      status: 'broken',
      message: 'Runtime adapter returned no agents',
      remediation: agents.length === 0
        ? 'Run `bakin onboard` (or start the server) to provision the runtime and seed its main agent.'
        : 'Create at least one orchestrator agent, then rerun onboarding.',
      details: { runtime: runtime.name, installUrl: SETUP_URL, ...(agents.length === 0 ? { emptyRoster: true } : {}) },
    }
  }

  const integrityIssues = validateRuntimeIntegrity(agents)
  if (integrityIssues.length > 0) {
    return {
      name: 'runtime',
      status: 'broken',
      message: `Runtime roster has ${integrityIssues.length} integrity issue${integrityIssues.length === 1 ? '' : 's'}:\n  - ${integrityIssues.join('\n  - ')}`,
      remediation: 'Fix the runtime\'s agent roster to resolve the listed issues, then rerun `bakin check runtime`. Bakin will not modify the runtime for you.',
      details: { runtime: runtime.name, integrityIssues },
    }
  }

  return {
    name: 'runtime',
    status: 'ok',
    message: `${runtime.name} runtime adapter is available`,
    details: { runtime: runtime.name, mainAgentId: mainAgent.id },
  }
}

async function install(): Promise<InstallResult> {
  // The runtime is never auto-installed by Bakin. Emit a noop with a helpful
  // message so the orchestrator can log it and exit cleanly.
  log.info('runtime.install() is a noop - runtime adapter setup is user-managed')
  return {
    name: 'runtime',
    status: 'noop',
    message: SETUP_MESSAGE,
    durationMs: 0,
  }
}

/**
 * Onboarding-only seeding hook: provisioning is adapter-owned and idempotent
 * (Pi seeds its main orchestrator here; OpenClaw writes MCP entries), and
 * onboarding is one of the sanctioned provisioning call sites (boot,
 * install, roster change). Never called from `bakin check`.
 */
export async function provisionRuntimeForOnboarding(): Promise<void> {
  const runtime = await getRuntimeForOnboarding()
  await runtime.provisionToolAccess()
}

export const runtimeComponent: OnboardingComponent = {
  name: 'runtime',
  check,
  install,
}

export const RUNTIME_SETUP_URL = SETUP_URL
export const RUNTIME_SETUP_MESSAGE = SETUP_MESSAGE
