'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { List, CalendarDays, CalendarRange, Clock, Plus, ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BakinDrawer } from '@/components/bakin-drawer'
import { PluginHeader } from '@/components/plugin-header'
import { AgentAvatar } from '@/components/agent-avatar'
import { useAgentIds } from '@bakin/team/hooks/use-agent-store'
import { useQueryState } from '@/hooks/use-query-state'
import { useSearch } from '@/hooks/use-search'
import { useScheduleJobs, type ScheduleJob } from '@/hooks/use-schedule'
import { JobList } from './job-list'
import { JobDrawer } from './job-drawer'
import { JobForm, type JobFormData } from './job-form'
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

  const {
    jobs, loading, refresh,
    pauseJob, resumeJob, deleteJob, runNow, updateJob, skipNext, duplicateJob,
  } = useScheduleJobs({
    agent: agentFilter === 'all' ? undefined : agentFilter,
  })

  const searchHook = useSearch({ plugin: 'schedule', facets: ['agent', 'enabled'], debounce: 300 })
  useEffect(() => {
    if (search) searchHook.search(search)
    else searchHook.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const filtered = useMemo(() => {
    if (!search) return jobs
    if (searchHook.results.length) {
      const matchIds = new Set(searchHook.results.map(r => r.id))
      const scoreMap = new Map(searchHook.results.map(r => [r.id, r.score]))
      return jobs
        .filter(j => matchIds.has(j.id))
        .sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0))
    }
    const q = search.toLowerCase()
    return jobs.filter(j =>
      (j.displayName || '').toLowerCase().includes(q) ||
      j.id.toLowerCase().includes(q) ||
      (j.agentId || '').toLowerCase().includes(q) ||
      j.humanSchedule.toLowerCase().includes(q)
    )
  }, [jobs, search, searchHook.results])

  // Derive drawer/form visibility from URL state
  const selectedJob = jobIdParam ? jobs.find(j => j.id === jobIdParam) ?? null : null
  const showForm = mode === 'create' || ((mode === 'edit' || mode === 'duplicate') && !!selectedJob)
  const showDetail = !!selectedJob && !showForm

  // --- Transitions ---

  const openJob = (job: ScheduleJob) => pushJobId(job.id)
  const closeJob = () => setJobIdParam('')

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
      if (mode === 'edit' && selectedJob) {
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
  const formInitial = (mode === 'edit' || mode === 'duplicate') && selectedJob ? {
    name: mode === 'duplicate' ? `${selectedJob.displayName} (copy)` : selectedJob.displayName,
    schedule: selectedJob.humanSchedule,
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
      <div className="flex items-center gap-3">
        <ListFilter className="size-3.5 text-muted-foreground shrink-0" />
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
          <button
            onClick={() => setAgentFilter('all')}
            className={`px-2 py-0.5 rounded-md text-xs font-medium transition-all ${
              agentFilter === 'all'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All
          </button>
          {agentIds.map(id => (
            <button
              key={id}
              onClick={() => setAgentFilter(id)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium transition-all ${
                agentFilter === id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100'
              }`}
            >
              <AgentAvatar agentId={id} size="xs" />
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-sm text-muted-foreground">Loading schedule...</div>
          </div>
        ) : view === 'list' ? (
          <JobList
            jobs={filtered}
            onSelect={openJob}
            onPause={(id) => pauseJob(id)}
            onResume={(id) => resumeJob(id)}
            onRunNow={(id) => runNow(id)}
            onDelete={(id) => deleteJob(id)}
            onEdit={openEditFor}
            onDuplicate={openDuplicateFor}
            onSkipNext={(id) => skipNext(id)}
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
        onDelete={deleteJob}
        onRunNow={runNow}
        onEdit={openEdit}
        onDuplicate={openDuplicate}
        onSkipNext={skipNext}
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
          mode={mode === 'duplicate' ? 'duplicate' : mode === 'edit' ? 'edit' : 'create'}
        />
      </BakinDrawer>
    </div>
  )
}
