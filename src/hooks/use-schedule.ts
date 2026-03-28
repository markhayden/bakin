'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface ScheduleJob {
  id: string
  displayName: string
  description?: string
  agentId?: string
  humanSchedule: string
  cron?: string
  paused: boolean
  pauseReason?: string
  pauseUntil?: string
  skipNextN?: number
  skippedCount?: number
  enabled: boolean
  isBeaconJob: boolean
  allowOverlap: boolean
  maxFailures: number
  consecutiveFailures: number
  requireTriage?: boolean
  owner?: string
  workflowId?: string
  taskPrompt?: string
  taskTitle?: string
  tz?: string
  lastTaskId?: string
  nextRun?: string
  lastRun?: string
  createdAt?: string
  updatedAt?: string
}

export interface RunEntry {
  runId: string
  timestamp: string
  status: string
  taskId?: string
  error?: string
}

interface UseScheduleOptions {
  agent?: string
  beaconOnly?: boolean
}

export function useScheduleJobs(options: UseScheduleOptions = {}) {
  const [jobs, setJobs] = useState<ScheduleJob[]>([])
  const [loading, setLoading] = useState(true)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/schedule/jobs')
      if (res.ok) {
        const data = await res.json()
        setJobs(data.jobs || [])
      }
    } catch {
      // Network error — keep existing state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  // Listen for SSE schedule events
  useEffect(() => {
    const es = new EventSource('/api/events')
    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (
          (data.type === 'activity' && data.message?.includes('Schedule')) ||
          data.event?.startsWith('schedule.')
        ) {
          fetchJobs()
        }
      } catch { /* ignore */ }
    }
    es.addEventListener('message', handler)
    return () => {
      es.removeEventListener('message', handler)
      es.close()
    }
  }, [fetchJobs])

  // Apply client-side filters
  const opts = options
  const filtered = jobs.filter(j => {
    if (opts.beaconOnly && !j.isBeaconJob) return false
    if (opts.agent && j.agentId !== opts.agent) return false
    return true
  })

  const pauseJob = useCallback(async (jobId: string, pauseUntil?: string) => {
    try {
      const res = await fetch('/api/plugins/schedule/jobs/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, action: 'pause', pauseUntil }),
      })
      if (res.ok) fetchJobs()
      return res.ok
    } catch { return false }
  }, [fetchJobs])

  const resumeJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch('/api/plugins/schedule/jobs/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, action: 'resume' }),
      })
      if (res.ok) fetchJobs()
      return res.ok
    } catch { return false }
  }, [fetchJobs])

  const deleteJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch('/api/plugins/schedule/jobs/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      if (res.ok) {
        setJobs(prev => prev.filter(j => j.id !== jobId))
      }
      return res.ok
    } catch { return false }
  }, [])

  const runNow = useCallback(async (jobId: string) => {
    try {
      const res = await fetch('/api/plugins/schedule/jobs/run-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      return res.ok
    } catch { return false }
  }, [])

  return { jobs: filtered, loading, refresh: fetchJobs, pauseJob, resumeJob, deleteJob, runNow }
}

export function useRunHistory(jobId: string | null, limit = 20) {
  const [runs, setRuns] = useState<RunEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!jobId) { setRuns([]); return }
    setLoading(true)
    fetch(`/api/plugins/schedule/runs?jobId=${jobId}&limit=${limit}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setRuns(data.runs || []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [jobId, limit])

  return { runs, loading }
}
