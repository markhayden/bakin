/**
 * Writing the introduction's answers: the agent's name and personality,
 * what to call the person, and getting that to every agent.
 *
 * These are several separate writes and cannot be made atomic. Instead they
 * are RESUMABLE: the answers are recorded first, the steps run in a fixed
 * order, each is safe to repeat, and "completed" is written last. A failure
 * leaves the answers pending, Home keeps showing the introduction, and a
 * retry runs every step again to the same result.
 */
import { HOME_CONTENT, type PersonalityPreset } from './content'
import { updateDecisions, type IntroductionAnswers } from './decisions'

export type IntroductionStep = 'identity' | 'person' | 'sync'

export type IntroductionResult =
  | { ok: true }
  | { ok: false; step: IntroductionStep; error: string }

export interface IntroductionDeps {
  /** Team's identity service, through its hook. */
  updateIdentity: (update: { agentId: string; name: string; vibe: string; soul: string }) => Promise<unknown>
  /** Record what agents call the person, in global context. */
  setOperatorName: (name: string) => void
  /** Bring every agent's instructions up to date; rejects when it could not. */
  syncAgents: () => Promise<void>
  now?: () => Date
  presets?: readonly PersonalityPreset[]
}

/** An unknown preset id is a caller error, refused before anything is recorded. */
export class UnknownPersonalityError extends Error {
  constructor(id: string) {
    super(`Unknown personality "${id}"`)
    this.name = 'UnknownPersonalityError'
  }
}

/** The vibe line and personality text for the chosen personality. */
export function personalityFor(answers: IntroductionAnswers, presets: readonly PersonalityPreset[] = HOME_CONTENT.personalities): { vibe: string; soul: string } {
  const name = answers.agentName
  const chosen = answers.personality
  if (chosen.kind === 'preset') {
    const preset = presets.find((candidate) => candidate.id === chosen.id)
    if (!preset) throw new UnknownPersonalityError(chosen.id)
    return { vibe: preset.vibe, soul: `# ${name}\n\nYour name is ${name}. ${preset.soul}\n` }
  }
  const description = chosen.description
  // The vibe is a one-line label; the person's own words are the personality.
  const vibe = description.length > 60 ? `${description.slice(0, 57).trimEnd()}...` : description
  return { vibe, soul: `# ${name}\n\nYour name is ${name}. The person you work with described how you should come across, in their own words:\n\n> ${description.replace(/\n+/g, ' ')}\n\nBe that.\n` }
}

export async function completeIntroduction(agentId: string, answers: IntroductionAnswers, deps: IntroductionDeps): Promise<IntroductionResult> {
  const at = () => (deps.now?.() ?? new Date()).toISOString()
  const personality = personalityFor(answers, deps.presets)
  // Recorded before the first write: from here a failure resumes.
  updateDecisions((current) => ({ ...current, introduction: { status: 'pending', at: at(), answers } }))

  const steps: Array<[IntroductionStep, () => Promise<unknown> | void]> = [
    ['identity', () => deps.updateIdentity({ agentId, name: answers.agentName, ...personality })],
    ['person', () => deps.setOperatorName(answers.userName)],
    // Last of the writes: the agent must know the person's name before Home greets them with it.
    ['sync', () => deps.syncAgents()],
  ]
  for (const [step, run] of steps) {
    try {
      await run()
    } catch (err) {
      return { ok: false, step, error: err instanceof Error ? err.message : String(err) }
    }
  }
  updateDecisions((current) => ({ ...current, introduction: { status: 'completed', at: at() } }))
  return { ok: true }
}

/** The person asked for their first thing: the first day is over. */
export function recordFirstRequest(now: () => Date = () => new Date()): void {
  updateDecisions((current) => ({ ...current, firstRequest: { at: now().toISOString() } }))
}

export function skipIntroduction(now: () => Date = () => new Date()): void {
  updateDecisions((current) => ({ ...current, introduction: { status: 'skipped', at: now().toISOString() } }))
}
