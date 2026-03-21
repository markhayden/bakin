export type ContentAgent = 'basil' | 'scout' | 'nemo' | 'zen'
export type ContentChannel = 'discord'
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
    imagePath?: string
    videoPath?: string
    agentNotes?: string
  }
  publishedAt?: string
  publishedMessageId?: string
  taskId?: string
  rejectionNote?: string
}

export const AGENT_INFO: Record<ContentAgent, { name: string; emoji: string; color: string }> = {
  basil: { name: 'Basil', emoji: '🥗', color: 'green' },
  scout: { name: 'Scout', emoji: '🏕️', color: 'orange' },
  nemo: { name: 'Nemo', emoji: '🏊', color: 'blue' },
  zen: { name: 'Zen', emoji: '🧘', color: 'purple' },
}

export const DISCORD_GENERAL = '1483917792745885768'
