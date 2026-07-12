'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface SaveBarProps {
  /** Whether there are staged, unsaved changes. The bar renders only while dirty (or briefly flashing "Saved"). */
  dirty: boolean
  /** Save in flight — disables both actions and spins the save button. */
  saving?: boolean
  /** Inline error from the last failed save. */
  error?: string | null
  /** Save button label (default "Save changes"). */
  saveLabel?: string
  /** Extra content rendered before the actions (e.g. a changed-fields summary). */
  children?: ReactNode
  className?: string
  onSave: () => void
  onDiscard: () => void
}

/**
 * Sticky bottom save/discard bar for pages that stage edits into one draft —
 * the single dirty-state pattern (converges with PluginSettingsRenderer's
 * disabled-until-dirty save; migrating the renderer onto this bar is a tracked
 * follow-up). Renders nothing when clean; after a successful save it flashes
 * "Saved" briefly so success is never silent.
 *
 * Pair with `useUnsavedGuard(dirty)` so a hard navigation can't eat staged edits.
 */
export function SaveBar({
  dirty,
  saving = false,
  error,
  saveLabel = 'Save changes',
  children,
  className,
  onSave,
  onDiscard,
}: SaveBarProps) {
  const [flash, setFlash] = useState(false)
  const prevSaving = useRef(saving)

  useEffect(() => {
    // saving → not-saving with a clean draft and no error = a save landed.
    const was = prevSaving.current
    prevSaving.current = saving
    if (was && !saving && !dirty && !error) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 2000)
      return () => clearTimeout(t)
    }
  }, [saving, dirty, error])

  if (!dirty && !flash) return null

  if (!dirty && flash) {
    return (
      <div
        data-savebar
        data-savebar-state="saved"
        className={cn(
          'sticky bottom-4 z-30 mx-auto flex w-fit items-center gap-2 rounded-xl bg-card px-4 py-2 text-sm shadow-lg ring-1 ring-foreground/10',
          className,
        )}
      >
        <span className="size-2 rounded-full bg-primary" aria-hidden />
        <span className="text-muted-foreground">Saved ✓</span>
      </div>
    )
  }

  return (
    <div
      data-savebar
      data-savebar-state={saving ? 'saving' : 'dirty'}
      className={cn(
        'sticky bottom-4 z-30 flex items-center gap-3 rounded-xl bg-card px-4 py-2.5 shadow-lg ring-1 ring-foreground/10',
        className,
      )}
    >
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-warning" aria-hidden />
      <span className="text-sm text-muted-foreground">Unsaved changes</span>
      {error && (
        <span className="min-w-0 truncate text-sm text-destructive" data-savebar-error>
          {error}
        </span>
      )}
      {children}
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving} data-savebar-save>
          {saving ? (
            <>
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              Saving...
            </>
          ) : (
            saveLabel
          )}
        </Button>
      </div>
    </div>
  )
}

/**
 * Blocks the hard ways out (tab close, reload) while `dirty`. In-app route
 * guards are the router's job — wire those at the page level where the
 * navigation happens.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
}
