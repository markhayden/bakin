'use client'

import { useState } from 'react'
import { CalendarDays, ExternalLink } from 'lucide-react'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { CalendarItem, ConfirmDialog } from '@makinbakin/sdk/patterns'
import {
  Button,
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  buttonVariants,
} from '@makinbakin/sdk/ui'
import type { ScheduledDomainEvent } from '@makinbakin/sdk/hooks'

/** The instant an event renders by (owner semantics: start, or deadline). */
export function eventInstant(event: ScheduledDomainEvent): string {
  return event.startsAt ?? event.dueAt!
}

function formatEventTime(at: string): string {
  const d = new Date(at)
  const h = d.getHours()
  const m = d.getMinutes()
  const period = h >= 12 ? 'pm' : 'am'
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${display}${period}` : `${display}:${m.toString().padStart(2, '0')}${period}`
}

/**
 * A plugin-contributed domain event on the calendar — visually distinct from
 * job occurrences (dashed border, owner label, no agent identity). Click
 * opens a popover: details + deep link into the owner, and — when the owner
 * supports it — the reschedule flow (whole flow inside the ConfirmDialog).
 */
export function EventChip({
  event,
  compact,
  onRescheduled,
}: {
  event: ScheduledDomainEvent
  /** Dense variant for weekly grid cells; expanded for the Today timeline. */
  compact?: boolean
  onRescheduled: () => void
}) {
  const [rescheduling, setRescheduling] = useState(false)
  const [newInstant, setNewInstant] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const due = event.kind.endsWith('due') || (!event.startsAt && !!event.dueAt)
  const time = formatEventTime(eventInstant(event))

  const confirmReschedule = async () => {
    const ms = Date.parse(newInstant)
    if (!Number.isFinite(ms)) {
      setError('Pick a date and time first')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/plugins/schedule/events/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: event.pluginId, eventId: event.id, to: new Date(ms).toISOString() }),
      })
      if (res.ok) {
        setRescheduling(false)
        setNewInstant('')
        onRescheduled()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'The owner rejected the reschedule')
      }
    } catch {
      setError('Failed to reach server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Popover>
        <PopoverTrigger
          render={(
            <CalendarItem
              tone={due ? 'danger' : 'accent'}
              density={compact ? 'compact' : 'expanded'}
              title={event.title}
              time={time}
              detail={(
                <span className="uppercase tracking-wider">
                  {event.pluginId} · {event.kind}{event.status ? ` · ${event.status}` : ''}
                </span>
              )}
              leading={(
                <CalendarDays
                  className={`size-bakin-3 shrink-0 ${due ? 'text-bakin-signal-danger' : 'text-bakin-signal-accent'}`}
                  aria-hidden="true"
                />
              )}
            />
          )}
        />
        <PopoverContent align="start">
          <PopoverHeader>
            <PopoverTitle className="text-bakin-typography-size-section-title">{event.title}</PopoverTitle>
            <PopoverDescription className="text-bakin-typography-size-body">
              {event.pluginId} · {event.kind}{event.status ? ` · ${event.status}` : ''}
            </PopoverDescription>
          </PopoverHeader>
          <p className="text-bakin-typography-size-meta text-bakin-text-muted">
            {due ? 'Due' : 'Starts'}{' '}
            {new Date(eventInstant(event)).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
          <div className="flex items-center gap-bakin-2">
            {event.url && (
              <PluginLink
                to={event.url}
                className={buttonVariants({ variant: 'outline', size: 'xs' })}
              >
                <ExternalLink aria-hidden="true" /> Open
              </PluginLink>
            )}
            {event.reschedulable && (
              <Button variant="outline" size="xs" onClick={() => { setError(null); setRescheduling(true) }}>
                <CalendarDays aria-hidden="true" /> Reschedule
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <ConfirmDialog
        open={rescheduling}
        busy={busy}
        title={`Reschedule "${event.title}"`}
        description={<>Pick a new {due ? 'deadline' : 'time'}. The change is made by the {event.pluginId} plugin — Schedule never edits its data directly.</>}
        confirmLabel="Reschedule"
        onConfirm={confirmReschedule}
        onCancel={() => { setRescheduling(false); setError(null) }}
      >
        <Field invalid={Boolean(error)}>
          <FieldLabel>New date and time</FieldLabel>
          <FieldControl
            type="datetime-local"
            aria-label="New date and time"
            value={newInstant}
            onChange={(e) => setNewInstant(e.target.value)}
          />
          {error && <FieldError match>{error}</FieldError>}
        </Field>
      </ConfirmDialog>
    </>
  )
}
