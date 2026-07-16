'use client'

import { useState } from 'react'
import { CalendarDays, ExternalLink } from 'lucide-react'
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@makinbakin/sdk/ui"
import { ConfirmDialog } from "@makinbakin/sdk/components"
import type { ScheduledDomainEvent } from "@makinbakin/sdk/hooks"

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
          className={`
            group/event block w-full text-left rounded-md mb-1 border border-dashed
            ${due ? 'border-rose-400/40 bg-rose-500/[0.05]' : 'border-teal-400/40 bg-teal-500/[0.05]'}
            transition-all duration-200 hover:brightness-125
            ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}
          `}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <CalendarDays className={`size-3 shrink-0 ${due ? 'text-rose-400' : 'text-teal-400'}`} />
            <span className={`font-medium truncate flex-1 leading-tight text-zinc-200 ${compact ? 'text-[11px]' : 'text-sm'}`}>
              {event.title}
            </span>
            <span className={`font-mono opacity-70 shrink-0 tabular-nums ${due ? 'text-rose-400' : 'text-teal-400'} ${compact ? 'text-[9px]' : 'text-xs'}`}>
              {time}
            </span>
          </span>
          <span className={`block mt-0.5 text-[9px] uppercase tracking-wider ${due ? 'text-rose-400/60' : 'text-teal-400/60'} ${compact ? 'pl-[18px]' : ''}`}>
            {event.pluginId} · {event.kind}{event.status ? ` · ${event.status}` : ''}
          </span>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-3" align="start">
          <div>
            <p className="text-sm font-medium text-foreground">{event.title}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
              {event.pluginId} · {event.kind}{event.status ? ` · ${event.status}` : ''}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {due ? 'Due' : 'Starts'}{' '}
            {new Date(eventInstant(event)).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
          <div className="flex items-center gap-2">
            {event.url && (
              <a
                href={event.url}
                className="inline-flex items-center rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
              >
                <ExternalLink className="size-3.5 mr-1.5" /> Open
              </a>
            )}
            {event.reschedulable && (
              <Button variant="outline" size="sm" onClick={() => { setError(null); setRescheduling(true) }}>
                <CalendarDays className="size-3.5 mr-1.5" /> Reschedule
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
        <div className="space-y-2">
          <Input
            type="datetime-local"
            aria-label="New date and time"
            value={newInstant}
            onChange={(e) => setNewInstant(e.target.value)}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      </ConfirmDialog>
    </>
  )
}
