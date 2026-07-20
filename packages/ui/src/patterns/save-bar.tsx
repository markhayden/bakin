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
        '@container/save-bar sticky bottom-bakin-4 z-30 mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-bakin-3 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default px-bakin-4 py-bakin-3 font-bakin-typography-family-ui text-bakin-text-primary shadow-bakin-elevation-overlay @sm/save-bar:flex-row @sm/save-bar:items-center',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-bakin-3">
        <span
          aria-hidden="true"
          data-slot="save-bar-signal"
          className="mt-bakin-1 size-bakin-3 shrink-0 animate-pulse rounded-bakin-pill bg-bakin-signal-highlight motion-reduce:animate-none"
        />
        <div className="min-w-0">
          <p className="m-0 font-bakin-typography-weight-semibold">Unsaved changes</p>
          {error ? (
            <p role="alert" data-savebar-error="" className="m-0 mt-bakin-1 [overflow-wrap:anywhere] text-bakin-text-primary">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      {children ? <div data-slot="save-bar-context" className="min-w-0 text-bakin-text-muted">{children}</div> : null}

      <div
        role="group"
        aria-label="Draft actions"
        data-slot="save-bar-actions"
        className="flex w-full min-w-0 flex-col gap-bakin-2 @sm/save-bar:ml-auto @sm/save-bar:w-auto @sm/save-bar:flex-row"
      >
        <Button variant="ghost" onClick={onDiscard} disabled={saving}>
          {discardLabel}
        </Button>
        <Button onClick={onSave} disabled={saving} data-savebar-save="">
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
