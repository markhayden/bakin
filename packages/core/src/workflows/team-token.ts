/**
 * Workflow-step team target token (#611): a step's `agent` value may be
 * `team:<teamId>` — resolved to a concrete member at step dispatch via the
 * team plugin's `team.resolveAssignment` hook, sticky per step on the
 * instance. Shared by validation (core), the workflows plugin's resolution
 * surfaces, dispatch, and the editor UI.
 *
 * The string matches the AgentSelect UI encoding (TEAM_VALUE_PREFIX) — for
 * tasks the prefix is split off before the API; workflow STEP definitions
 * store it verbatim.
 */
export const TEAM_STEP_TOKEN_PREFIX = 'team:'

export function isTeamStepToken(value: string | undefined): value is `team:${string}` {
  return typeof value === 'string' && value.startsWith(TEAM_STEP_TOKEN_PREFIX)
}

export function teamIdFromToken(value: string): string {
  return isTeamStepToken(value) ? value.slice(TEAM_STEP_TOKEN_PREFIX.length).trim() : ''
}

/** All team ids referenced by a definition's steps (incl. parallel children). */
export function collectTeamTokenIds(steps: ReadonlyArray<unknown>): string[] {
  const ids = new Set<string>()
  const visit = (step: unknown): void => {
    if (!step || typeof step !== 'object') return
    const agent = (step as { agent?: unknown }).agent
    if (typeof agent === 'string' && isTeamStepToken(agent)) ids.add(teamIdFromToken(agent))
    const children = (step as { steps?: unknown }).steps
    if (Array.isArray(children)) children.forEach(visit)
  }
  steps.forEach(visit)
  return [...ids]
}
