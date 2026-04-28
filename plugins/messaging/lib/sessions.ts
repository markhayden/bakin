/**
 * Planning session storage. All persistence goes through ctx.storage so the
 * plugin works the same as a built-in plugin and as an extracted plugin.
 */
import type { StorageAdapter } from '@bakin/sdk/types'
import { generateId } from './ids'
import type { MessagingStorage } from './storage'
import type {
  CalendarItem,
  PlanningSession,
  ProposalStatus,
  ProposedItem,
  SessionMessage,
} from '../types'
import { DEFAULT_CHANNEL } from '../types'

const SESSIONS_DIR = 'messaging/sessions'

function sessionPath(sessionId: string): string {
  return `${SESSIONS_DIR}/${sessionId}.json`
}

function readJson<T>(storage: StorageAdapter, path: string): T | null {
  try {
    if (storage.readJson) return storage.readJson<T>(path)
    const raw = storage.read(path)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

function writeJson(storage: StorageAdapter, path: string, value: unknown): void {
  if (storage.writeJson) storage.writeJson(path, value)
  else storage.write(path, JSON.stringify(value, null, 2))
}

function normalizeSession(session: PlanningSession): PlanningSession {
  if (!Array.isArray(session.messages)) session.messages = []
  if (!Array.isArray(session.proposals)) session.proposals = []
  return session
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

export interface MessagingSessionStore {
  createSession(opts: { agentId: string; title?: string }): PlanningSession
  loadSession(sessionId: string): PlanningSession | null
  saveSession(session: PlanningSession): void
  listSessions(opts?: { status?: string; agentId?: string }): SessionSummary[]
  updateSession(sessionId: string, updates: { title?: string; status?: 'active' | 'completed' }): PlanningSession
  deleteSession(sessionId: string): void
  appendMessage(sessionId: string, message: { role: 'user' | 'assistant'; content: string }, proposalIds?: string[]): SessionMessage
  addProposals(sessionId: string, messageId: string, items: Array<{
    title: string
    scheduledAt: string
    contentType: string
    tone: string
    brief: string
    channels?: string[]
  }>): ProposedItem[]
  upsertProposals(sessionId: string, messageId: string, items: Array<{
    id?: string
    title: string
    scheduledAt: string
    contentType: string
    tone: string
    brief: string
    channels?: string[]
  }>): ProposedItem[]
  updateProposal(sessionId: string, proposalId: string, updates: {
    status?: ProposalStatus
    title?: string
    brief?: string
    tone?: string
    scheduledAt?: string
    channels?: string[]
    rejectionNote?: string
  }): ProposedItem
  confirmSession(sessionId: string, opts?: { autoApprove?: boolean }): { itemsCreated: number; itemIds: string[] }
}

export function createMessagingSessionStore(
  storage: StorageAdapter,
  messaging: MessagingStorage,
): MessagingSessionStore {
  function createSession(opts: { agentId: string; title?: string }): PlanningSession {
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
    writeJson(storage, sessionPath(session.id), session)
    return session
  }

  function loadSession(sessionId: string): PlanningSession | null {
    const session = readJson<PlanningSession>(storage, sessionPath(sessionId))
    return session ? normalizeSession(session) : null
  }

  function saveSession(session: PlanningSession): void {
    writeJson(storage, sessionPath(session.id), session)
  }

  function listSessions(opts?: { status?: string; agentId?: string }): SessionSummary[] {
    const files = storage.list?.(SESSIONS_DIR).filter(f => f.endsWith('.json')) ?? []
    const summaries: SessionSummary[] = []

    for (const file of files) {
      const session = readJson<PlanningSession>(storage, `${SESSIONS_DIR}/${file}`)
      if (!session) continue
      normalizeSession(session)
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
    }

    return summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  function updateSession(sessionId: string, updates: { title?: string; status?: 'active' | 'completed' }): PlanningSession {
    const session = loadSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (updates.title !== undefined) session.title = updates.title
    if (updates.status !== undefined) session.status = updates.status
    session.updatedAt = new Date().toISOString()
    writeJson(storage, sessionPath(sessionId), session)
    return session
  }

  function deleteSession(sessionId: string): void {
    if (!storage.exists(sessionPath(sessionId))) throw new Error(`Session ${sessionId} not found`)
    storage.remove?.(sessionPath(sessionId))
  }

  function appendMessage(
    sessionId: string,
    message: { role: 'user' | 'assistant'; content: string },
    proposalIds?: string[],
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
    writeJson(storage, sessionPath(sessionId), session)
    return msg
  }

  function upsertProposals(
    sessionId: string,
    messageId: string,
    items: Array<{
      id?: string
      title: string
      scheduledAt: string
      contentType: string
      tone: string
      brief: string
      channels?: string[]
    }>,
  ): ProposedItem[] {
    const session = loadSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    const result: ProposedItem[] = []

    for (const item of items) {
      let existing = item.id ? session.proposals.find(p => p.id === item.id) : undefined
      if (!existing) {
        const titleLower = item.title.toLowerCase().trim()
        existing = session.proposals.find(p => p.title.toLowerCase().trim() === titleLower && p.status !== 'approved')
      }

      if (existing) {
        existing.title = item.title
        existing.scheduledAt = item.scheduledAt
        existing.contentType = item.contentType
        existing.tone = item.tone
        existing.brief = item.brief
        if (item.channels) existing.channels = normalizeChannels(item.channels)
        existing.messageId = messageId
        existing.revision += 1
        if (existing.status === 'rejected') existing.status = 'revised'
        result.push(existing)
      } else {
        const newProposal: ProposedItem = {
          id: generateId(),
          messageId,
          revision: 1,
          agentId: session.agentId,
          title: item.title,
          scheduledAt: item.scheduledAt,
          contentType: item.contentType,
          tone: item.tone,
          brief: item.brief,
          channels: normalizeChannels(item.channels),
          status: 'proposed',
        }
        session.proposals.push(newProposal)
        result.push(newProposal)
      }
    }

    session.updatedAt = new Date().toISOString()
    writeJson(storage, sessionPath(sessionId), session)
    return result
  }

  function addProposals(
    sessionId: string,
    messageId: string,
    items: Array<{
      title: string
      scheduledAt: string
      contentType: string
      tone: string
      brief: string
      channels?: string[]
    }>,
  ): ProposedItem[] {
    return upsertProposals(sessionId, messageId, items)
  }

  function updateProposal(
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
    },
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
    writeJson(storage, sessionPath(sessionId), session)
    return proposal
  }

  function confirmSession(sessionId: string, opts: { autoApprove?: boolean } = {}): { itemsCreated: number; itemIds: string[] } {
    const session = loadSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (session.status === 'completed') throw new Error('Session already completed')
    const approved = session.proposals.filter(p => p.status === 'approved')
    if (approved.length === 0) throw new Error('No approved proposals to confirm')

    const itemIds: string[] = []
    const initialStatus: CalendarItem['status'] = opts.autoApprove ? 'scheduled' : 'draft'
    for (const proposal of approved) {
      const item = messaging.createItem({
        title: proposal.title,
        agent: proposal.agentId as CalendarItem['agent'],
        contentType: proposal.contentType as CalendarItem['contentType'],
        tone: proposal.tone as CalendarItem['tone'],
        scheduledAt: proposal.scheduledAt,
        brief: proposal.brief,
        status: initialStatus,
        sessionId,
        channels: normalizeChannels(proposal.channels),
      })
      proposal.calendarItemId = item.id
      itemIds.push(item.id)
    }

    session.status = 'completed'
    session.updatedAt = new Date().toISOString()
    writeJson(storage, sessionPath(sessionId), session)
    return { itemsCreated: itemIds.length, itemIds }
  }

  return {
    createSession,
    loadSession,
    saveSession,
    listSessions,
    updateSession,
    deleteSession,
    appendMessage,
    addProposals,
    upsertProposals,
    updateProposal,
    confirmSession,
  }
}

function normalizeChannels(channels: string[] | undefined): string[] {
  if (!channels) return [DEFAULT_CHANNEL]
  const normalized = channels.map(channel => channel.trim()).filter(Boolean)
  return normalized.length > 0 ? normalized : [DEFAULT_CHANNEL]
}
