/** Shared types for the Home plugin (server and client). */
import type { HomeState } from './lib/state'

export type { HomeState, HomeStateName, UnavailableReason } from './lib/state'

/** A starter as the page needs it. */
export interface HomeStarter {
  id: string
  title: string
  description: string
  /** What is sent to the main agent when the starter is picked. */
  prompt: string
  /** The person must attach a file before it is sent. */
  needsAttachment: boolean
}

/** `GET /api/plugins/home/state`. */
export interface HomeStateResponse {
  ok: true
  state: HomeState
  /** The starters this home can run, in curated order. */
  starters: HomeStarter[]
  /** The personality presets the introduction offers. */
  personalities: HomePersonality[]
  /** What the person asked to be called, when Bakin knows. */
  person?: string
  /** The first day: the introduction was completed and nothing has been asked for yet. */
  firstDay: boolean
  /** The introduction was skipped: Home keeps a quiet way back to it. */
  introductionSkipped: boolean
  /** How to log a provider in on this runtime. Present only when the state is `needs-login`. */
  login?: HomeLogin
  /** "Do more with Bakin": the first few suggestions that apply. Empty unless the state is `ready`. */
  suggestions: HomeSuggestion[]
  /** How many apply in all, shown or not. */
  suggestionCount: number
}

/** Something worth adding, with the one step that adds it. */
export interface HomeSuggestion {
  id: string
  title: string
  /** One sentence: what the person gets. */
  payoff: string
  action: { label: string; href: string }
}

export interface HomeLogin {
  /** The runtime's name as people write it. */
  runtime: string
  /** The runtime's own steps, in order. Text in backticks is something to type. */
  steps: string[]
  /** The shell command that starts the sign-in, when the runtime has one. Never run by Bakin. */
  command?: string
  docsUrl: string
}

export interface HomePersonality {
  id: string
  label: string
  /** One line in this voice. */
  sample: string
}

export type { IntroductionAnswers } from './lib/decisions'
export type { IntroductionResult, IntroductionStep } from './lib/introduction'

/** One slide of the tour: an area of Bakin. */
export type { TourSlide } from './lib/content'

/** `GET /api/plugins/home/tour`. */
export interface HomeTourResponse {
  ok: true
  slides: import('./lib/content').TourSlide[]
}
