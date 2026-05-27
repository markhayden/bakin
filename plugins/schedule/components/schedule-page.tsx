'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useRouter, usePathname } from '@makinbakin/sdk/hooks'
import { List, CalendarDays, CalendarRange, Clock, Plus } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { BakinDrawer } from "@makinbakin/sdk/components"
import { PluginHeader } from "@makinbakin/sdk/components"
import { Skeleton } from "@makinbakin/sdk/ui"
import { AgentFilter } from "@makinbakin/sdk/components"
import { useAgentIds } from "@makinbakin/sdk/hooks"
import { useQueryState } from "@makinbakin/sdk/hooks"
import { useSearch } from "@makinbakin/sdk/hooks"
import { useDebug } from "@makinbakin/sdk/hooks"
import { useScheduleJobs, type ScheduleJob } from "@makinbakin/sdk/hooks"
import { JobList } from './job-list'
import { JobDrawer } from './job-drawer'
import { JobForm, type JobFormData } from './job-form'
import { DeleteScheduleDialog } from './delete-schedule-dialog'
import { CalendarMonthly } from './calendar-monthly'
import { CalendarWeekly } from './calendar-weekly'
import { CalendarToday } from './calendar-today'

type ViewMode = 'list' | 'today' | 'week' | 'month'

const VIEWS: { id: ViewMode; icon: typeof List; label: string }[] = [
  { id: 'list', icon: List, label: 'List' },
  { id: 'today', icon: Clock, label: 'Today' },
  { id: 'week', icon: CalendarRange, label: 'Week' },
  { id: 'month', icon: CalendarDays, label: 'Month' },
]

