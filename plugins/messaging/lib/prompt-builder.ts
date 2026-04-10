/**
 * Prompt builder for planning sessions.
 *
 * Builds a system prompt with agent persona, planning instructions,
 * and current plan state. Returns a proper messages array (not a
 * flattened string) so the LLM can track conversational context.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import type { PlanningSession } from '../types'
import { AGENT_INFO } from '../types'

const AGENT_NAMES: Record<string, string> = {
  basil: 'Basil',
  scout: 'Scout (Connor)',
  nemo: 'Nemo (Yuki)',
  zen: 'Zen (Marcus)',
}

/**
 * Load the agent persona markdown file, or return empty string if missing.
 */
function loadPersona(agentId: string, contentDir?: string): string {
  const dir = contentDir || getContentDir()
  const personaPath = join(dir, 'team', 'personas', `${agentId}.md`)
  if (!existsSync(personaPath)) return ''
  try {
    return readFileSync(personaPath, 'utf-8')
  } catch {
    return ''
  }
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

/**
 * Build the system prompt for a planning session.
 */
export function buildSystemPrompt(agentId: string, session: PlanningSession, contentDir?: string): string {
  const agentName = AGENT_NAMES[agentId] || agentId
  const agentInfo = AGENT_INFO[agentId as keyof typeof AGENT_INFO]
  const persona = loadPersona(agentId, contentDir)

  const sections: string[] = []

  // Identity
  sections.push(`You are ${agentName}, a BetterFit content creator.`)

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
{ "title": "Don't Overstock Your Kitchen", "scheduledAt": "2026-04-14T10:00:00-06:00", "contentType": "tip", "tone": "educational", "brief": "Top 5 essential kitchen tools for new homeowners.", "channels": ["discord"] }
\`\`\`

And for Tuesday:
\`\`\`json
{ "title": "5 Knife Skills Every Beginner Needs", "scheduledAt": "2026-04-15T10:00:00-06:00", "contentType": "video", "tone": "energetic", "brief": "Quick demo of basic knife techniques.", "channels": ["discord"] }
\`\`\`

Fields:
- title: catchy post title in your authentic voice
- scheduledAt: ISO datetime (timezone: America/Denver, MDT = UTC-6)
- contentType: one of recipe, tip, motivation, workout, outdoor, video, image-post
- tone: one of energetic, calm, educational, humorous, inspiring, conversational
- brief: 2-3 sentence description of what to create when this executes
- channels: optional array of distribution channels (default: ["discord"])

NEVER wrap multiple items in a JSON array. Always one object per \`\`\`json block.

## Revising Existing Proposals

When Mark asks you to edit, revise, or update an existing proposal, include the proposal's "id" field so the system updates it in place instead of creating a duplicate:

\`\`\`json
{ "id": "existing-proposal-id", "title": "Updated title", "scheduledAt": "...", "contentType": "...", "tone": "...", "brief": "...", "channels": ["discord"] }
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
  newMessage: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

  // System prompt
  messages.push({
    role: 'system',
    content: buildSystemPrompt(session.agentId, session),
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
