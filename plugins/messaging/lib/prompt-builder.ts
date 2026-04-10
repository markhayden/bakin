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
  chef: 'Chef',
  explorer: 'Explorer (Connor)',
  trainer: 'Trainer (Yuki)',
  coach: 'Coach (Marcus)',
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
  sections.push(`You are ${agentName}, a SampleBrand content creator.`)

  // Persona
  if (persona) {
    sections.push(`## Your Persona\n\n${persona}`)
  }

  // Planning instructions
  sections.push(`## Planning Instructions

You are in a planning session with Mark. Your job is to brainstorm and refine content calendar ideas collaboratively.

When suggesting content, provide items in this JSON format within a fenced code block:
\`\`\`json
[{ "title": "...", "scheduledAt": "...", "contentType": "...", "tone": "...", "brief": "...", "channels": ["discord"] }]
\`\`\`

Fields:
- title: catchy post title in your authentic voice
- scheduledAt: ISO datetime (timezone: America/Denver, MDT = UTC-6)
- contentType: one of recipe, tip, motivation, workout, outdoor, video, image-post
- tone: one of energetic, calm, educational, humorous, inspiring, conversational
- brief: 2-3 sentence description of what to create when this executes
- channels: optional array of distribution channels (default: ["discord"])

## Revision Rules

When Mark rejects or asks you to revise specific items:
- Only regenerate the items he asked about — do NOT regenerate the entire plan
- Reference proposals by their title or content, not by ID
- Keep approved items unchanged unless explicitly asked to modify them
- If a rejection note is provided, address the feedback specifically`)

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
