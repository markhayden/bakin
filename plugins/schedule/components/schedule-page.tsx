'use client'

import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { usePathname, useQueryState, useRouter, useSearchParams } from '@makinbakin/sdk/navigation'
import {
  AgentAvatar,
  AgentFilter,
  Page,
  PageBody,
  PageControls,
  PageHeader,
  Pagination,
  SearchDegradedChip,
  SearchInput,
  SearchPartialChip,
  SegmentedControl,
  type SegmentedControlOption,
} from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Badge,
  Drawer,
  Button,
  SystemState,
} from '@makinbakin/sdk/ui'
import {
  useAgentIds,
  useAgentStore,
  useDebug,
  useScheduleJobs,
  useSearch,
  type ScheduleJob,
} from '@makinbakin/sdk/hooks'
import { List, CalendarDays, CalendarRange, Clock, Plus } from 'lucide-react'
import { JobList } from './job-list'
import { JobDrawer } from './job-drawer'
import { JobForm, type JobFormData } from './job-form'
import { DeleteScheduleDialog } from './delete-schedule-dialog'
import { CalendarMonthly } from './calendar-monthly'
import { CalendarWeekly } from './calendar-weekly'
import { CalendarToday } from './calendar-today'

type ViewMode = 'list' | 'today' | 'week' | 'month'
const LIST_PAGE_SIZE = 10

const VIEWS: SegmentedControlOption<ViewMode>[] = [
  { value: 'list', icon: List, label: 'List', hideLabel: true },
  { value: 'today', icon: Clock, label: 'Today', hideLabel: true },
  { value: 'week', icon: CalendarRange, label: 'Week', hideLabel: true },
  { value: 'month', icon: CalendarDays, label: 'Month', hideLabel: true },
]

