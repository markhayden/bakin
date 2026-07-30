'use client'

import {
  Alert,
  AlertDescription,
  AlertTitle,
  DrawerSection,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@makinbakin/sdk/ui'
import { formatDateTime } from '@makinbakin/sdk/utils'
import { AlertTriangle, Send } from 'lucide-react'
import type { Task, TaskLogEntry } from '../types'
import { compactDispatchFailureLabel, getDispatchFailureDetail, specificDispatchFailureLabel, type DispatchFailureDetail } from '../lib/dispatch-failure'

function DispatchFailureLogPanel({ detail }: { detail: DispatchFailureDetail }) {
  const rows = [
    ['Cause', specificDispatchFailureLabel(detail)],
    ...(detail.provider ? [['Provider', detail.provider]] : []),
    ...(detail.model ? [['Model', detail.model]] : []),
    ['Retryable', detail.retryable === false ? 'No' : 'Yes'],
  ] as Array<[string, string]>

  return (
    <Alert tone="danger" className="@container/dispatch mt-bakin-2">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>{compactDispatchFailureLabel(detail)}</AlertTitle>
      <AlertDescription>
        <p>{specificDispatchFailureLabel(detail)}</p>
        <dl className="mt-bakin-3 grid min-w-0 grid-cols-1 gap-bakin-2 @sm/dispatch:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wider text-bakin-text-muted">
                {label}
              </dt>
              <dd className="m-0 break-words text-bakin-typography-size-meta text-bakin-text-primary">{value}</dd>
            </div>
          ))}
        </dl>
        {detail.rawError ? (
          <Collapsible className="mt-bakin-3 border-b-0">
            <CollapsibleTrigger className="text-bakin-typography-size-meta">Technical details</CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="m-0 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-bakin-surface bg-bakin-canvas-default p-bakin-3 font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
                {detail.rawError}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

function TaskLogMessage({ entry }: { entry: TaskLogEntry }) {
  const dispatchFailure = getDispatchFailureDetail(entry)
  if (dispatchFailure) return <DispatchFailureLogPanel detail={dispatchFailure} />
  return <p className="m-0 text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">{entry.message}</p>
}

interface TaskNotesSectionProps {
  task: Task
  logMessage: string
  setLogMessage: (v: string) => void
  addingLog: boolean
  onAddLog: () => void
  showAllNotes: boolean
  setShowAllNotes: (v: boolean) => void
}

/**
 * The "Notes" block (add-note input + paginated log list) shared verbatim by the
 * edit form and the detail view — extracted from the two identical copies that
 * previously lived in each mode branch of TaskDetailDrawer.
 */
export function TaskNotesSection({ task, logMessage, setLogMessage, addingLog, onAddLog, showAllNotes, setShowAllNotes }: TaskNotesSectionProps) {
  const notesListJSX = task.log && task.log.length > 0 ? (() => {
    const reversed = [...task.log].reverse()
    const NOTES_PAGE_SIZE = 5
    const visible = showAllNotes ? reversed : reversed.slice(0, NOTES_PAGE_SIZE)
    const hasMore = reversed.length > NOTES_PAGE_SIZE
    return (
      <div className="pb-bakin-4">
        <ol className="m-0 list-none divide-y divide-bakin-border-subtle p-0">
          {visible.map((entry, i) => (
            <li key={`${entry.timestamp}-${entry.author}-${i}`} className="min-w-0 py-bakin-3 first:pt-0">
              <div className="mb-bakin-1 flex min-w-0 flex-wrap items-center gap-x-bakin-2 gap-y-bakin-1">
                <time className="font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
                  {formatDateTime(entry.timestamp)}
                </time>
                <span className="text-bakin-typography-size-meta font-bakin-typography-weight-semibold text-bakin-text-primary">
                  {entry.author}
                </span>
              </div>
              <TaskLogMessage entry={entry} />
            </li>
          ))}
        </ol>
        {hasMore && !showAllNotes ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            onClick={() => setShowAllNotes(true)}
            className="mt-bakin-2"
          >
            Show {reversed.length - NOTES_PAGE_SIZE} older notes
          </Button>
        ) : null}
      </div>
    )
  })() : null

  return (
    <DrawerSection title="Notes">
      <form
        className="mb-bakin-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!addingLog && logMessage.trim()) onAddLog()
        }}
      >
        <InputGroup aria-label="Add task note">
          <InputGroupInput
            value={logMessage}
            onChange={(event) => setLogMessage(event.target.value)}
            placeholder="Add a note…"
            aria-label="Task note"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="submit"
              size="icon-xs"
              aria-label={addingLog ? 'Adding note' : 'Add note'}
              disabled={addingLog || !logMessage.trim()}
            >
              <Send className="size-bakin-3" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      {(!task.log || task.log.length === 0) && (
        <p className="m-0 text-bakin-typography-size-body text-bakin-text-muted">No notes yet.</p>
      )}
      {notesListJSX}
    </DrawerSection>
  )
}
