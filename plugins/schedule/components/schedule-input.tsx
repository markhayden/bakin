'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarClock, Clock, Repeat } from 'lucide-react'
import { SegmentedControl, StatusBadge, type SegmentedControlOption } from '@makinbakin/sdk/patterns'
import { Alert, AlertDescription, FieldError, Input } from '@makinbakin/sdk/ui'
import type { ParseResult } from '../types'

type ScheduleMode = 'recurring' | 'once'

const SCHEDULE_MODES: SegmentedControlOption<ScheduleMode>[] = [
  { value: 'recurring', label: 'Recurring', icon: Repeat },
  { value: 'once', label: 'One-time', icon: CalendarClock },
]

/** ISO string for a datetime-local input value (local wall clock → instant). */
function localInputToIso(value: string): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export function ScheduleInput({
  value,
  onChange,
  onParsed,
}: {
  value: string
  onChange: (val: string) => void
  onParsed?: (result: ParseResult | null) => void
}) {
  const [mode, setMode] = useState<ScheduleMode>(() =>
    /^\d{4}-\d{2}-\d{2}T/i.test(value.trim()) ? 'once' : 'recurring')
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!value.trim()) {
      setParsed(null)
      setError(null)
      onParsed?.(null)
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/plugins/schedule/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: value }),
        })
        if (response.ok) {
          const data = await response.json()
          setParsed(data)
          onParsed?.(data)
        } else {
          const data = await response.json()
          setError(data.error || 'Could not parse schedule')
          setParsed(null)
          onParsed?.(null)
        }
      } catch {
        setError('Failed to reach server')
        setParsed(null)
        onParsed?.(null)
      } finally {
        setLoading(false)
      }
    }, 400)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid min-w-0 gap-bakin-2">
      <SegmentedControl
        options={SCHEDULE_MODES}
        value={mode}
        onValueChange={setMode}
        ariaLabel="Schedule type"
        size="sm"
      />
      <Input
        aria-invalid={Boolean(error)}
        placeholder={mode === 'once'
          ? 'e.g. "tomorrow at 9am", "in 2 hours", "july 20 at 3pm"'
          : 'e.g. "every day at 9am" or "0 9 * * *"'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {mode === 'once' ? (
        <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
          <span className="text-bakin-typography-size-meta uppercase tracking-wider text-bakin-text-muted">
            Or pick
          </span>
          <Input
            type="datetime-local"
            aria-label="Pick a date and time"
            className="w-auto"
            onChange={(event) => {
              const iso = localInputToIso(event.target.value)
              if (iso) onChange(iso)
            }}
          />
        </div>
      ) : null}
      {loading ? (
        <span role="status" className="text-bakin-typography-size-meta text-bakin-text-muted">
          Parsing…
        </span>
      ) : null}
      {error ? <FieldError match>{error}</FieldError> : null}
      {parsed ? (
        <Alert tone="success">
          <Clock aria-hidden="true" className="size-bakin-4" />
          <AlertDescription>
            <span className="flex min-w-0 flex-wrap items-center gap-bakin-2">
              <span className="text-bakin-text-primary">{parsed.human}</span>
              <StatusBadge tone="success" variant="solid" size="xs">
                {parsed.kind === 'at' ? 'One-time' : 'Recurring'}
              </StatusBadge>
              <code className="font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
                {parsed.expr}
              </code>
            </span>
            {parsed.nextRuns?.length ? (
              <span className="mt-bakin-2 grid gap-bakin-1">
                <span className="text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wider text-bakin-text-muted">
                  {parsed.kind === 'at' ? 'Fires' : 'Next runs'}
                </span>
                {parsed.nextRuns.slice(0, 5).map((run) => (
                  <time key={run} className="text-bakin-typography-size-meta text-bakin-text-muted">
                    {new Date(run).toLocaleString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </time>
                ))}
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
