'use client'
import { Play, Pencil, Copy, Trash2, SkipForward, MoreHorizontal, Clock, Timer, Workflow, Terminal, CirclePlus, Undo2, Power, ShieldAlert, ShieldCheck } from 'lucide-react'
import { BakinDrawer } from "@makinbakin/sdk/components"
import { AgentAvatar } from "@makinbakin/sdk/components"
import { Badge } from "@makinbakin/sdk/ui"
import { Button } from "@makinbakin/sdk/ui"
import { Separator } from "@makinbakin/sdk/ui"
import { useAgent } from "@makinbakin/sdk/hooks"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@makinbakin/sdk/ui"
import { AgentBadge } from './agent-badge'
import { RunHistory } from './run-history'
import { PauseControls } from './pause-controls'
import type { ScheduleJob } from "@makinbakin/sdk/hooks"

export function JobDrawer({
  job,
  open,
  onClose,
  onPause,
  onResume,
  onDelete,
  onRunNow,
  onEdit,
  onDuplicate,
  onAdopt,
  onRestoreNative,
  onSkipNext,
}: {
  job: ScheduleJob | null
  open: boolean
  onClose: () => void
  onPause: (jobId: string, pauseUntil?: string) => Promise<boolean>
  onResume: (jobId: string) => Promise<boolean>
  onDelete: (jobId: string) => void
  onRunNow: (jobId: string) => Promise<boolean>
  onEdit: () => void
  onDuplicate: () => void
  onAdopt: () => void
  onRestoreNative: (jobId: string) => Promise<boolean>
  onSkipNext: (jobId: string, n?: number) => Promise<boolean>
}) {
  const jobAgent = useAgent(job?.agentId ?? '')

  if (!job) return null

  const handleDelete = () => {
    onDelete(job.id)
  }

  return (
    <BakinDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose()
        }
      }}
      title={
        <span className="flex items-center gap-2">
          {job.displayName || job.id}
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            {job.source === 'adopted' ? 'Adopted' : job.isBakinJob ? 'Bakin schedule' : 'Runtime cron'}
          </Badge>
        </span>
      }
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger className="p-1.5 rounded-md hover:bg-accent transition-colors">
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            {job.isBakinJob ? (
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="size-3.5 mr-2" />
                Duplicate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onAdopt}>
                <CirclePlus className="size-3.5 mr-2" />
                Adopt into Bakin
              </DropdownMenuItem>
            )}
            {job.canRestoreNative && (
              <DropdownMenuItem onClick={() => onRestoreNative(job.id)}>
                <Undo2 className="size-3.5 mr-2" />
                Restore Native
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDelete}
              className="text-red-400 focus:text-red-400"
            >
              <Trash2 className="size-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="space-y-6">
        {/* Agent hero */}
        {(() => {
          const agentId = job.agentId || 'system'
          return (
            <div className="flex items-center gap-4 rounded-lg p-4 border border-border bg-surface">
              {jobAgent ? (
                <AgentAvatar agentId={agentId} size="lg" />
              ) : (
                <AgentBadge agentId={undefined} size="lg" showName={false} />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">{jobAgent?.name || 'System'}</div>
                <div className="flex items-center gap-2 mt-1">
                  {job.paused ? (
                    <Badge className="bg-amber-500/20 text-amber-400">Paused</Badge>
                  ) : job.completed ? (
                    <Badge className="bg-sky-500/20 text-sky-400">Completed</Badge>
                  ) : job.enabled ? (
                    <Badge className="bg-emerald-500/20 text-emerald-400">Active</Badge>
                  ) : (
                    <Badge className="bg-zinc-500/20 text-zinc-400">Disabled</Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                    {job.source === 'adopted' ? 'Adopted' : job.isBakinJob ? 'Bakin schedule' : 'Runtime cron'}
                  </Badge>
                  {job.completed && job.completedAt ? (
                    <span className="text-xs text-muted-foreground">
                      Ran once — {new Date(job.completedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  ) : job.nextRun ? (
                    <span className="text-xs text-muted-foreground">
                      Next: {new Date(job.nextRun).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onRunNow(job.id)}>
            <Play className="size-3.5 mr-1.5" /> Run Now
          </Button>
          {job.isBakinJob ? (
            <>
              <Button variant="outline" size="sm" onClick={() => onSkipNext(job.id, 1)}>
                <SkipForward className="size-3.5 mr-1.5" /> Skip Next
              </Button>
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil className="size-3.5 mr-1.5" /> Edit
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={onAdopt}>
              <CirclePlus className="size-3.5 mr-1.5" /> Adopt into Bakin
            </Button>
          )}
          {job.canRestoreNative && (
            <Button variant="outline" size="sm" onClick={() => onRestoreNative(job.id)}>
              <Undo2 className="size-3.5 mr-1.5" /> Restore Native
            </Button>
          )}
          {!job.isBakinJob && (
            <Button variant="outline" size="sm" onClick={() => job.enabled ? onPause(job.id) : onResume(job.id)}>
              <Power className="size-3.5 mr-1.5" /> {job.enabled ? 'Disable' : 'Enable'}
            </Button>
          )}
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-surface p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
              <Clock className="size-3" />
              Schedule
            </div>
            <div className="text-sm font-medium">
              {job.humanSchedule}
              {job.tz && <span className="ml-1 text-xs font-normal text-muted-foreground">({job.tz})</span>}
            </div>
          </div>
          {job.cron && (
            <div className="rounded-lg bg-surface p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                <Timer className="size-3" />
                Cron
              </div>
              <div className="text-sm font-medium font-mono">{job.cron}</div>
            </div>
          )}
          {job.workflowId && (
            <div className="rounded-lg bg-surface p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                <Workflow className="size-3" />
                Workflow
              </div>
              <div className="text-sm font-medium">{job.workflowId}</div>
            </div>
          )}
          {job.owner && (
            <div className="rounded-lg bg-surface p-3 space-y-1">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Owner</div>
              <div className="text-sm font-medium">{job.owner}</div>
            </div>
          )}
          {job.lastTaskId && (
            <div className="rounded-lg bg-surface p-3 space-y-1">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Last Task</div>
              <div className="text-sm font-medium font-mono">{job.lastTaskId.slice(0, 8)}</div>
            </div>
          )}
          {(job.toolsAllow?.length || job.toolsAllowMissing) && (
            <div className="rounded-lg bg-surface p-3 space-y-1 col-span-2">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                {job.toolsAllowMissing ? <ShieldAlert className="size-3 text-amber-400" /> : <ShieldCheck className="size-3 text-emerald-400" />}
                Cron tools
              </div>
              <div className={job.toolsAllowMissing ? 'text-sm font-medium text-amber-400' : 'text-sm font-medium font-mono'}>
                {job.toolsAllow?.length ? job.toolsAllow.join(', ') : 'Missing allowlist'}
              </div>
            </div>
          )}
          <div className="rounded-lg bg-surface p-3 space-y-1 col-span-2">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Job ID</div>
            <div className="text-sm font-mono text-muted-foreground">{job.id}</div>
          </div>
        </div>

        {/* Flags */}
        {(job.requireTriage || job.allowOverlap) && (
          <div className="flex flex-wrap gap-2">
            {job.requireTriage && <Badge variant="outline" className="text-xs">Triage Required</Badge>}
            {job.allowOverlap && <Badge variant="outline" className="text-xs">Overlap Allowed</Badge>}
          </div>
        )}

        {/* Task prompt */}
        {job.taskPrompt && (
          <div>
            <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">
              <Terminal className="size-3 inline mr-1.5" />
              Task Prompt
            </h3>
            <div
              className="text-sm text-foreground/90 leading-relaxed rounded-lg p-4 border-l-2 bg-surface whitespace-pre-wrap"
              style={job.agentId ? { borderLeftColor: `var(--agent-${job.agentId})` } : { borderLeftColor: 'var(--outline-variant)' }}
            >
              {job.taskPrompt}
            </div>
          </div>
        )}

        <Separator />

        {job.isBakinJob && (
          <>
            <div>
              <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider mb-3">Pause / Resume</h3>
              <PauseControls job={job} onPause={onPause} onResume={onResume} />
            </div>

            <Separator />
          </>
        )}

        {/* Run history */}
        <div>
          <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider mb-3">Run History</h3>
          <RunHistory jobId={job.id} />
        </div>
      </div>
    </BakinDrawer>
  )
}
