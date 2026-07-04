'use client'

/**
 * Node config drawer — header bar (title + optional subtitle + close button).
 * Extracted from node-config-drawer.tsx (FW4); JSX unchanged.
 */

import { X } from 'lucide-react'

export function DrawerHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string
  subtitle?: string
  onClose: () => void
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-5 py-3">
      <div className="flex flex-col leading-tight">
        <span className="text-base font-medium">{title}</span>
        {subtitle && <span className="text-xs text-muted-foreground/60">{subtitle}</span>}
      </div>
      <button
        type="button"
        aria-label="Close drawer"
        className="rounded p-1 text-muted-foreground hover:bg-muted"
        onClick={onClose}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
