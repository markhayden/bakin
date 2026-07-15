'use client'

import { useState, useEffect, useRef } from 'react'
import { Clock } from 'lucide-react'
import { Input } from "@makinbakin/sdk/ui"
import type { ParseResult } from '../types'

export function ScheduleInput({
  value,
  onChange,
  onParsed,
}: {
  value: string
  onChange: (val: string) => void
  onParsed?: (result: ParseResult | null) => void
}) {
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
      <Input
        placeholder='e.g. "every day at 9am" or "0 9 * * *"'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm"
      />
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
            <span className="text-xs text-muted-foreground font-mono ml-auto">{parsed.expr}</span>
          </div>
          {parsed.nextRuns && parsed.nextRuns.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Next runs</p>
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
