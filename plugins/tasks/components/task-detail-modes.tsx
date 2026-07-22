'use client'

import { BakinDrawer, BakinDrawerSection, Button } from "@makinbakin/sdk/ui"
import { Input } from "@makinbakin/sdk/ui"
import { Textarea } from "@makinbakin/sdk/ui"
import { Separator } from "@makinbakin/sdk/ui"
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@makinbakin/sdk/ui"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@makinbakin/sdk/ui"
import { MoreHorizontal, Copy, Trash2, Pencil, Loader2 } from 'lucide-react'
import { MarkdownContent } from "@makinbakin/sdk/components"
import { Slot } from '@makinbakin/sdk/slots'
import { AgentAvatar } from "@makinbakin/sdk/components"
import { AgentSelect } from "@makinbakin/sdk/components"
import { COLUMN_CONFIG, STATUS_DOT_COLORS } from '../constants'
import type { Task, ColumnId } from '../types'
import { TaskRunHistory } from './task-run-history'
import { TaskNotesSection } from './task-notes-section'
import { GateApprovalPanel, WorkflowProgressPanel, WorkflowPreview, MapChildrenPanel } from './task-workflow-panels'
import type { TaskDetail } from './use-task-detail'

const COLUMN_IDS: ColumnId[] = ['backlog', 'todo', 'blocked', 'inProgress', 'review', 'done', 'archived']

/** Hero card (agent avatar + status), shown in both modes for existing tasks. */
function TaskHero({ task, columnId, agentMeta }: { task: Task | null; columnId: ColumnId | null; agentMeta: TaskDetail['taskAgentMeta'] }) {
  if (!task || !columnId) return null
  const colConfig = COLUMN_CONFIG[columnId]
  return (
    <div className="flex items-center gap-4 rounded-lg p-4 border border-border bg-surface">
      {agentMeta ? (
        <AgentAvatar agentId={task.agent!} size="lg" />
      ) : (
        <div className="size-10 rounded-full bg-zinc-700 flex items-center justify-center text-lg">?</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{agentMeta?.name || 'Unassigned'}</div>
        <div className="flex items-center gap-2 mt-1">
          {colConfig && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`size-2 rounded-full ${STATUS_DOT_COLORS[columnId]}`} />
              {colConfig.label}
            </span>
          )}
          {task.workflowId && (
            <span className="text-[11px] font-medium text-muted-foreground bg-muted/50 border border-border rounded-full px-2.5 py-0.5">{task.workflowId}</span>
          )}
        </div>
      </div>
    </div>
  )
}

interface TaskDetailFormProps {
  m: TaskDetail
  task: Task | null
  columnId: ColumnId | null
  open: boolean
  onClose: () => void
  onCancelEdit: () => void
}

