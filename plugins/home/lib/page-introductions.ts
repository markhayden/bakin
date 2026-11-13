/**
 * Which pages still introduce themselves on this home.
 *
 * Pure. A page's introduction is for someone meeting Bakin through Home:
 * it is offered only on a home where the "meet your agent" introduction
 * was finished or skipped, which is the one recorded sign that a person
 * started here. A home that was set up before Home existed, or whose
 * agent was named somewhere else, has people who already know their way
 * around; it is never handed six panels to close.
 */
import type { PageIntroduction } from './content'
import type { HomeDecisions } from './decisions'

type Decided = Pick<HomeDecisions, 'introduction' | 'closedPageIntroductions'>

/** A person went through (or past) Home's introduction on this home. */
export function startedOnHome(decisions: Decided): boolean {
  const status = decisions.introduction?.status
  return status === 'completed' || status === 'skipped'
}

/** The introductions not yet closed, in curated order; none on a home that did not start on Home. */
export function openPageIntroductions(all: readonly PageIntroduction[], decisions: Decided): PageIntroduction[] {
  if (!startedOnHome(decisions)) return []
  const closed = decisions.closedPageIntroductions ?? {}
  return all.filter((introduction) => !(introduction.id in closed))
}