export function SchedulePage() {
  const agentIds = useAgentIds()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [view, setView] = useQueryState('view', 'week')
  const [agentFilter, setAgentFilter] = useQueryState('agent', 'all')
  const [search, setSearch] = useQueryState('q', '')
  const [jobIdParam, setJobIdParam, pushJobId] = useQueryState('jobId', '')
  const [mode, setMode, pushMode] = useQueryState('mode', '')

  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ScheduleJob | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [debug] = useDebug()

  const {
    jobs, loading, refresh,
    pauseJob, resumeJob, deleteJob, runNow, updateJob, adoptJob, restoreNative, skipNext,
  } = useScheduleJobs({
    agent: agentFilter === 'all' ? undefined : agentFilter,
  })

  const searchHook = useSearch({ plugin: 'schedule', facets: ['agent', 'enabled'], debounce: 300 })
  useEffect(() => {
    if (search) searchHook.search(search)
    else searchHook.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Build a score map keyed by job id. Schedule indexes by the raw jobId
  // (see plugins/schedule/index.ts → ctx.search.index(jobId, ...)), so no
  // prefix-strip is needed. Used for both the relevance reorder AND the
  // debug-mode RRF/BM25/SEM overlay rendered in JobRow.
  const scoreMap = useMemo(() => {
    const map = new Map<string, { score: number; indexScores?: Record<string, number> }>()
    for (const r of searchHook.results) {
      map.set(r.id, { score: r.score, indexScores: r.indexScores })
    }
    return map
  }, [searchHook.results])

  const filtered = useMemo(() => {
    if (!search) return jobs
    if (searchHook.results.length) {
      return jobs
        .filter(j => scoreMap.has(j.id))
        .sort((a, b) => (scoreMap.get(b.id)?.score ?? 0) - (scoreMap.get(a.id)?.score ?? 0))
    }
    const q = search.toLowerCase()
    return jobs.filter(j =>
      (j.displayName || '').toLowerCase().includes(q) ||
      j.id.toLowerCase().includes(q) ||
      (j.agentId || '').toLowerCase().includes(q) ||
      j.humanSchedule.toLowerCase().includes(q)
    )
  }, [jobs, search, searchHook.results, scoreMap])

  // Derive drawer/form visibility from URL state
  const selectedJob = jobIdParam ? jobs.find(j => j.id === jobIdParam) ?? null : null
  const showForm = mode === 'create' || ((mode === 'edit' || mode === 'duplicate' || mode === 'adopt') && !!selectedJob)
  const showDetail = !!selectedJob && !showForm

  // --- Transitions ---

  const openJob = (job: ScheduleJob) => pushJobId(job.id)
  const closeJob = () => setJobIdParam('')

  const requestDelete = (jobId: string) => {
    const job = jobs.find(j => j.id === jobId) ?? (selectedJob?.id === jobId ? selectedJob : null)
    if (job) setDeleteTarget(job)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const ok = await deleteJob(deleteTarget.id)
      if (ok) {
        if (jobIdParam === deleteTarget.id) closeJob()
        setDeleteTarget(null)
      }
    } finally {
      setDeleting(false)
    }
  }

  const openCreate = () => {
    // Atomic: set mode=create, clear jobId
    const params = new URLSearchParams(searchParams.toString())
    params.delete('jobId')
    params.set('mode', 'create')
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const openEdit = () => pushMode('edit')
  const openDuplicate = () => pushMode('duplicate')
  const openAdopt = () => pushMode('adopt')

  // Atomic: set both jobId and mode in a single push (used from list/row context)
  const openEditFor = (job: ScheduleJob) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('jobId', job.id)
    params.set('mode', 'edit')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }
  const openDuplicateFor = (job: ScheduleJob) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('jobId', job.id)
    params.set('mode', 'duplicate')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const closeForm = () => {
    setMode('')  // replace — returns to ?jobId=abc or bare /schedule
    refresh()
  }

  const handleFormSubmit = async (data: JobFormData) => {
    setSubmitting(true)
    try {
      if (mode === 'adopt' && selectedJob) {
        const ok = await adoptJob(selectedJob.id, {
          name: data.name,
          schedule: data.schedule,
          agentId: data.agentId || null,
          taskPrompt: data.taskPrompt || null,
          taskTitle: data.taskTitle || null,
          workflowId: data.workflowId || null,
          owner: data.owner || null,
          requireTriage: data.requireTriage,
          allowOverlap: data.allowOverlap,
          maxFailures: data.maxFailures,
        })
        if (ok) closeForm()
      } else if (mode === 'edit' && selectedJob) {
        const ok = await updateJob(selectedJob.id, {
          name: data.name,
          displayName: data.name,
          schedule: data.schedule,
          agentId: data.agentId || null,
          taskPrompt: data.taskPrompt || null,
          taskTitle: data.taskTitle || null,
          workflowId: data.workflowId || null,
          owner: data.owner || null,
          requireTriage: data.requireTriage,
          allowOverlap: data.allowOverlap,
          maxFailures: data.maxFailures,
        })
        if (ok) closeForm()
      } else {
        const res = await fetch('/api/plugins/schedule/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (res.ok) {
          closeForm()
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  // Derive form initial data from URL state
  const formInitial = (mode === 'edit' || mode === 'duplicate' || mode === 'adopt') && selectedJob ? {
    name: mode === 'duplicate' ? `${selectedJob.displayName} (copy)` : selectedJob.displayName,
    schedule: selectedJob.cron || selectedJob.humanSchedule,
    agentId: selectedJob.agentId,
    taskPrompt: selectedJob.taskPrompt,
    taskTitle: selectedJob.taskTitle,
    workflowId: selectedJob.workflowId,
    owner: selectedJob.owner,
    requireTriage: selectedJob.requireTriage,
    allowOverlap: selectedJob.allowOverlap,
    maxFailures: selectedJob.maxFailures,
  } : undefined

  const formTitle = mode === 'edit'
    ? `Edit: ${selectedJob?.displayName}`
    : mode === 'duplicate'
      ? `Duplicate: ${selectedJob?.displayName}`
      : mode === 'adopt'
        ? `Adopt: ${selectedJob?.displayName}`
        : 'New Scheduled Job'

  return (
    <div className="p-6 flex flex-col h-full min-h-0 gap-4">
      {/* Header: title + count + search + view toggle + New Job */}
      <PluginHeader
        title="Schedule"
        count={loading ? undefined : filtered.length}
        search={{ value: search, onChange: setSearch, placeholder: 'Search jobs...' }}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-muted/50 rounded-lg p-0.5">
              {VIEWS.map(v => {
                const Icon = v.icon
                return (
                  <button
                    key={v.id}
                    onClick={() => setView(v.id)}
                    className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                      view === v.id
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    title={v.label}
                  >
                    <Icon className="size-3.5" />
                  </button>
                )
              })}
            </div>
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" />
              New Job
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <AgentFilter agentIds={agentIds} value={agentFilter} onChange={setAgentFilter} />

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : view === 'list' ? (
          <JobList
            jobs={filtered}
            onSelect={openJob}
            onPause={(id) => pauseJob(id)}
            onResume={(id) => resumeJob(id)}
            onRunNow={(id) => runNow(id)}
            onDelete={requestDelete}
            onEdit={openEditFor}
            onDuplicate={openDuplicateFor}
            onAdopt={(job) => {
              const params = new URLSearchParams(searchParams.toString())
              params.set('jobId', job.id)
              params.set('mode', 'adopt')
              router.push(`${pathname}?${params.toString()}`, { scroll: false })
            }}
            onRestoreNative={restoreNative}
            onSkipNext={(id) => skipNext(id)}
            scoreMap={scoreMap}
            showScores={debug && !!search.trim()}
          />
        ) : view === 'today' ? (
          <CalendarToday jobs={filtered} onSelectJob={openJob} />
        ) : view === 'month' ? (
          <CalendarMonthly jobs={filtered} onSelectJob={openJob} />
        ) : (
          <CalendarWeekly jobs={filtered} onSelectJob={openJob} />
        )}
      </div>

      {/* Detail drawer */}
      <JobDrawer
        job={selectedJob}
        open={showDetail}
        onClose={closeJob}
        onPause={pauseJob}
        onResume={resumeJob}
        onDelete={requestDelete}
        onRunNow={runNow}
        onEdit={openEdit}
        onDuplicate={openDuplicate}
        onAdopt={openAdopt}
        onRestoreNative={restoreNative}
        onSkipNext={skipNext}
      />

      <DeleteScheduleDialog
        job={deleteTarget}
        deleting={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Create / Edit / Duplicate form */}
      <BakinDrawer
        open={showForm}
        onOpenChange={(o) => { if (!o) closeForm() }}
        title={formTitle}
        onBack={mode === 'edit' && selectedJob ? closeForm : undefined}
      >
        <JobForm
          onSubmit={handleFormSubmit}
          onCancel={closeForm}
          submitting={submitting}
          initial={formInitial}
          mode={mode === 'duplicate' ? 'duplicate' : mode === 'edit' ? 'edit' : mode === 'adopt' ? 'adopt' : 'create'}
        />
      </BakinDrawer>
    </div>
  )
}