/** Create / edit form drawer. */
export function TaskDetailForm({ m, task, columnId, open, onClose, onCancelEdit }: TaskDetailFormProps) {
  const {
    title, setTitle, description, setDescription, agent, setAgent, column, setColumn,
    workflowId, setWorkflowId, workflows, brandId, setBrandId, brands, saving, dirty, pasting, descriptionRef,
    logMessage, setLogMessage, addingLog, showAllNotes, setShowAllNotes,
    isCreate, taskAgentMeta, markDirty, handleDescriptionPaste, handleSave, handleAddLog,
  } = m

  return (
    <BakinDrawer
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isCreate ? 'New Task' : 'Edit Task'}
      onBack={isCreate ? undefined : onCancelEdit}
      dirty={dirty}
    >
      <div className="space-y-4">
        <TaskHero task={task} columnId={columnId} agentMeta={taskAgentMeta} />

        <div>
          <label className="text-sm text-muted-foreground mb-1 block">Title</label>
          <Input
            value={title}
            onChange={(e) => { setTitle(e.target.value); markDirty() }}
            placeholder="What needs to be done..."
            className="bg-surface"
          />
        </div>

        <div>
          <label className="text-sm text-muted-foreground mb-1 block">
            Details
            {pasting && <Loader2 className="inline size-3.5 ml-1.5 animate-spin text-muted-foreground" />}
          </label>
          <Textarea
            ref={descriptionRef}
            value={description}
            onChange={(e) => { setDescription(e.target.value); markDirty() }}
            onPaste={handleDescriptionPaste}
            placeholder="Describe what needs to happen, any constraints, links, or context the agent needs... (paste images or long text to auto-attach)"
            rows={8}
            className="min-h-[120px] resize-y bg-surface"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Assignee</label>
            <AgentSelect
              value={agent}
              onValueChange={(v) => { setAgent(v ?? ''); markDirty() }}
              allowNone
              noneLabel="Unassigned"
              includeTeams
              className="w-full bg-surface"
            />
            {task?.team && task?.agent && (
              <p className="text-xs text-muted-foreground mt-1">
                Routed from team <span className="font-medium">{task.team}</span> — the activity log records why.
              </p>
            )}
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Column</label>
            <Select value={column} onValueChange={(v) => { setColumn((v ?? 'todo') as ColumnId); markDirty() }}>
              <SelectTrigger className="w-full bg-surface">
                <SelectValue>
                  <span className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${STATUS_DOT_COLORS[column]} shrink-0`} />
                    {COLUMN_CONFIG[column as ColumnId]?.label || column}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COLUMN_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    <span className={`size-2 rounded-full ${STATUS_DOT_COLORS[id]} shrink-0`} />
                    {COLUMN_CONFIG[id].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <label className="text-sm text-muted-foreground mb-1 block">Workflow</label>
          <Select value={workflowId} onValueChange={(v) => { setWorkflowId(v ?? ''); markDirty() }}>
            <SelectTrigger className="w-full bg-surface">
              <SelectValue placeholder="None">
                {(() => {
                  const wf = workflows.find(w => w.filename.replace('.yaml', '') === workflowId)
                  return wf ? `${wf.name} (${wf.stepCount} steps)` : workflowId || 'None'
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
              {workflows.map((w) => (
                <SelectItem key={w.filename} value={w.filename.replace('.yaml', '')}>
                  {w.name} ({w.stepCount} steps)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Brand (#419) — appears once at least one published brand exists */}
        {brands.length > 0 && (
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Brand</label>
            <Select value={brandId} onValueChange={(v) => { setBrandId(v ?? ''); markDirty() }}>
              <SelectTrigger className="w-full bg-surface">
                <SelectValue placeholder="None">
                  {brands.find(b => b.id === brandId)?.name || (brandId || 'None (inherits from parent/project)')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None (inherits from parent/project)</SelectItem>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="size-2 rounded-full bg-fuchsia-500/50 shrink-0" />
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Workflow preview box */}
        <WorkflowPreview m={m} />
        <GateApprovalPanel m={m} />
        <MapChildrenPanel m={m} />

        {!isCreate && task && <Slot name="task-brand" taskId={task.id} />}
        {!isCreate && task && <Slot name="task-assets" taskId={task.id} />}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={isCreate ? onClose : onCancelEdit}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || (!isCreate && !dirty) || !title.trim()}>
            {saving ? 'Saving...' : isCreate ? 'Create Task' : 'Save'}
          </Button>
        </div>

        {!isCreate && task && (
          <>
            <Separator />
            <TaskNotesSection
              task={task}
              logMessage={logMessage}
              setLogMessage={setLogMessage}
              addingLog={addingLog}
              onAddLog={handleAddLog}
              showAllNotes={showAllNotes}
              setShowAllNotes={setShowAllNotes}
            />
          </>
        )}
      </div>
    </BakinDrawer>
  )
}

interface TaskDetailViewProps {
  m: TaskDetail
  task: Task
  columnId: ColumnId
  open: boolean
  onClose: () => void
  onEdit: () => void
  onDelete?: (task: Task) => void
  onDuplicate?: (task: Task) => void
}

/** Read-only detail drawer. */
export function TaskDetailView({ m, task, columnId, open, onClose, onEdit, onDelete, onDuplicate }: TaskDetailViewProps) {
  const {
    logMessage, setLogMessage, addingLog, showAllNotes, setShowAllNotes,
    taskAgentMeta, handleAddLog,
  } = m
  const agentMeta = taskAgentMeta

  return (
    <BakinDrawer
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title={task.title}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger className="p-1.5 rounded-md hover:bg-accent transition-colors">
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDuplicate?.(task)}>
              <Copy className="size-3.5 mr-2" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete?.(task)} className="text-red-400 focus:text-red-400">
              <Trash2 className="size-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="space-y-6">
        {/* Hero card */}
        <TaskHero task={task} columnId={columnId} agentMeta={taskAgentMeta} />

        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="size-3.5 mr-1.5" /> Edit
          </Button>
        </div>

        <GateApprovalPanel m={m} />

        <WorkflowProgressPanel m={m} />

        <MapChildrenPanel m={m} />

        {/* Description */}
        {task.description && (
          <BakinDrawerSection title="Details">
            <div className="text-xs text-foreground/90 leading-relaxed rounded-lg p-4 border-l-2 bg-surface" style={{ borderLeftColor: agentMeta ? `var(--agent-${task.agent})` : 'var(--outline-variant)' }}>
              <MarkdownContent content={task.description} />
            </div>
          </BakinDrawerSection>
        )}

        <Slot name="task-brand" taskId={task.id} />
        <Slot name="task-assets" taskId={task.id} readOnly />

        <Separator />

        {/* Notes */}
        <TaskNotesSection
          task={task}
          logMessage={logMessage}
          setLogMessage={setLogMessage}
          addingLog={addingLog}
          onAddLog={handleAddLog}
          showAllNotes={showAllNotes}
          setShowAllNotes={setShowAllNotes}
        />

        {task.id && <TaskRunHistory taskId={task.id} />}
      </div>
    </BakinDrawer>
  )
}
