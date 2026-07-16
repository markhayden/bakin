'use client'

import { useState, useEffect, useRef } from 'react'
import { CalendarClock, Clock, Repeat } from 'lucide-react'
import { Input } from "@makinbakin/sdk/ui"
import type { ParseResult } from '../types'

type ScheduleMode = 'recurring' | 'once'

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
        const res = await fetch('/api/plugins/schedule/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: value }),
        })
        if (res.ok) {
          const data = await res.json()
          setParsed(data)
          onParsed?.(data)
        } else {
          const data = await res.json()
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
    <div className="space-y-2">
      <div className="inline-flex rounded-md border border-border/60 p-0.5 text-xs" role="tablist" aria-label="Schedule type">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'recurring'}
          className={`flex items-center gap-1 rounded px-2 py-1 ${mode === 'recurring' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
          onClick={() => setMode('recurring')}
        >
          <Repeat className="size-3" /> Recurring
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'once'}
          className={`flex items-center gap-1 rounded px-2 py-1 ${mode === 'once' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
          onClick={() => setMode('once')}
        >
          <CalendarClock className="size-3" /> One-time
        </button>
      </div>
      <Input
        placeholder={mode === 'once'
          ? 'e.g. "tomorrow at 9am", "in 2 hours", "july 20 at 3pm"'
          : 'e.g. "every day at 9am" or "0 9 * * *"'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm"
      />
      {mode === 'once' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">or pick</span>
          <Input
            type="datetime-local"
            aria-label="Pick a date and time"
            className="text-sm w-auto"
            onChange={(e) => {
              const iso = localInputToIso(e.target.value)
              if (iso) onChange(iso)
            }}
          />
        </div>
      )}
      {loading && (
        <p className="text-xs text-muted-foreground">Parsing...</p>
      )}
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
      {parsed && (
        <div className="rounded-md border border-border/50 bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Clock className="size-3.5 text-muted-foreground" />
            <span className="text-foreground">{parsed.human}</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-border/60 rounded px-1.5 py-0.5">
              {parsed.kind === 'at' ? 'One-time' : 'Recurring'}
            </span>
            <span className="text-xs text-muted-foreground font-mono ml-auto">{parsed.expr}</span>
          </div>
          {parsed.nextRuns && parsed.nextRuns.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {parsed.kind === 'at' ? 'Fires' : 'Next runs'}
              </p>
              {parsed.nextRuns.slice(0, 5).map((run, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  {new Date(run).toLocaleString('en-US', {
                    weekday: 'short', month: 'short', day: 'numeric',
                    hour: 'numeric', minute: '2-digit',
                  })}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
