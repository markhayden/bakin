import type { ContentChannel, ContentStatus, ContentTone } from './types'

export const STATUS_BADGE: Record<ContentStatus, string> = {
  draft: 'bg-zinc-500/20 text-zinc-400',
  scheduled: 'bg-sky-500/20 text-sky-400',
  executing: 'bg-amber-500/20 text-amber-400',
  waiting: 'bg-amber-500/20 text-amber-400',
  review: 'bg-yellow-500/20 text-yellow-300',
  published: 'bg-emerald-500/20 text-emerald-400',
  failed: 'bg-red-500/20 text-red-400',
}

export const TONE_LABELS: Record<ContentTone, string> = {
  energetic: 'Energetic',
  calm: 'Calm',
  educational: 'Educational',
  humorous: 'Humorous',
  inspiring: 'Inspiring',
  conversational: 'Conversational',
}

// Channel label/initials remain as literal maps until the future
// workflows.notificationChannels registry lands (plugin-system spec). The
// type is already widened to string, so looking up an unknown channel
// returns undefined and callers fall back to the raw id.
export const CHANNEL_LABELS: Record<ContentChannel, string> = {
  discord: 'Discord',
  instagram: 'Instagram',
  email: 'Email',
  twitter: 'Twitter',
  youtube: 'YouTube',
  tiktok: 'TikTok',
}

export const CHANNEL_INITIALS: Record<ContentChannel, string> = {
  discord: 'DC',
  instagram: 'IG',
  email: 'EM',
  twitter: 'TW',
  youtube: 'YT',
  tiktok: 'TK',
}
