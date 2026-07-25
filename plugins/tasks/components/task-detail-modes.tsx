'use client'

import {
  BakinDrawer,
  BakinDrawerSection,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Form,
  FormActions,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  SubmitButton,
  Textarea,
} from '@makinbakin/sdk/ui'
import {
  AgentAvatar,
  AgentSelect,
  StatusBadge,
  type StatusTone,
} from '@makinbakin/sdk/patterns'
import { MarkdownContent } from '@makinbakin/sdk/content'
import { Slot } from '@makinbakin/sdk/slots'
import { Copy, Loader2, MoreHorizontal, Pencil, Trash2, Workflow } from 'lucide-react'
import { COLUMN_CONFIG } from '../constants'
import type { Task, ColumnId } from '../types'
import { TaskRunHistory } from './task-run-history'
import { TaskNotesSection } from './task-notes-section'
import { GateApprovalPanel, WorkflowProgressPanel, WorkflowPreview, MapChildrenPanel } from './task-workflow-panels'
import type { TaskDetail } from './use-task-detail'

const COLUMN_IDS: ColumnId[] = ['backlog', 'todo', 'blocked', 'inProgress', 'review', 'done', 'archived']

const STATUS_TONES: Record<ColumnId, StatusTone> = {
  backlog: 'neutral',
  todo: 'accent',
  blocked: 'danger',
  inProgress: 'accent',
  review: 'attention',
  done: 'success',
  archived: 'neutral',
}

function workflowLabel(m: TaskDetail, id?: string): string | undefined {
  if (!id) return undefined
  return m.workflows.find(workflow => workflow.filename.replace('.yaml', '') === id)?.name ?? id
}

