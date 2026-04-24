'use client'

import { ChevronDown, Sparkles, type LucideIcon } from 'lucide-react'

interface CollapsedHeaderProps {
  open: boolean
  collapsible: boolean
  onToggle: () => void
  label: string
  icon: LucideIcon
  replyCount: number
  bodyId: string
}

export function CollapsedHeader({
  open,
  collapsible,
  onToggle,
  label,
  icon: Icon,
  replyCount,
  bodyId,
}: CollapsedHeaderProps) {
  const className = `flex items-center justify-center gap-2 text-xs text-zinc-500 transition-colors shrink-0 ${
    open ? 'mb-2' : ''
  } ${collapsible ? 'hover:text-zinc-300 cursor-pointer' : 'cursor-default'}`

  if (!collapsible) {
    return (
      <div className={className}>
        <Icon className="size-3.5" />
        <span className="font-medium">{label}</span>
        {replyCount > 0 && (
          <span className="text-[10px] text-zinc-600 font-mono">
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </span>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={bodyId}
      className={className}
    >
      <Icon className="size-3.5" />
      <span className="font-medium">{label}</span>
      {replyCount > 0 && (
        <span className="text-[10px] text-zinc-600 font-mono">
          {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </span>
      )}
      <ChevronDown className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  )
}

export const DEFAULT_LABEL = 'Brainstorm'
export const DEFAULT_ICON: LucideIcon = Sparkles
