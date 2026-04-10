/**
 * Planning session storage — per-entity JSON files in ~/.bakin/calendar/sessions/
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { generateId } from './ids'
import { createItem } from './storage'
import type {
  PlanningSession,
  SessionMessage,
  ProposedItem,
  ProposalStatus,
  CalendarItem,
} from '../types'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getSessionsDir(contentDir?: string): string {
  return join(contentDir || getContentDir(), 'calendar', 'sessions')
}

function getSessionPath(sessionId: string, contentDir?: string): string {
  return join(getSessionsDir(contentDir), `${sessionId}.json`)
}

function ensureSessionsDir(contentDir?: string): void {
  const dir = getSessionsDir(contentDir)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createSession(opts: {
  agentId: string
  title?: string
}): PlanningSession {
  ensureSessionsDir()
  const now = new Date().toISOString()
  const session: PlanningSession = {
    id: generateId(),
    agentId: opts.agentId,
    title: opts.title || 'New planning session',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    messages: [],
    proposals: [],
  }
  writeFileSync(getSessionPath(session.id), JSON.stringify(session, null, 2))
  return session
}

export function loadSession(sessionId: string): PlanningSession | null {
  const path = getSessionPath(sessionId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

export interface SessionSummary {
  id: string
  agentId: string
  title: string
  status: 'active' | 'completed'
  createdAt: string
  updatedAt: string
  proposalCount: number
  approvedCount: number
}

export function listSessions(opts?: {
  status?: string
  agentId?: string
}): SessionSummary[] {
  const dir = getSessionsDir()
  if (!existsSync(dir)) return []

  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
  const summaries: SessionSummary[] = []

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8')
      const session: PlanningSession = JSON.parse(raw)

      if (opts?.status && session.status !== opts.status) continue
      if (opts?.agentId && session.agentId !== opts.agentId) continue

      summaries.push({
        id: session.id,
        agentId: session.agentId,
        title: session.title,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        proposalCount: session.proposals.length,
        approvedCount: session.proposals.filter(p => p.status === 'approved').length,
      })
    } catch {
      // skip malformed files
    }
  }

  return summaries.sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

export function updateSession(
  sessionId: string,
  updates: { title?: string; status?: 'active' | 'completed' }
): PlanningSession {
  const session = loadSession(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)

  if (updates.title !== undefined) session.title = updates.title
  if (updates.status !== undefined) session.status = updates.status
  session.updatedAt = new Date().toISOString()

  writeFileSync(getSessionPath(sessionId), JSON.stringify(session, null, 2))
  return session
}

export function deleteSession(sessionId: string): void {
  const path = getSessionPath(sessionId)
  if (!existsSync(path)) throw new Error(`Session ${sessionId} not found`)
  unlinkSync(path)
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export function appendMessage(
  sessionId: string,
  message: { role: 'user' | 'assistant'; content: string },
  proposalIds?: string[]
): SessionMessage {
  const session = loadSession(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)

  const msg: SessionMessage = {
    id: generateId(),
    role: message.role,
    content: message.content,
    timestamp: new Date().toISOString(),
    proposalIds,
  }

  session.messages.push(msg)
  session.updatedAt = new Date().toISOString()
  writeFileSync(getSessionPath(sessionId), JSON.stringify(session, null, 2))
  return msg
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export function addProposals(
  sessionId: string,
  messageId: string,
  items: Array<{
    title: string
    scheduledAt: string
    contentType: string
    tone: string
    brief: string
    channels?: string[]
  }>
): ProposedItem[] {
  const session = loadSession(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)

  const proposals: ProposedItem[] = items.map(item => ({
    id: generateId(),
    messageId,
    revision: 1,
    agentId: session.agentId,
    title: item.title,
    scheduledAt: item.scheduledAt,
    contentType: item.contentType,
    tone: item.tone,
    brief: item.brief,
    channels: item.channels,
    status: 'proposed' as ProposalStatus,
  }))

  session.proposals.push(...proposals)
  session.updatedAt = new Date().toISOString()
  writeFileSync(getSessionPath(sessionId), JSON.stringify(session, null, 2))
  return proposals
}

export function updateProposal(
  sessionId: string,
  proposalId: string,
  updates: {
    status?: ProposalStatus
    title?: string
    brief?: string
    tone?: string
    scheduledAt?: string
    channels?: string[]
    rejectionNote?: string
  }
): ProposedItem {
  const session = loadSession(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)

  const idx = session.proposals.findIndex(p => p.id === proposalId)
  if (idx === -1) throw new Error(`Proposal ${proposalId} not found`)

  const proposal = session.proposals[idx]
  if (updates.status !== undefined) proposal.status = updates.status
  if (updates.title !== undefined) proposal.title = updates.title
  if (updates.brief !== undefined) proposal.brief = updates.brief
  if (updates.tone !== undefined) proposal.tone = updates.tone
  if (updates.scheduledAt !== undefined) proposal.scheduledAt = updates.scheduledAt
  if (updates.channels !== undefined) proposal.channels = updates.channels
  if (updates.rejectionNote !== undefined) proposal.rejectionNote = updates.rejectionNote

  session.updatedAt = new Date().toISOString()
  writeFileSync(getSessionPath(sessionId), JSON.stringify(session, null, 2))
  return proposal
}

// ---------------------------------------------------------------------------
// Confirm plan
// ---------------------------------------------------------------------------

export function confirmSession(sessionId: string): {
  itemsCreated: number
  itemIds: string[]
} {
  const session = loadSession(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  if (session.status === 'completed') throw new Error('Session already completed')

  const approved = session.proposals.filter(p => p.status === 'approved')
  if (approved.length === 0) throw new Error('No approved proposals to confirm')

  const itemIds: string[] = []

  for (const proposal of approved) {
    const item = createItem({
      title: proposal.title,
      agent: proposal.agentId as CalendarItem['agent'],
      channel: 'discord',
      channelTarget: '',
      contentType: proposal.contentType as CalendarItem['contentType'],
      tone: proposal.tone as CalendarItem['tone'],
      scheduledAt: proposal.scheduledAt,
      brief: proposal.brief,
      status: 'draft',
      sessionId,
      channels: proposal.channels,
    })

    proposal.calendarItemId = item.id
    itemIds.push(item.id)
  }

  session.status = 'completed'
  session.updatedAt = new Date().toISOString()
  writeFileSync(getSessionPath(sessionId), JSON.stringify(session, null, 2))

  return { itemsCreated: itemIds.length, itemIds }
}
