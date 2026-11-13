/**
 * "Do more with Bakin": which curated suggestions apply to this home.
 *
 * Pure. A suggestion is data plus a condition over facts other engines
 * already answer; nothing here probes anything, and no component decides.
 * A fact that could not be read is `unknown`, and unknown never makes a
 * suggestion appear: Home must not tell someone to install what they have.
 */
import type { Suggestion, SuggestionCondition } from './content'
import type { HomeDecisions } from './decisions'

/** How long "Not now" hides a suggestion. Long enough not to nag; short enough to notice needs change. */
export const DISMISSAL_MS = 30 * 24 * 60 * 60 * 1000
/** Home shows this many at most. */
export const MAX_SHOWN = 3

/** An installed pack that provides a capability. */
export interface InstalledCapability {
  capability: string
  ready: boolean
  /** A key it requires is not set. */
  needsKey: boolean
}

export interface SuggestionFacts {
  capabilities: readonly InstalledCapability[] | 'unknown'
  imageProvider: boolean | 'unknown'
  /** Agent ids on the roster, the main agent included. */
  agents: readonly string[]
  /** Loaded plugin ids. */
  plugins: readonly string[] | 'unknown'
  /** Ids of setup checklist items in the `todo` state. */
  checklistTodo: readonly string[] | 'unknown'
}

export type Dismissals = NonNullable<HomeDecisions['dismissedSuggestions']>

export function conditionHolds(when: SuggestionCondition, facts: SuggestionFacts): boolean {
  switch (when.kind) {
    case 'capability-missing':
      return facts.capabilities !== 'unknown' && !facts.capabilities.some((pack) => pack.capability === when.capability)
    case 'capability-needs-key': {
      if (facts.capabilities === 'unknown') return false
      const packs = facts.capabilities.filter((pack) => pack.capability === when.capability)
      return packs.length > 0 && !packs.some((pack) => pack.ready) && packs.some((pack) => pack.needsKey)
    }
    case 'no-image-provider':
      return facts.imageProvider === false
    case 'agent-missing':
      return !facts.agents.includes(when.agent)
    case 'only-main-agent':
      return facts.agents.length === 1
    case 'plugin-missing':
      return facts.plugins !== 'unknown' && !facts.plugins.includes(when.plugin)
    case 'checklist-todo':
      return facts.checklistTodo !== 'unknown' && facts.checklistTodo.includes(when.item)
  }
}

/** Put away, and the time is not up. A record that cannot be read as a time hides nothing. */
export function isDismissed(dismissed: Dismissals, id: string, now: number): boolean {
  const record = dismissed[id]
  if (!record) return false
  const at = Date.parse(record.at)
  return Number.isFinite(at) && now - at < DISMISSAL_MS
}

/** Every suggestion that applies and is not put away, in curated order. */
export function suggestionsFor(suggestions: readonly Suggestion[], facts: SuggestionFacts, dismissed: Dismissals, now: number): Suggestion[] {
  return suggestions.filter((suggestion) => conditionHolds(suggestion.when, facts) && !isDismissed(dismissed, suggestion.id, now))
}
