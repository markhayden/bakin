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
}
