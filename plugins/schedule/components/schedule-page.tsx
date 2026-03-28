'use client'

import { useState } from 'react'
import { AlarmClock, List, CalendarDays, CalendarRange, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BeaconDrawer } from '@/components/beacon-drawer'
import { AGENTS } from '@/lib/constants'
import { useScheduleJobs, type ScheduleJob } from '@/hooks/use-schedule'
import { JobList } from './job-list'
import { JobDrawer } from './job-drawer'
import { JobForm } from './job-form'
import { CalendarMonthly } from './calendar-monthly'
import { CalendarWeekly } from './calendar-weekly'

type ViewMode = 'list' | 'month' | 'week'

const VIEW_ICONS: Record<ViewMode, typeof List> = {
  list: List,
  month: CalendarDays,
  week: CalendarRange,
}

export function SchedulePage() {
  const [view, setView] = useState<ViewMode>('week')
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [beaconOnly, setBeaconOnly] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedJob, setSelectedJob] = useState<ScheduleJob | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const { jobs, loading, refresh, pauseJob, resumeJob, deleteJob, runNow } = useScheduleJobs({
    agent: agentFilter === 'all' ? undefined : agentFilter,
    beaconOnly,
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleCreate = async (data: any) => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/plugins/schedule/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        setShowForm(false)
        refresh()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 flex flex-col flex-1 gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <AlarmClock className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Schedule</h1>
        <span className="text-sm text-muted-foreground">
          {loading ? '...' : `${filtered.length} job${filtered.length !== 1 ? 's' : ''}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-md border border-border/50 overflow-hidden">
            {(['list', 'week', 'month'] as ViewMode[]).map(v => {
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

          <Button size="sm" onClick={() => setShowForm(true)}>
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
            beaconOnly
              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              : 'text-muted-foreground border-border hover:text-foreground'
          }`}
          onClick={() => setBeaconOnly(!beaconOnly)}
        >
          Beacon only
        </button>
      </div>

      {/* Content */}
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
        />
      ) : view === 'month' ? (
        <CalendarMonthly jobs={filtered} onSelectJob={setSelectedJob} />
      ) : (
        <CalendarWeekly jobs={filtered} onSelectJob={setSelectedJob} />
      )}

      {/* Detail drawer */}
      <JobDrawer
        job={selectedJob}
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        onPause={pauseJob}
        onResume={resumeJob}
      />

      {/* Create job form */}
      <BeaconDrawer
        open={showForm}
        onOpenChange={(o) => { if (!o) setShowForm(false) }}
        title="New Scheduled Job"
      >
        <JobForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
          submitting={submitting}
        />
      </BeaconDrawer>
    </div>
  )
}
