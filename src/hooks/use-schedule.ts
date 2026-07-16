'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface ScheduleJob {
  id: string
  displayName: string
  description?: string
  agentId?: string
  /** Team assignment (#189) — mutually exclusive with agentId. */
  teamId?: string
  humanSchedule: string
  cron?: string
  paused: boolean
  pauseReason?: string
  pauseUntil?: string
  skipNextN?: number
  skippedCount?: number
  enabled: boolean
  isBakinJob: boolean
  source?: 'bakin' | 'runtime' | 'adopted'
  canAdopt?: boolean
  canRestoreNative?: boolean
  allowOverlap: boolean
  maxFailures: number
  consecutiveFailures: number
  requireTriage?: boolean
  owner?: string
  workflowId?: string
  taskPrompt?: string
  taskTitle?: string
  toolsAllow?: string[]
  toolsAllowMissing?: boolean
  tz?: string
  lastTaskId?: string
  nextRun?: string
  lastRun?: string
  createdAt?: string
  updatedAt?: string
  /** One-shot ('at') job that has fired: disabled with its consumed instant. */
  completed?: boolean
  completedAt?: string
}

export interface RunEntry {
  runId: string
  timestamp: string
  status: 'success' | 'failure' | 'skipped' | 'pending'
  taskId?: string
  error?: string
  skippedReason?: string // why a 'skipped' fire was skipped (overlap/paused/skip-count/auto-paused)
}

interface UseScheduleOptions {
  agent?: string
}

export function useScheduleJobs(options: UseScheduleOptions = {}) {
  const [jobs, setJobs] = useState<ScheduleJob[]>([])
  const [loading, setLoading] = useState(true)
  // True while the last fetch failed — consumers must not treat the stale
  // (possibly empty) list as ground truth, e.g. for "job not found" notices.
  const [fetchFailed, setFetchFailed] = useState(false)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/schedule/')
      if (res.ok) {
        const data = await res.json()
        setJobs(data.jobs || [])
        setFetchFailed(false)
      } else {
        setFetchFailed(true)
      }
    } catch {
      // Network error — keep existing state
      setFetchFailed(true)
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
    if (opts.agent && j.agentId !== opts.agent) return false
    return true
  })

  const pauseJob = useCallback(async (jobId: string, pauseUntil?: string) => {
    try {
      const res = await fetch(`/api/plugins/schedule/${jobId}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause', pauseUntil }),
      })
      if (res.ok) fetchJobs()
      return res.ok
    } catch { return false }
  }, [fetchJobs])

  const resumeJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/plugins/schedule/${jobId}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume' }),
      })
      if (res.ok) fetchJobs()
      return res.ok
    } catch { return false }
  }, [fetchJobs])

  const deleteJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/plugins/schedule/${jobId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        setJobs(prev => prev.filter(j => j.id !== jobId))
      }
      return res.ok
    } catch { return false }
  }, [])

  const runNow = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/plugins/schedule/${jobId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      return res.ok
    } catch { return false }
  }, [])

  const updateJob = useCallback(async (jobId: string, data: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/plugins/schedule/${jobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) fetchJobs()
      return res.ok
    } catch { return false }
  }, [fetchJobs])

  const adoptJob = useCallback(async (jobId: string, data: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/plugins/schedule/${jobId}/adopt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) fetchJobs()
      return res.ok
    } catch { return false }
  }, [fetchJobs])

  const restoreNative = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/plugins/schedule/${jobId}/restore-native`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) fetchJobs()
      return res.ok
    } catch { return false }
  }, [fetchJobs])

  const skipNext = useCallback(async (jobId: string, n = 1) => {
    try {
      const res = await fetch(`/api/plugins/schedule/${jobId}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'skip', skipN: n }),
      })
      if (res.ok) fetchJobs()
      return res.ok
    } catch { return false }
  }, [fetchJobs])

  const duplicateJob = useCallback(async (jobId: string, overrides: Record<string, unknown> = {}) => {
    // Fetch the current job to copy its data
    const source = jobs.find(j => j.id === jobId)
    if (!source) return false
    try {
      const res = await fetch('/api/plugins/schedule/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: overrides.name ?? `${source.displayName} (copy)`,
          schedule: overrides.schedule ?? source.humanSchedule,
          agentId: overrides.agentId ?? source.agentId,
          teamId: overrides.teamId ?? source.teamId,
          taskPrompt: overrides.taskPrompt ?? source.taskPrompt,
          taskTitle: overrides.taskTitle ?? source.taskTitle,
          workflowId: overrides.workflowId ?? source.workflowId,
          owner: overrides.owner ?? source.owner,
          requireTriage: overrides.requireTriage ?? source.requireTriage,
          allowOverlap: overrides.allowOverlap ?? source.allowOverlap,
          maxFailures: overrides.maxFailures ?? source.maxFailures,
          ...overrides,
        }),
      })
      if (res.ok) fetchJobs()
      return res.ok
    } catch { return false }
  }, [jobs, fetchJobs])

  return {
    jobs: filtered, allJobs: jobs, loading, fetchFailed, refresh: fetchJobs,
    pauseJob, resumeJob, deleteJob, runNow, updateJob, adoptJob, restoreNative, skipNext, duplicateJob,
  }
}

/** One server-computed calendar placement — see plugins/schedule/lib/occurrences.ts. */
export interface ScheduleOccurrence {
  jobId: string
  /** Absolute instant, ISO-8601 UTC — render in the browser's local tz. */
  at: string
  past: boolean
  /** Ledger disposition for past Bakin occurrences (absent = never claimed). */
  disposition?: 'pending' | 'created' | 'skipped' | 'seeded'
  taskId?: string
  skipReason?: string
}

/**
 * Server-computed occurrences for a time range — the ONLY placement source
 * for the calendar views (kind-aware, timezone/DST-correct; the old client-
 * side cron parsing is gone). Refetches on schedule SSE events.
 */
export function useOccurrences(fromIso: string, toIso: string) {
  const [occurrences, setOccurrences] = useState<ScheduleOccurrence[]>([])
  const [unevaluated, setUnevaluated] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const fetchOccurrences = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/schedule/occurrences?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`)
      if (res.ok) {
        const data = await res.json()
        setOccurrences(data.occurrences || [])
        setUnevaluated(data.unevaluated || [])
      }
    } catch { /* transient — SSE or the next range change refetches */ } finally {
      setLoading(false)
    }
  }, [fromIso, toIso])

  useEffect(() => {
    fetchOccurrences()
  }, [fetchOccurrences])

  useEffect(() => {
    const es = new EventSource('/api/events')
    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (
          (data.type === 'activity' && data.message?.includes('Schedule')) ||
          data.event?.startsWith('schedule.') ||
          // Task dates feed the domain-event layer; the store broadcasts on
          // every board write. External providers emit the documented
          // `<pluginId>.scheduled_events_changed` audit event.
          data.type === 'taskboard' ||
          data.event?.endsWith('.scheduled_events_changed')
        ) {
          fetchOccurrences()
        }
      } catch { /* ignore */ }
    }
    es.addEventListener('message', handler)
    return () => {
      es.removeEventListener('message', handler)
      es.close()
    }
  }, [fetchOccurrences])

  return { occurrences, unevaluated, loading, refresh: fetchOccurrences }
}

export function useRunHistory(jobId: string | null, limit = 20) {
  const [runs, setRuns] = useState<RunEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!jobId) { setRuns([]); return }
    setLoading(true)
    fetch(`/api/plugins/schedule/${jobId}/runs?limit=${limit}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setRuns(data.runs || []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [jobId, limit])

  return { runs, loading }
}
