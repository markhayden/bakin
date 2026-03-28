'use client'

import { BeaconDrawer } from '@/components/beacon-drawer'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { AgentBadge } from './agent-badge'
import { RunHistory } from './run-history'
import { PauseControls } from './pause-controls'
import type { ScheduleJob } from '@/hooks/use-schedule'

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="w-[100px] shrink-0 text-muted-foreground">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  )
}

export function JobDrawer({
  job,
  open,
  onClose,
  onPause,
  onResume,
}: {
  job: ScheduleJob | null
  open: boolean
  onClose: () => void
  onPause: (jobId: string, pauseUntil?: string) => Promise<boolean>
  onResume: (jobId: string) => Promise<boolean>
}) {
  if (!job) return null

  return (
    <BeaconDrawer
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title={
        <span className="flex items-center gap-2">
          {job.displayName || job.id}
          {job.isBeaconJob && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">Beacon</Badge>
          )}
        </span>
      }
    >
      <div className="space-y-6">
        {/* Details */}
        <div className="space-y-3">
          <DetailRow label="Agent">
            <AgentBadge agentId={job.agentId} size="md" />
          </DetailRow>
          <DetailRow label="Schedule">
            {job.humanSchedule}
            {job.tz && <span className="ml-1.5 text-xs text-muted-foreground">({job.tz})</span>}
          </DetailRow>
          {job.cron && <DetailRow label="Cron">{job.cron}</DetailRow>}
          {job.workflowId && <DetailRow label="Workflow">{job.workflowId}</DetailRow>}
          {job.owner && <DetailRow label="Owner">{job.owner}</DetailRow>}
          {job.requireTriage && <DetailRow label="Triage">Required (task created unassigned)</DetailRow>}
          {job.allowOverlap && <DetailRow label="Overlap">Allowed</DetailRow>}
          {job.taskPrompt && (
            <DetailRow label="Prompt">
              <span className="text-xs text-muted-foreground whitespace-pre-wrap">{job.taskPrompt}</span>
            </DetailRow>
          )}
          {job.lastTaskId && (
            <DetailRow label="Last Task">
              <span className="font-mono text-xs">{job.lastTaskId.slice(0, 8)}</span>
            </DetailRow>
          )}
          <DetailRow label="Job ID">
            <span className="font-mono text-xs text-muted-foreground">{job.id}</span>
          </DetailRow>
        </div>

        <Separator />

        {/* Pause controls */}
        <div>
          <h3 className="text-sm font-medium mb-3">Pause / Resume</h3>
          <PauseControls job={job} onPause={onPause} onResume={onResume} />
        </div>

        <Separator />

        {/* Run history */}
        <div>
          <h3 className="text-sm font-medium mb-3">Run History</h3>
          <RunHistory jobId={job.id} />
        </div>
      </div>
    </BeaconDrawer>
  )
}
