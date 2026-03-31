'use client'

import { useState } from 'react'
import { AlarmClock, List, CalendarDays, CalendarRange, Clock, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BakinDrawer } from '@/components/bakin-drawer'
import { PluginHeader } from '@/components/plugin-header'
import { AGENTS } from '@/lib/constants'
import { useScheduleJobs, type ScheduleJob } from '@/hooks/use-schedule'
import { JobList } from './job-list'
import { JobDrawer } from './job-drawer'
import { JobForm, type JobFormData } from './job-form'
import { CalendarMonthly } from './calendar-monthly'
import { CalendarWeekly } from './calendar-weekly'
import { CalendarToday } from './calendar-today'

type ViewMode = 'list' | 'today' | 'week' | 'month'

const VIEW_ICONS: Record<ViewMode, typeof List> = {
  list: List,
  today: Clock,
  week: CalendarRange,
  month: CalendarDays,
}

type FormMode = 'create' | 'edit' | 'duplicate'

export function SchedulePage() {
  const [view, setView] = useState<ViewMode>('week')
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [bakinOnly, setBakinOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedJob, setSelectedJob] = useState<ScheduleJob | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formMode, setFormMode] = useState<FormMode>('create')
  const [editingJob, setEditingJob] = useState<ScheduleJob | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const {
    jobs, loading, refresh,
    pauseJob, resumeJob, deleteJob, runNow, updateJob, skipNext, duplicateJob,
  } = useScheduleJobs({
    agent: agentFilter === 'all' ? undefined : agentFilter,
    bakinOnly,
  })

  const filtered = search
    ? jobs.filter(j => {
        const q = search.toLowerCase()
        return (
          (j.displayName || '').toLowerCase().includes(q) ||
          j.id.toLowerCase().includes(q) ||
          (j.agentId || '').toLowerCase().includes(q) ||
          j.humanSchedule.toLowerCase().includes(q)
        )
      })
    : jobs

  const openCreate = () => {
    setFormMode('create')
    setEditingJob(null)
    setShowForm(true)
  }

  const openEdit = (job: ScheduleJob) => {
    setFormMode('edit')
    setEditingJob(job)
    setSelectedJob(null)
    setShowForm(true)
  }

  const openDuplicate = (job: ScheduleJob) => {
    setFormMode('duplicate')
    setEditingJob(job)
    setSelectedJob(null)
    setShowForm(true)
  }

  const handleFormSubmit = async (data: JobFormData) => {
    setSubmitting(true)
    try {
      if (formMode === 'edit' && editingJob) {
        // Update existing job
        const ok = await updateJob(editingJob.id, {
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
        if (ok) {
          setShowForm(false)
          setEditingJob(null)
        }
      } else {
        // Create or duplicate
        const res = await fetch('/api/plugins/schedule/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (res.ok) {
          setShowForm(false)
          setEditingJob(null)
          refresh()
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  const formInitial = editingJob ? {
    name: formMode === 'duplicate' ? `${editingJob.displayName} (copy)` : editingJob.displayName,
    schedule: editingJob.humanSchedule,
    agentId: editingJob.agentId,
    taskPrompt: editingJob.taskPrompt,
    taskTitle: editingJob.taskTitle,
    workflowId: editingJob.workflowId,
    owner: editingJob.owner,
    requireTriage: editingJob.requireTriage,
    allowOverlap: editingJob.allowOverlap,
    maxFailures: editingJob.maxFailures,
  } : undefined

  const formTitle = formMode === 'edit'
    ? `Edit: ${editingJob?.displayName}`
    : formMode === 'duplicate'
      ? `Duplicate: ${editingJob?.displayName}`
      : 'New Scheduled Job'

  return (
    <div className="p-6 flex flex-col h-full min-h-0 gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <PluginHeader
          title="Schedule"
          subtitle={loading ? '...' : `${filtered.length} job${filtered.length !== 1 ? 's' : ''}`}
        />
        <div className="ml-auto flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-md border border-border/50 overflow-hidden">
            {(['list', 'today', 'week', 'month'] as ViewMode[]).map(v => {
              const Icon = VIEW_ICONS[v]
              return (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-2 py-1.5 transition-colors ${
                    view === v
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title={v.charAt(0).toUpperCase() + v.slice(1)}
                >
                  <Icon className="size-3.5" />
                </button>
              )
            })}
          </div>

          <Button size="sm" onClick={openCreate}>
            <Plus className="size-3.5 mr-1.5" /> New Job
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search jobs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        <Select value={agentFilter} onValueChange={(v) => setAgentFilter(v ?? 'all')}>
          <SelectTrigger className="w-[150px] h-8 text-sm">
            <SelectValue placeholder="All agents" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All agents</SelectItem>
            {AGENTS.map(a => (
              <SelectItem key={a.id} value={a.id}>
                {a.emoji} {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          className={`text-xs px-2.5 py-1 rounded border transition-colors ${
            bakinOnly
              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              : 'text-muted-foreground border-border hover:text-foreground'
          }`}
          onClick={() => setBakinOnly(!bakinOnly)}
        >
          Bakin only
        </button>
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
            onSelect={setSelectedJob}
            onPause={(id) => pauseJob(id)}
            onResume={(id) => resumeJob(id)}
            onRunNow={(id) => runNow(id)}
            onDelete={(id) => deleteJob(id)}
            onEdit={(job) => openEdit(job)}
            onDuplicate={(job) => openDuplicate(job)}
            onSkipNext={(id) => skipNext(id)}
          />
        ) : view === 'today' ? (
          <CalendarToday jobs={filtered} onSelectJob={setSelectedJob} />
        ) : view === 'month' ? (
          <CalendarMonthly jobs={filtered} onSelectJob={setSelectedJob} />
        ) : (
          <CalendarWeekly jobs={filtered} onSelectJob={setSelectedJob} />
        )}
      </div>

      {/* Detail drawer */}
      <JobDrawer
        job={selectedJob}
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
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
        onOpenChange={(o) => {
          if (!o) {
            setShowForm(false)
            setEditingJob(null)
          }
        }}
        title={formTitle}
      >
        <JobForm
          onSubmit={handleFormSubmit}
          onCancel={() => { setShowForm(false); setEditingJob(null) }}
          submitting={submitting}
          initial={formInitial}
          mode={formMode === 'duplicate' ? 'duplicate' : formMode}
        />
      </BakinDrawer>
    </div>
  )
}
