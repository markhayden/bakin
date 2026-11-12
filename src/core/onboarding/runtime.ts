/**
 * runtime component — the configured agent runtime is there, reachable and
 * has a roster Bakin can work with.
 *
 * `runtime` and `llm` are two facts. This one is about the runtime itself:
 *
 * 1. The configured adapter initializes.
 * 2. It is REACHABLE, decided by how its agents reach Bakin's tools
 *    (`describeToolAccess().style`, an existing contract fact): an
 *    in-process runtime (Pi) is reachable once it initializes; any other
 *    runtime (OpenClaw's gateway) has to answer `ping()`. Credentials play
 *    no part — whether a provider is logged in is the `llm` component's
 *    question, so Pi without a login is a working runtime and a stopped
 *    gateway is a broken one with or without credentials.
 * 3. The roster passes its integrity checks.
 *
 * Statuses: `error` for everything the operator has to fix outside Bakin
 * (cannot initialize, cannot be reached, roster unreadable or inconsistent)
 * and `missing` for the one thing onboarding sets up itself — a runtime
 * that has never been provisioned and so has no agents. Its install
 * provisions (adapter-owned: Pi seeds its main agent; OpenClaw writes tool
 * access only, so an empty OpenClaw roster stays the operator's to fix) and
 * validates again. `check()` never mutates anything.
 *
 * P2.5: integrity validates the runtime-neutral ROSTER (`agents.list()` — the
 * adapter resolves each agent's effective workspace into metadata), never raw
 * runtime config. The config surface is gone from the contract.
 */
import { selectRuntimeMainAgent, type AgentRuntimeAdapter, type RuntimeAgent } from '@bakin/core/adapters/runtime'
import { createAppServices, maybeGetAppServices } from '../app-services'
import { DEFAULT_RUNTIME_ADAPTER_SUPPORT } from '../runtime-adapter-factory'
import type { OperationContext } from '@bakin/core/operations'
import type { CheckResult, ComponentInstallOptions, InstallableComponent, InstallResult } from './types'

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

/**
 * Reachability by tool-access style: an in-process runtime lives in this
 * process and is reachable once initialized; anything else must answer.
 */
async function isReachable(runtime: AgentRuntimeAdapter): Promise<boolean> {
  if (runtime.describeToolAccess().style === 'in-process') return true
  return await runtime.ping().catch(() => false)
}

async function check(): Promise<CheckResult> {
  let runtime: AgentRuntimeAdapter
  try {
    runtime = await getRuntimeForOnboarding()
  } catch (err) {
    return {
      name: 'runtime',
      status: 'error',
      message: `Runtime adapter could not initialize: ${err instanceof Error ? err.message : String(err)}`,
      remediation: SETUP_MESSAGE,
      details: { installUrl: SETUP_URL },
    }
  }

  if (!await isReachable(runtime)) {
    return {
      name: 'runtime',
      status: 'error',
      message: `${runtime.name} runtime cannot be reached (it did not answer)`,
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
      status: 'error',
      message: `Runtime agent roster could not be read: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Fix the configured runtime adapter, then rerun onboarding.',
      details: { runtime: runtime.name, installUrl: SETUP_URL },
    }
  }

  if (!selectRuntimeMainAgent(agents)) {
    // A completely empty roster is the FIRST-RUN state, not user breakage:
    // initialize() is write-free, so a runtime that has never been
    // provisioned has no agents yet. That is the one thing this
    // component's install sets up; the check itself never mutates.
    return {
      name: 'runtime',
      status: 'missing',
      message: 'Runtime adapter returned no agents',
      remediation: 'Run `bakin onboard` (or start the server) to provision the runtime and seed its main agent.',
      details: { runtime: runtime.name, installUrl: SETUP_URL, emptyRoster: true },
    }
  }

  const integrityIssues = validateRuntimeIntegrity(agents)
  if (integrityIssues.length > 0) {
    return {
      name: 'runtime',
      status: 'error',
      message: `Runtime roster has ${integrityIssues.length} integrity issue${integrityIssues.length === 1 ? '' : 's'}:\n  - ${integrityIssues.join('\n  - ')}`,
      remediation: 'Fix the runtime\'s agent roster to resolve the listed issues, then rerun `bakin check runtime`. Bakin will not modify the runtime for you.',
      details: { runtime: runtime.name, integrityIssues },
    }
  }

  return {
    name: 'runtime',
    status: 'ok',
    message: `${runtime.name} runtime adapter is available`,
    details: { runtime: runtime.name, mainAgentId: selectRuntimeMainAgent(agents)!.id },
  }
}

/**
 * Provision a runtime that has never been set up, then validate again.
 * Provisioning is adapter-owned and idempotent, and onboarding is one of
 * its sanctioned call sites (boot, install, roster change). Anything other
 * than an empty roster is not this install's to fix: it fails with what
 * the check found, and the operator fixes the runtime.
 */
async function install(_opts: ComponentInstallOptions, op: OperationContext): Promise<InstallResult> {
  const start = Date.now()
  const done = (status: InstallResult['status'], message: string): InstallResult => ({ name: 'runtime', status, message, durationMs: Date.now() - start })
  const before = await check()
  if (before.status === 'ok') {
    op.skip('provision', 'already provisioned')
    return done('noop', before.message)
  }
  if (before.status !== 'missing') {
    op.skip('provision', 'not something provisioning fixes')
    return done('failed', before.message)
  }
  op.stage('provision')
  try {
    const runtime = await getRuntimeForOnboarding()
    await runtime.provisionToolAccess()
  } catch (err) {
    return { ...done('failed', `Runtime provisioning failed: ${err instanceof Error ? err.message : String(err)}`), error: err }
  }
  const after = await check()
  if (after.status === 'ok') return done('installed', `${after.message} (provisioned)`)
  // Still empty (this runtime's provisioning creates no agents) or broken.
  return done('failed', after.status === 'missing'
    ? 'Runtime still has no agents after provisioning — create an orchestrator agent in the runtime, then rerun onboarding.'
    : after.message)
}

export const runtimeComponent: InstallableComponent = {
  name: 'runtime',
  requires: ['settings'],
  plan: { stages: [{ id: 'provision', kind: 'installing', label: 'Provision the runtime' }], pointOfNoReturn: 'start' },
  // Provisioning writes the runtime's Bakin registry and tool-access
  // entries: an install-state write like every other setup step.
  resources: ['install-state'],
  failureCode: 'runtime_not_ready',
  check,
  install,
}

export const RUNTIME_SETUP_URL = SETUP_URL
export const RUNTIME_SETUP_MESSAGE = SETUP_MESSAGE