/** Hero card (agent avatar + status), shown in both modes for existing tasks. */
function TaskHero({
  task,
  columnId,
  agentMeta,
  workflowName,
}: {
  task: Task | null
  columnId: ColumnId | null
  agentMeta: TaskDetail['taskAgentMeta']
  workflowName?: string
}) {
  if (!task || !columnId) return null
  const colConfig = COLUMN_CONFIG[columnId]
  const agentIdentity = agentMeta
    ? {
        id: agentMeta.id,
        name: agentMeta.name,
        imageSrc: agentMeta.headshot || undefined,
      }
    : {
        id: 'unassigned',
        name: 'Unassigned',
      }

  return (
    <div
      data-task-detail-hero=""
      className="flex min-w-0 items-center gap-bakin-4 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-4"
    >
      <AgentAvatar agent={agentIdentity} size="lg" decorative />
      <div className="min-w-0 flex-1">
        <div className="truncate text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-primary">
          {agentIdentity.name}
        </div>
        <div className="mt-bakin-1 flex min-w-0 flex-wrap items-center gap-bakin-2">
          <StatusBadge tone={STATUS_TONES[columnId]} variant="solid" size="xs">
            {colConfig.label}
          </StatusBadge>
          {workflowName ? (
            <span className="inline-flex min-w-0 items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
              <Workflow aria-hidden="true" className="size-bakin-3 shrink-0" />
              <span className="truncate">{workflowName}</span>
            </span>
          ) : null}
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
    isCreate, taskAgentMeta, agentOptions, teamOptions, markDirty, handleDescriptionPaste, handleSave, handleAddLog,
  } = m

  return (
    <BakinDrawer
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isCreate ? 'New Task' : 'Edit Task'}
      onBack={isCreate ? undefined : onCancelEdit}
      dirty={dirty}
      busy={saving}
      storageKey="tasks-detail"
    >
      <div className="flex min-w-0 flex-col gap-bakin-6">
        <Form
          aria-label={isCreate ? 'Create task' : 'Edit task'}
          busy={saving}
          onSubmit={(event) => {
            event.preventDefault()
            void handleSave()
          }}
        >
          <TaskHero
            task={task}
            columnId={columnId}
            agentMeta={taskAgentMeta}
            workflowName={workflowLabel(m, task?.workflowId)}
          />

          <Field name="title">
            <FieldLabel requirement="required">Title</FieldLabel>
            <Input
              required
              value={title}
              onChange={(e) => { setTitle(e.target.value); markDirty() }}
              placeholder="What needs to be done…"
            />
          </Field>

        <Field name="description">
          <FieldLabel>
            Details
            {pasting ? <Loader2 aria-label="Processing pasted content" className="ml-bakin-1 inline size-bakin-3 animate-spin" /> : null}
          </FieldLabel>
          <FieldDescription>
            Paste images or long text to attach them without crowding the task description.
          </FieldDescription>
          <FieldControl
            render={(
              <Textarea
                ref={descriptionRef}
                value={description}
                onChange={(event) => { setDescription(event.target.value); markDirty() }}
                onPaste={handleDescriptionPaste}
                placeholder="Describe the outcome, constraints, links, and context the assignee needs…"
                rows={8}
                className="resize-y"
              />
            )}
          />
        </Field>

        <div className="grid min-w-0 grid-cols-1 gap-bakin-4 @md/form:grid-cols-2">
          <Field name="agent">
            <FieldLabel>Assignee</FieldLabel>
            <AgentSelect
              id="task-assignee"
              name="agent"
              value={agent}
              onValueChange={(v) => { setAgent(v ?? ''); markDirty() }}
              agents={agentOptions}
              teams={teamOptions}
              allowNone
              noneLabel="Unassigned"
              ariaLabel="Assignee"
              className="w-full"
            />
            {task?.team && task?.agent && (
              <FieldDescription>
                Routed from team <span className="font-bakin-typography-weight-semibold">{task.team}</span>; the activity log records why.
              </FieldDescription>
            )}
          </Field>

          <Field name="column">
            <FieldLabel>Column</FieldLabel>
            <Select value={column} onValueChange={(v) => { setColumn((v ?? 'todo') as ColumnId); markDirty() }}>
              <SelectTrigger aria-label="Column" className="w-full">
                <SelectValue>
                  <StatusBadge tone={STATUS_TONES[column]} variant="solid" size="xs">
                    {COLUMN_CONFIG[column]?.label || column}
                  </StatusBadge>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COLUMN_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    <StatusBadge tone={STATUS_TONES[id]} variant="solid" size="xs">
                      {COLUMN_CONFIG[id].label}
                    </StatusBadge>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field name="workflow">
          <FieldLabel>Workflow</FieldLabel>
          <Select value={workflowId} onValueChange={(v) => { setWorkflowId(v ?? ''); markDirty() }}>
            <SelectTrigger aria-label="Workflow" className="w-full">
              <SelectValue placeholder="None">
                {workflowLabel(m, workflowId) || 'None'}
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
        </Field>

        {/* Brand (#419) — appears once at least one published brand exists */}
        {brands.length > 0 && (
          <Field name="brand">
            <FieldLabel>Brand</FieldLabel>
            <Select value={brandId} onValueChange={(v) => { setBrandId(v ?? ''); markDirty() }}>
              <SelectTrigger aria-label="Brand" className="w-full">
                <SelectValue placeholder="None">
                  {brands.find(b => b.id === brandId)?.name || (brandId || 'None (inherits from parent/project)')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None (inherits from parent/project)</SelectItem>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        {/* Workflow preview box */}
        <WorkflowPreview m={m} />
        <GateApprovalPanel m={m} />
        <MapChildrenPanel m={m} />

        {!isCreate && task && <Slot name="task-brand" taskId={task.id} />}
        {!isCreate && task && <Slot name="task-assets" taskId={task.id} />}

          <FormActions>
            <Button type="button" variant="outline" onClick={isCreate ? onClose : onCancelEdit} disabled={saving}>
              Cancel
            </Button>
            <SubmitButton
              busy={saving}
              busyLabel="Saving task…"
              disabled={(!isCreate && !dirty) || !title.trim()}
            >
              {isCreate ? 'Create task' : 'Save'}
            </SubmitButton>
          </FormActions>
        </Form>

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

  return (
    <BakinDrawer
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title={task.title}
      storageKey="tasks-detail"
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(
              <Button variant="ghost" size="icon-sm" aria-label="Task actions">
                <MoreHorizontal aria-hidden="true" />
              </Button>
            )}
          >
            <span className="sr-only">Task actions</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil aria-hidden="true" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDuplicate?.(task)}>
              <Copy aria-hidden="true" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete?.(task)} variant="danger">
              <Trash2 aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="flex min-w-0 flex-col gap-bakin-6">
        {/* Hero card */}
        <TaskHero
          task={task}
          columnId={columnId}
          agentMeta={taskAgentMeta}
          workflowName={workflowLabel(m, task.workflowId)}
        />

        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-bakin-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil aria-hidden="true" /> Edit
          </Button>
        </div>

        <GateApprovalPanel m={m} />

        <WorkflowProgressPanel m={m} />

        <MapChildrenPanel m={m} />

        {/* Description */}
        {task.description && (
          <BakinDrawerSection title="Details">
            <div className="rounded-bakin-surface border-s-2 border-bakin-border-subtle bg-bakin-surface-default p-bakin-4 text-bakin-typography-size-body leading-relaxed text-bakin-text-primary">
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
