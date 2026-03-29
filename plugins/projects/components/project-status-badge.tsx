'use client'

import type { ProjectStatus } from '../types'

const STATUS_STYLES: Record<ProjectStatus, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-zinc-500/20', text: 'text-zinc-400', label: 'Draft' },
  active: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Active' },
  completed: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Completed' },
  archived: { bg: 'bg-zinc-600/20', text: 'text-zinc-500', label: 'Archived' },
}

export function ProjectStatusBadge({ status, onClick }: { status: ProjectStatus; onClick?: () => void }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.draft
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${style.bg} ${style.text} ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
      onClick={onClick}
    >
      {style.label}
    </span>
  )
}
