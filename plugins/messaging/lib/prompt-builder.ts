/**
 * Prompt builder for planning sessions.
 *
 * Builds a system prompt with agent persona, planning instructions,
 * and current plan state. Returns a proper messages array (not a
 * flattened string) so the LLM can track conversational context.
 *
 * Pure module — agent identity, persona markdown, and the content-type
 * taxonomy are all resolved by the caller (who has plugin context +
 * roster validation + user settings) and passed in via options. No
 * filesystem access here.
 */
import type { PlanningSession, ContentTypeOption } from '../types'

export interface PromptBuilderOptions {
  /** Display name for the agent. Falls back to agentId when omitted (orphaned reference). */
  agentName?: string
  /** User-configured content types — surfaces valid ids in the prompt instruction. */
  contentTypes: ContentTypeOption[]
  /** Pre-loaded agent persona markdown, or empty string. The caller is responsible
   *  for validating the agentId against the live roster before loading. */
  persona: string
}

/**
 * Build a summary of the current plan state (proposals with statuses).
 */
function buildPlanState(session: PlanningSession): string {
  if (session.proposals.length === 0) return ''

  const lines = ['## Current Plan State\n']
  for (const p of session.proposals) {
    const statusTag = p.status.toUpperCase()
    let line = `- [${statusTag}] (${p.id}) "${p.title}" — ${p.scheduledAt}, ${p.contentType}, ${p.tone}`
    if (p.rejectionNote) {
      line += `\n  Rejection note: ${p.rejectionNote}`
    }
    lines.push(line)
  }

  const approved = session.proposals.filter(p => p.status === 'approved').length
  const rejected = session.proposals.filter(p => p.status === 'rejected').length
  const proposed = session.proposals.filter(p => p.status === 'proposed').length
  lines.push(`\nSummary: ${approved} approved, ${rejected} rejected, ${proposed} pending`)

  return lines.join('\n')
}

function formatContentTypes(contentTypes: ContentTypeOption[]): string {
  if (contentTypes.length === 0) return 'a content type id of your choosing'
  return contentTypes.map((t) => t.id).join(', ')
}

function firstTypeId(contentTypes: ContentTypeOption[], fallback: string): string {
  return contentTypes[0]?.id ?? fallback
}

/**
 * Build the system prompt for a planning session.
 */
export function buildSystemPrompt(
  agentId: string,
  session: PlanningSession,
  options: PromptBuilderOptions,
): string {
  const agentName = options.agentName || agentId
  const persona = options.persona
  const typeList = formatContentTypes(options.contentTypes)
  const exampleType1 = firstTypeId(options.contentTypes, 'post')
  const exampleType2 = options.contentTypes[1]?.id ?? exampleType1

  const sections: string[] = []

  // Identity
  sections.push(`You are ${agentName}.`)

  // Persona
  if (persona) {
    sections.push(`## Your Persona\n\n${persona}`)
  }

  // Planning instructions
  sections.push(`## Planning Instructions

You are in a planning session with Mark. Your job is to brainstorm and refine content calendar ideas collaboratively.

IMPORTANT: Emit each proposed item as its OWN separate fenced code block — one object per block, NOT an array. Write a brief intro sentence before each block so items appear incrementally. Example:

Here's what I'm thinking for Monday:
\`\`\`json
{ "title": "An example post title", "scheduledAt": "2026-04-14T10:00:00-06:00", "contentType": "${exampleType1}", "tone": "educational", "brief": "Short description of the piece.", "channels": ["general"] }
\`\`\`

And for Tuesday:
\`\`\`json
{ "title": "Another example", "scheduledAt": "2026-04-15T10:00:00-06:00", "contentType": "${exampleType2}", "tone": "energetic", "brief": "Another short description.", "channels": ["general"] }
\`\`\`

Fields:
- title: catchy post title in your authentic voice
- scheduledAt: ISO datetime (timezone: America/Denver, MDT = UTC-6)
- contentType: one of ${typeList}
- tone: one of energetic, calm, educational, humorous, inspiring, conversational
- brief: 2-3 sentence description of what to create when this executes
- channels: optional array of runtime channel IDs (default: ["general"])

NEVER wrap multiple items in a JSON array. Always one object per \`\`\`json block.

## Revising Existing Proposals

When Mark asks you to edit, revise, or update an existing proposal, include the proposal's "id" field so the system updates it in place instead of creating a duplicate:

\`\`\`json
{ "id": "existing-proposal-id", "title": "Updated title", "scheduledAt": "...", "contentType": "...", "tone": "...", "brief": "...", "channels": ["general"] }
\`\`\`

Rules for revisions:
- Only modify the items Mark asked about — do NOT regenerate the entire plan
- Keep approved items unchanged unless explicitly asked to modify them
- If a rejection note is provided, address the feedback specifically
- Always include the "id" field from the Current Plan State when revising an existing item
- If you cannot find the ID, match by title — but "id" is strongly preferred`)

  // Plan state
  const planState = buildPlanState(session)
  if (planState) {
    sections.push(planState)
  }

  return sections.join('\n\n---\n\n')
}

/**
 * Build a proper messages array from session history plus a new user message.
 * Returns an array suitable for the OpenAI-compatible chat completions API.
 */
export function buildMessages(
  session: PlanningSession,
  newMessage: string,
  options: PromptBuilderOptions,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

  // System prompt
  messages.push({
    role: 'system',
    content: buildSystemPrompt(session.agentId, session, options),
  })

  // Session history
  for (const msg of session.messages) {
    messages.push({
      role: msg.role,
      content: msg.content,
    })
  }

  // New user message
  messages.push({
    role: 'user',
    content: newMessage,
  })

  return messages
}
