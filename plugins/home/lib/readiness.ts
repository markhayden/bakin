/**
 * Gathers the facts Home's state is decided from. Every read is guarded:
 * a failure becomes `unknown` (or "unreachable" for the roster itself),
 * never a guess. Nothing here writes, and nothing starts a turn.
 */
import type { AgentRuntimeAdapter, RuntimeAgent } from '@bakin/core/adapters/runtime'
import { selectRuntimeMainAgent } from '@bakin/core/adapters/runtime'
import { listCapabilities } from '../../../src/core/agent-packages/capability-readiness'
import { createLogger } from '../../../src/core/logger'
import { getModelEligibility } from '../../../src/core/model-eligibility'
import { readDecisions } from './decisions'
import type { CredentialFact, HomeFacts, MainAgentFacts, ModelFact, StarterReadiness } from './state'
import type { InstalledCapability } from './suggestions'

const log = createLogger('home')

/** The personality file every runtime's agents carry. */
const PERSONALITY_FILE = 'SOUL.md'

/**
 * A name the runtime gave the agent, not a person: the agent's own id, or
 * "Main" (what Pi seeds its orchestrator with). Compared without case.
 */
export function isSeededName(agent: Pick<RuntimeAgent, 'id' | 'name'>): boolean {
  const name = agent.name.trim().toLowerCase()
  return name === '' || name === agent.id.trim().toLowerCase() || name === 'main'
}

async function introduced(runtime: AgentRuntimeAdapter, agent: RuntimeAgent): Promise<MainAgentFacts['introduced']> {
  // A real name is enough: someone introduced this agent somewhere.
  if (!isSeededName(agent)) return true
  try {
    const file = await runtime.agents.readWorkspaceFile(agent.id, PERSONALITY_FILE)
    return file !== null && file.content.trim().length > 0
  } catch (err) {
    log.debug('Could not read the main agent personality file', { agentId: agent.id, error: String(err) })
    return 'unknown'
  }
}

async function credentials(runtime: AgentRuntimeAdapter, agentId: string): Promise<CredentialFact> {
  try {
    return (await runtime.credentialStatus({ agentId })).llmProviders.length > 0 ? 'present' : 'absent'
  } catch (err) {
    log.debug('Could not read credential status', { error: String(err) })
    return 'unknown'
  }
}

/** The model the main agent would run on: its own pin, else the runtime default. */
async function effectiveModel(runtime: AgentRuntimeAdapter, agent: RuntimeAgent): Promise<string | null> {
  if (agent.model) return agent.model
  const policy = await runtime.models.routingPolicy()
  return policy.defaultModel || null
}

async function model(runtime: AgentRuntimeAdapter, agent: RuntimeAgent): Promise<ModelFact> {
  try {
    const id = await effectiveModel(runtime, agent)
    if (!id) return { status: 'unknown' }
    const report = await getModelEligibility(runtime, { agentId: agent.id, extraIds: [id] })
    const verdict = report.byModel.get(id)?.eligibility
    if (verdict?.status === 'eligible') return { status: 'runnable' }
    if (verdict?.status === 'ineligible') return { status: 'cannot_run', model: id, detail: verdict.detail }
    return { status: 'unknown' }
  } catch (err) {
    log.debug('Could not judge the main agent model', { error: String(err) })
    return { status: 'unknown' }
  }
}

/** What is installed and usable, read once: starters and suggestions are both decided from it. */
interface Evidence {
  capabilities: HomeFacts['capabilities']
  imageProvider: HomeFacts['imageProvider']
}

async function evidence(canGenerateImage: () => Promise<boolean | undefined>): Promise<Evidence> {
  const [capabilities, imageProvider] = await Promise.all([
    listCapabilities().then(
      (packs): InstalledCapability[] => packs.map((pack) => ({
        capability: pack.capability,
        ready: pack.ready,
        needsKey: pack.secrets.some((secret) => secret.required && secret.status === 'missing'),
      })),
      (err: unknown) => {
        log.debug('Could not read capability readiness', { error: String(err) })
        return 'unknown' as const
      },
    ),
    canGenerateImage().then((answer) => answer ?? ('unknown' as const), () => 'unknown' as const),
  ])
  return { capabilities, imageProvider }
}

/** Starters lean the safe way: what could not be read is not offered. */
function starterReadiness(agents: readonly RuntimeAgent[], found: Evidence): StarterReadiness {
  const packs = found.capabilities === 'unknown' ? [] : found.capabilities
  return {
    readyCapabilities: [...new Set(packs.filter((pack) => pack.ready).map((pack) => pack.capability))],
    imageProvider: found.imageProvider === true,
    agents: agents.map((agent) => agent.id),
  }
}

const NOTHING_READ: Evidence & { starters: StarterReadiness } = {
  capabilities: 'unknown', imageProvider: 'unknown', starters: { readyCapabilities: [], imageProvider: false, agents: [] },
}

export interface GatherDeps {
  runtime: AgentRuntimeAdapter
  /** The Images plugin's answer, through the hook registry; undefined when it is not loaded. */
  canGenerateImage: () => Promise<boolean | undefined>
}

export async function gatherHomeFacts(deps: GatherDeps): Promise<HomeFacts> {
  const { runtime } = deps
  const { introduction, firstRequest, dismissedSuggestions } = readDecisions()
  const decisions = { introduction, firstRequest, dismissedSuggestions }
  let agents: RuntimeAgent[]
  try {
    agents = await runtime.agents.list()
  } catch (err) {
    log.warn('Home could not read the runtime roster', { error: String(err) })
    return {
      runtimeReachable: false, mainAgent: null, credentials: 'unknown', model: { status: 'unknown' }, decisions, ...NOTHING_READ,
    }
  }
  const main = selectRuntimeMainAgent(agents)
  if (!main) {
    return {
      runtimeReachable: true, mainAgent: null, credentials: 'unknown', model: { status: 'unknown' }, decisions, ...NOTHING_READ,
    }
  }
  const [isIntroduced, credentialFact, modelFact, found] = await Promise.all([
    introduced(runtime, main),
    credentials(runtime, main.id),
    model(runtime, main),
    evidence(deps.canGenerateImage),
  ])
  return {
    runtimeReachable: true,
    mainAgent: { id: main.id, name: main.name, introduced: isIntroduced },
    credentials: credentialFact,
    model: modelFact,
    decisions,
    starters: starterReadiness(agents, found),
    ...found,
  }
}
