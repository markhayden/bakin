'use client'

import * as React from 'react'

import { Button } from '../primitives/button'
import { cn } from '../utils'

export interface SaveBarProps {
  dirty: boolean
  saving?: boolean
  error?: React.ReactNode
  saveLabel?: string
  retryLabel?: string
  savingLabel?: string
  discardLabel?: string
  /** Visible success copy retained after a successful save. */
  savedLabel?: string
  /** Accessible name announced for the transient success status. */
  savedAnnouncement?: string
  savedDurationMs?: number
  children?: React.ReactNode
  className?: string
  onSave: () => void
  onDiscard: () => void
}

/** Sticky, responsive save/discard boundary for a consumer-owned staged draft. */
export function SaveBar({
  dirty,
  saving = false,
  error,
  saveLabel = 'Save changes',
  retryLabel = 'Retry save',
  savingLabel = 'Saving…',
  discardLabel = 'Discard',
  savedLabel = 'Saved ✓',
  savedAnnouncement = 'Changes saved',
  savedDurationMs = 2000,
  children,
  className,
  onSave,
  onDiscard,
}: SaveBarProps) {
  const [saved, setSaved] = React.useState(false)
  const previousSaving = React.useRef(saving)

  React.useEffect(() => {
    const wasSaving = previousSaving.current
    previousSaving.current = saving
    if (!wasSaving || saving || dirty || error) return

    setSaved(true)
    const timeout = setTimeout(() => setSaved(false), savedDurationMs)
    return () => clearTimeout(timeout)
  }, [dirty, error, savedDurationMs, saving])

  if (!dirty && !saved) return null

  if (!dirty) {
    return (
      <div
        role="status"
        aria-label={savedAnnouncement}
        aria-live="polite"
        data-savebar=""
        data-savebar-state="saved"
        data-slot="save-bar"
        className={cn(
          'sticky bottom-bakin-4 z-30 mx-auto flex w-fit max-w-full items-center gap-bakin-2 rounded-bakin-surface border border-bakin-action-primary-background/60 bg-bakin-surface-default px-bakin-4 py-bakin-2 font-bakin-typography-family-ui text-bakin-text-primary shadow-bakin-elevation-overlay',
          className,
        )}
      >
        <span>{savedLabel}</span>
      </div>
    )
  }

  return (
    <section
      role="region"
      aria-label={saving ? 'Saving changes' : 'Unsaved changes'}
      aria-busy={saving || undefined}
      data-savebar=""
      data-savebar-state={saving ? 'saving' : error ? 'error' : 'dirty'}
      data-slot="save-bar"
      className={cn(
        'sticky bottom-bakin-3 z-30 mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-bakin-2 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default px-bakin-3 py-bakin-2 font-bakin-typography-family-ui text-bakin-text-primary shadow-bakin-elevation-overlay sm:flex-row sm:items-center',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-bakin-2 gap-y-bakin-1">
          <span
            aria-hidden="true"
            data-slot="save-bar-signal"
            className="size-bakin-2 shrink-0 animate-pulse rounded-bakin-pill bg-bakin-signal-highlight motion-reduce:animate-none"
          />
          <p className="m-0 font-bakin-typography-weight-semibold">Unsaved changes</p>
          {children ? (
            <div
              data-slot="save-bar-context"
              className="min-w-0 truncate text-bakin-typography-size-meta text-bakin-text-muted"
            >
              {children}
            </div>
          ) : null}
          {error ? (
            <p
              role="alert"
              data-savebar-error=""
              className="m-0 basis-full [overflow-wrap:anywhere] text-bakin-typography-size-meta text-bakin-text-primary"
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div
        role="group"
        aria-label="Draft actions"
        data-slot="save-bar-actions"
        className="flex w-full min-w-0 gap-bakin-2 sm:ml-auto sm:w-auto"
      >
        <Button className="flex-1 sm:flex-none" variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
          {discardLabel}
        </Button>
        <Button className="flex-1 sm:flex-none" size="sm" onClick={onSave} disabled={saving} data-savebar-save="">
          {saving ? (
            <span
              aria-hidden="true"
              className="size-bakin-3 animate-spin rounded-bakin-pill border-2 border-current border-r-transparent motion-reduce:animate-none"
            />
          ) : null}
          {saving ? savingLabel : error ? retryLabel : saveLabel}
        </Button>
      </div>
    </section>
  )
}
