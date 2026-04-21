export type ContentAgent = 'chef' | 'explorer' | 'trainer' | 'coach'
export type ContentChannel = 'discord' | 'instagram' | 'email' | 'twitter' | 'youtube' | 'tiktok'
export type ContentType = 'recipe' | 'tip' | 'motivation' | 'workout' | 'outdoor' | 'video' | 'image-post'
export type ContentTone = 'energetic' | 'calm' | 'educational' | 'humorous' | 'inspiring' | 'conversational'
export type ContentStatus = 'draft' | 'scheduled' | 'executing' | 'waiting' | 'review' | 'published' | 'failed'

export interface CalendarItem {
  id: string
  createdAt: string
  updatedAt: string
  scheduledAt: string
  agent: ContentAgent
  channel: ContentChannel
  channelTarget: string
  contentType: ContentType
  title: string
  brief: string
  tone: ContentTone
  status: ContentStatus
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
  channels?: string[]
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
  channels?: string[]
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

export const AGENT_INFO: Record<ContentAgent, { name: string; emoji: string; color: string }> = {
  chef: { name: 'Chef', emoji: '🥗', color: 'green' },
  explorer: { name: 'Explorer', emoji: '🏕️', color: 'orange' },
  trainer: { name: 'Trainer', emoji: '🏊', color: 'blue' },
  coach: { name: 'Coach', emoji: '🧘', color: 'purple' },
}

export const DISCORD_GENERAL = '1483917792745885768'

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
