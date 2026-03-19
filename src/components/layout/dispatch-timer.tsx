'use client'

import { useState, useEffect, useCallback } from 'react'
import { Clock, Play } from 'lucide-react'

export function DispatchTimer() {
  const [seconds, setSeconds] = useState<number | null>(null)
  const [running, setRunning] = useState(false)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/dispatch')
      if (res.ok) {
        const data = await res.json()
        setSeconds(data.secondsUntilNext)
      }
    } catch { /* */ }
  }, [])

  useEffect(() => {
    fetchState()
    const interval = setInterval(() => {
      setSeconds(prev => {
        if (prev === null) return null
        if (prev <= 0) {
          fetchState()
          return prev
        }
        return prev - 1
      })
    }, 1000)

    const syncInterval = setInterval(fetchState, 60000)

    return () => {
      clearInterval(interval)
      clearInterval(syncInterval)
    }
  }, [fetchState])

  async function triggerDispatch() {
    setRunning(true)
    try {
      await fetch('/api/dispatch', { method: 'POST' })
      await fetchState()
    } catch { /* */ }
    setRunning(false)
  }

  if (seconds === null) return null

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  const display = `${mins}:${secs.toString().padStart(2, '0')}`

  return (
    <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
      <Clock className="size-3" />
      <span title="Next dispatch">{display}</span>
      <button
        onClick={triggerDispatch}
        disabled={running}
        className="hover:text-foreground transition-colors disabled:opacity-50"
        title="Run dispatch now"
      >
        <Play className={`size-3 ${running ? 'animate-pulse' : ''}`} />
      </button>
    </div>
  )
}
