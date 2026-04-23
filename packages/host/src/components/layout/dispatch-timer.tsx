import { useState, useEffect, useCallback, useRef } from 'react'
import { Clock, Play } from 'lucide-react'

export function DispatchTimer() {
  const [seconds, setSeconds] = useState<number | null>(null)
  const [isDispatching, setIsDispatching] = useState(false)
  const [running, setRunning] = useState(false)
  const fetchingRef = useRef(false)

  const fetchState = useCallback(async () => {
    // Prevent overlapping fetches (avoids spamming when countdown hits 0)
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const res = await fetch('/api/dispatch')
      if (res.ok) {
        const data = await res.json()
        setSeconds(data.secondsUntilNext)
        setIsDispatching(!!data.dispatching)
      }
    } catch { /* */ }
    fetchingRef.current = false
  }, [])

  useEffect(() => {
    fetchState()
    const interval = setInterval(() => {
      setSeconds(prev => {
        if (prev === null) return null
        if (prev <= 1) {
          // Re-sync from server when timer expires
          fetchState()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    // Periodic sync every 60s as a safety net
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
  const display = isDispatching ? 'running' : `${mins}:${secs.toString().padStart(2, '0')}`

  return (
    <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
      <Clock className={`size-3 ${isDispatching ? 'animate-pulse' : ''}`} />
      <span title="Next dispatch">{display}</span>
      <button
        onClick={triggerDispatch}
        disabled={running || isDispatching}
        className="hover:text-foreground transition-colors disabled:opacity-50"
        title="Run dispatch now"
      >
        <Play className={`size-3 ${running ? 'animate-pulse' : ''}`} />
      </button>
    </div>
  )
}