export function SchedulePage() {
  const agentIds = useAgentIds()
  const agentMap = useAgentStore((state) => state.agentMap)
  const displaySettings = useAgentStore((state) => state.displaySettings)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [view, setView] = useQueryState('view', 'week')
  const [agentFilter, setAgentFilter] = useQueryState('agent', 'all')
  const [search, setSearch] = useQueryState('q', '')
  const [pageParam, setPageParam] = useQueryState('page', '1')
  const [jobIdParam, setJobIdParam, pushJobId] = useQueryState('jobId', '')
  const [mode, setMode, pushMode] = useQueryState('mode', '')

  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ScheduleJob | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [debug] = useDebug()

  const {
    jobs, allJobs, loading, fetchFailed, refresh,
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

  // Honest search signal (spec D11): the substring fallback below keeps the
  // page browsable when the engine is down, but never silently — surface
  // loading, engine-down, and partial-results states next to the filters.
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

  const agentOptions = useMemo(() => agentIds.map((id) => {
    const agent = agentMap[id]
    const display = displaySettings[id]
    const name = display?.displayName ?? agent?.name ?? id
    return {
      value: id,
      label: name,
      visual: (
        <AgentAvatar
          agent={{
            id,
            name,
            imageSrc: agent?.headshot || null,
            color: display?.accentColor,
          }}
          size="xs"
          decorative
        />
      ),
    }
  }), [agentIds, agentMap, displaySettings])

  const showAllJobs = pageParam === 'all'
  const requestedPage = Number.parseInt(pageParam, 10)
  const pageCount = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE))
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), pageCount)
    : 1
  const visibleListJobs = showAllJobs
    ? filtered
    : filtered.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE)

  // Derive drawer/form visibility from URL state. Deep links resolve
  // against the UNFILTERED list — a ?jobId= must open its job even when the
  // active agent filter excludes it from the visible list.
  const selectedJob = jobIdParam ? allJobs.find(j => j.id === jobIdParam) ?? null : null
  const showForm = mode === 'create' || ((mode === 'edit' || mode === 'duplicate' || mode === 'adopt') && !!selectedJob)
  const showDetail = !!selectedJob && !showForm
  // A ?jobId= that matches nothing (job deleted, stale search hit) must be
  // an honest notice, not a silent no-op with a dead param in the URL.
  // Guard on fetchFailed — a failed fetch is not evidence of deletion.
  const jobNotFound = !!jobIdParam && !loading && !fetchFailed && !selectedJob

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
          teamId: data.teamId || null,
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
          agentId: data.agentId || '',
          teamId: data.teamId || '',
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
    teamId: selectedJob.teamId,
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

  const hasActiveResultFilters = agentFilter !== 'all' || Boolean(search.trim())
  const clearResultFilters = () => {
    setAgentFilter('all')
    setSearch('')
  }
  let resultState: ReactNode
  if (loading) {
    resultState = (
      <SystemState
        kind="loading"
        title="Loading scheduled jobs"
        description="The latest schedule will appear here when it is ready."
      />
    )
  } else if (fetchFailed) {
    resultState = (
      <SystemState
        kind="error"
        recovery="available"
        title="Schedule could not be loaded"
        description="The schedule service did not return a usable job list."
        action={<Button variant="outline" onClick={() => void refresh()}>Try again</Button>}
      />
    )
  } else if (filtered.length === 0) {
    resultState = hasActiveResultFilters ? (
      <SystemState
        kind="no-results"
        title="No scheduled jobs match this view"
        description="Clear the current search and agent filter to return to the complete schedule."
        action={<Button variant="outline" onClick={clearResultFilters}>Clear search and filters</Button>}
      />
    ) : (
      <SystemState
        kind="initial-empty"
        title="No scheduled jobs yet"
        description="Create the first job to automate recurring work."
        action={<Button onClick={openCreate}><Plus />Create first job</Button>}
      />
    )
  }

  const searchFeedback = searchHook.status === 'unavailable' || searchHook.meta?.partial ? (
    <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
      {searchHook.status === 'unavailable' ? <SearchDegradedChip testId="schedule-search-degraded" /> : null}
      {searchHook.meta?.partial ? <SearchPartialChip meta={searchHook.meta} /> : null}
    </div>
  ) : null

  const pageFeedback = jobNotFound || searchFeedback ? (
    <div className="grid min-w-0 gap-bakin-3">
      {jobNotFound ? (
        <Alert tone="danger" data-testid="schedule-job-not-found">
          <AlertTitle>Scheduled job not found</AlertTitle>
          <AlertDescription>It may have been deleted since this link was created.</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="xs" onClick={closeJob}>
              Dismiss
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      {searchFeedback}
    </div>
  ) : null

  return (
    <>
      <Page scroll="contained">
      <PageHeader
        title="Schedule"
        description="Plan recurring work and see exactly when each agent, workflow, and system event will run."
        meta={loading ? undefined : (
          <Badge data-testid="header-count" size="xs" variant="outline">
            {filtered.length} shown
          </Badge>
        )}
        controlsLabel="Schedule search, view, and actions"
        controls={(
          <div className="grid w-full min-w-0 gap-bakin-2 @3xl/page-header:flex @3xl/page-header:items-start">
            <SearchInput
              align="end"
              label="Schedule search"
              value={search}
              onValueChange={setSearch}
              placeholder="Search jobs…"
              busy={searchHook.status === 'loading'}
              mobileFullWidth
              className="@3xl/page-header:w-[22rem] @3xl/page-header:shrink-0"
            />
            <div className="flex min-w-0 flex-wrap items-center gap-bakin-2 @3xl/page-header:shrink-0 @3xl/page-header:flex-nowrap">
              <SegmentedControl
                options={VIEWS}
                value={view as ViewMode}
                onValueChange={setView}
                ariaLabel="Schedule view"
                idPrefix="schedule-view"
                size="md"
                className="shrink-0 [&_[role=tab]]:px-bakin-3"
              />
              <Button className="min-w-28 flex-1 @3xl/page-header:flex-none" onClick={openCreate}>
                <Plus />
                New Job
              </Button>
            </div>
          </div>
        )}
      />

      <PageControls label="Schedule filters">
        <AgentFilter
          options={agentOptions}
          value={agentFilter}
          onValueChange={setAgentFilter}
          compact
        />
      </PageControls>

      <PageBody
        label="Scheduled jobs"
        busy={!loading && searchHook.status === 'loading'}
        feedback={pageFeedback}
        state={resultState}
        className="min-h-0 flex-1"
      >
        <div
          id={`schedule-view-panel-${view}`}
          role="tabpanel"
          aria-labelledby={`schedule-view-tab-${view}`}
          className="min-h-0 min-w-0 flex-1 overflow-auto"
        >
          {view === 'list' ? (
            <div className="flex min-w-0 flex-col gap-bakin-3">
              <JobList
                jobs={visibleListJobs}
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
              <Pagination
                ariaLabel="Scheduled jobs pagination"
                page={page}
                pageSize={LIST_PAGE_SIZE}
                showAll={showAllJobs}
                total={filtered.length}
                onPageChange={(nextPage) => setPageParam(String(nextPage))}
                onShowAllChange={(nextShowAll) => setPageParam(nextShowAll ? 'all' : '1')}
              />
            </div>
        ) : view === 'today' ? (
          <CalendarToday jobs={filtered} onSelectJob={openJob} />
        ) : view === 'month' ? (
          <CalendarMonthly jobs={filtered} onSelectJob={openJob} />
        ) : (
          <CalendarWeekly jobs={filtered} onSelectJob={openJob} />
        )}
        </div>
      </PageBody>
      </Page>

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
      <Drawer
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
      </Drawer>
    </>
  )
}
