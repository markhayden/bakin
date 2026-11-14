/**
 * What Home shows, as one pure function of facts.
 *
 * The facts are gathered elsewhere (`readiness.ts`) and are structured:
 * nothing here reads a message. "Unknown" is its own value and is never
 * treated as "absent" — an unreadable credential file must not send a
 * logged-in person to the login screen, and unavailable evidence must not
 * make a named agent look unnamed.
 */
import type { HomeDecisions, IntroductionAnswers } from './decisions'
import type { Starter } from './content'
import type { InstalledCapability } from './suggestions'

/** The main agent as Home needs it. `null` when the roster could not be read. */
export interface MainAgentFacts {
  id: string
  name: string
  /**
   * Whether the agent has been introduced: `false` only when its
   * personality is known to be missing AND its name is still the one the
   * runtime seeded it with. `unknown` when either could not be read.
   */
  introduced: boolean | 'unknown'
}

export type CredentialFact = 'present' | 'absent' | 'unknown'

/** Whether the main agent's model can run under this home's credentials. */
export type ModelFact =
  | { status: 'runnable' }
  | { status: 'cannot_run'; model: string; detail: string }
  /** No model chosen, or nobody can say: never a reason to block. */
  | { status: 'unknown' }

export interface StarterReadiness {
  /** Capability slugs that are installed with everything they need. */
  readyCapabilities: readonly string[]
  /** A provider that can make images is usable. */
  imageProvider: boolean
  /** Agent ids on the roster. */
  agents: readonly string[]
}

export interface HomeFacts {
  runtimeReachable: boolean
  mainAgent: MainAgentFacts | null
  credentials: CredentialFact
  model: ModelFact
  decisions: Pick<HomeDecisions, 'introduction' | 'firstRequest' | 'dismissedSuggestions'>
  starters: StarterReadiness
  /** Every installed capability pack, ready or not; `unknown` when they could not be read. */
  capabilities: readonly InstalledCapability[] | 'unknown'
  /** Whether a provider can make images; `unknown` when nobody could say. */
  imageProvider: boolean | 'unknown'
}

export type HomeStateName = 'unavailable' | 'meet-agent' | 'needs-login' | 'ready'

export type UnavailableReason =
  /** The runtime, or its roster, cannot be read. */
  | 'runtime_unreachable'
  /** A provider is logged in, but the main agent's model cannot run with it. */
  | 'model_cannot_run'

export type HomeState =
  | { name: 'unavailable'; reason: UnavailableReason; detail?: string; href: string }
  | { name: 'meet-agent'; agent: { id: string; name: string }; resume?: IntroductionAnswers }
  | { name: 'needs-login'; agent: { id: string; name: string } }
  | { name: 'ready'; agent: { id: string; name: string } }

/**
 * Precedence, first match wins:
 *  1. unavailable — nothing below can be trusted without a readable runtime
 *  2. meet-agent  — an introduction is half written (resume it), or the
 *                    agent is known to be unintroduced and it was neither
 *                    skipped nor completed
 *  3. needs-login — credentials are known to be absent
 *  4. unavailable — logged in, but the agent's model is known not to run
 *  5. ready
 */
export function homeState(facts: HomeFacts): HomeState {
  if (!facts.runtimeReachable || !facts.mainAgent) {
    return { name: 'unavailable', reason: 'runtime_unreachable', href: '/health' }
  }
  const agent = { id: facts.mainAgent.id, name: facts.mainAgent.name }
  const introduction = facts.decisions.introduction
  // Answers were given but not all written: finish that first, whatever the agent is called by now.
  if (introduction?.status === 'pending') return { name: 'meet-agent', agent, resume: introduction.answers }
  if (facts.mainAgent.introduced === false && introduction === undefined) {
    return { name: 'meet-agent', agent }
  }
  if (facts.credentials === 'absent') return { name: 'needs-login', agent }
  if (facts.model.status === 'cannot_run') {
    return { name: 'unavailable', reason: 'model_cannot_run', detail: facts.model.detail, href: '/models' }
  }
  return { name: 'ready', agent }
}

/**
 * Why this home cannot offer a starter, or null when it can. An attachment
 * is never a reason here: the person supplies it in the composer.
 */
export function starterBlockedBy(starter: Starter, readiness: StarterReadiness): 'capability' | 'image-provider' | 'agent' | null {
  const { needs } = starter
  if (needs.capability && !readiness.readyCapabilities.includes(needs.capability)) return 'capability'
  if (needs.imageProvider && !readiness.imageProvider) return 'image-provider'
  if (needs.agent && !readiness.agents.includes(needs.agent)) return 'agent'
  return null
}

/**
 * The first day: the introduction was completed here and nothing has been
 * asked for yet. Home greets a new person differently from a returning one.
 * A skipped introduction has no first day, and neither does a home whose
 * agent was named somewhere else.
 */
export function isFirstDay(decisions: Pick<HomeDecisions, 'introduction' | 'firstRequest'>): boolean {
  return decisions.introduction?.status === 'completed' && decisions.firstRequest === undefined
}

/** The starters this home can run, in curated order. */
export function availableStarters(starters: readonly Starter[], readiness: StarterReadiness): Starter[] {
  return starters.filter((starter) => starterBlockedBy(starter, readiness) === null)
}
