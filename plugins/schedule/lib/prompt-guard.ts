/**
 * Schedule prompt danger-zone guard.
 *
 * Scheduled tasks that post to a chat channel can hit the transport limit
 * (~2000 chars on Discord). A prompt that tells the agent to keep a single
 * large message and NOT split lands in the danger zone: delivery fails with
 * "Invalid Form Body" and the agent burns the run splitting/repairing. This
 * surfaces a warning at create/edit time so the prompt can be fixed to chunk
 * deliberately (the pattern the well-behaved schedules already use).
 */

export interface PromptWarning {
  code: 'transport-danger-zone' | 'high-char-cap'
  message: string
}

/** Approximate single-message transport ceiling (Discord). */
const TRANSPORT_LIMIT = 2000
/** A no-split instruction is risky once the cap is anywhere near the ceiling. */
const NEAR_LIMIT = 1500

const NO_SPLIT = /\b(?:do not|don'?t|never|no)\s+split\b|\b(?:in|as)\s+(?:a\s+)?(?:one|single)\s+message\b|\bone\s+message\s+only\b/i
const CHAR_CAP = /(\d{3,5})\s*(?:char|character)/i

/** Inspect a schedule's task prompt for channel transport danger-zone wording. */
export function checkSchedulePrompt(prompt: string | undefined): PromptWarning[] {
  if (!prompt || !prompt.trim()) return []

  const noSplit = NO_SPLIT.test(prompt)
  const capMatch = prompt.match(CHAR_CAP)
  const cap = capMatch ? parseInt(capMatch[1], 10) : null

  if (noSplit && (cap === null || cap >= NEAR_LIMIT)) {
    return [{
      code: 'transport-danger-zone',
      message:
        `This prompt discourages splitting near the channel transport limit (~${TRANSPORT_LIMIT} chars). ` +
        `Long single messages can fail to deliver ("Invalid Form Body") and trigger split/repair loops. ` +
        `Prefer chunking under ~900 chars and splitting deliberately.`,
    }]
  }

  if (cap !== null && cap >= NEAR_LIMIT) {
    return [{
      code: 'high-char-cap',
      message: `A ${cap}-character cap is close to the channel transport limit (~${TRANSPORT_LIMIT}); consider chunking under ~900 chars.`,
    }]
  }

  return []
}
