// ---------------------------------------------------------------------------
// Identifier aliases — all plain strings.
//
// These used to be string-literal unions tied to one installation's roster
// (agents: basil/scout/nemo/zen; channels: general/announcements/...; content
// types: recipe/tip/motivation/...). They now exist as documented aliases
// so call sites self-describe what the string represents:
//   - ContentAgent   resolves against the runtime roster via team.* hooks
//   - ContentChannel is an opaque runtime channel id
//   - ContentType    resolves against MessagingSettings.contentTypes
// ---------------------------------------------------------------------------
export type ContentAgent = string
export type ContentChannel = string
export type ContentType = string
export type ContentTone = 'energetic' | 'calm' | 'educational' | 'humorous' | 'inspiring' | 'conversational'
export type ContentStatus = 'draft' | 'scheduled' | 'executing' | 'waiting' | 'review' | 'published' | 'failed'

export interface CalendarItem {
  id: string
  createdAt: string
  updatedAt: string
  scheduledAt: string
  agent: ContentAgent
  contentType: ContentType
  title: string
  brief: string
  tone: ContentTone
  status: ContentStatus
  channels: ContentChannel[]
  draft?: {
    caption: string
    imagePrompt?: string
    videoPrompt?: string
    imageFilename?: string
    videoFilename?: string
    agentNotes?: string
  }
  publishedAt?: string
  publishedMessageId?: string
  taskId?: string
  rejectionNote?: string
  sessionId?: string
}

// ---------------------------------------------------------------------------
// Planning Sessions
// ---------------------------------------------------------------------------

export type ProposalStatus = 'proposed' | 'approved' | 'rejected' | 'revised'

export interface ProposedItem {
  id: string
  messageId: string
  revision: number
  agentId: string
  title: string
  scheduledAt: string
  contentType: string
  tone: string
  brief: string
  channels?: ContentChannel[]
  status: ProposalStatus
  calendarItemId?: string
  rejectionNote?: string
}

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  proposalIds?: string[]
}

export interface PlanningSession {
  id: string
  agentId: string
  title: string
  status: 'active' | 'completed'
  createdAt: string
  updatedAt: string
  messages: SessionMessage[]
  proposals: ProposedItem[]
  participants?: string[]
}

export const DEFAULT_CHANNEL = 'general'

// ---------------------------------------------------------------------------
// Plugin settings
// ---------------------------------------------------------------------------

export interface ContentTypeOption {
  id: string
  label: string
}

export interface MessagingSettings {
  defaultView?: 'month' | 'week' | 'list'
  showScheduleJobs?: boolean
  channels?: string
  contentTypes?: ContentTypeOption[]
}

/**
 * Generic default content types, seeded on first activate. Intentionally
 * broad — users customize in settings. Do not ship brand-specific values here.
 */
export const DEFAULT_CONTENT_TYPES: ContentTypeOption[] = [
  { id: 'post',         label: 'Post' },
  { id: 'article',      label: 'Article' },
  { id: 'video',        label: 'Video' },
  { id: 'image',        label: 'Image' },
  { id: 'announcement', label: 'Announcement' },
]
