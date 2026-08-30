'use client'

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DrawerSection,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Text,
} from '@makinbakin/sdk/ui'
import { Panel } from '@makinbakin/sdk/layout'
import { KeyValue, ListRow, ListRows } from '@makinbakin/sdk/patterns'
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
    <Alert tone="danger" className="mt-bakin-2">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>{compactDispatchFailureLabel(detail)}</AlertTitle>
      <AlertDescription>
        <p>{specificDispatchFailureLabel(detail)}</p>
        <KeyValue layout="columns" className="mt-bakin-3" items={rows.map(([label, value]) => ({ label, value }))} />
        {detail.rawError ? (
          <Collapsible className="mt-bakin-3 border-b-0">
            <CollapsibleTrigger className="text-bakin-typography-size-meta">Technical details</CollapsibleTrigger>
            <CollapsibleContent>
              <Panel variant="code" scroll padding="compact" aria-label="Raw error" className="max-h-36">
                <pre>{detail.rawError}</pre>
              </Panel>
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
  return <Text size="body" tone="muted" as="p" className="leading-relaxed">{entry.message}</Text>
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
        <ListRows variant="separated" aria-label="Task notes">
          {visible.map((entry, i) => (
            <ListRow key={`${entry.timestamp}-${entry.author}-${i}`}>
              <div className="mb-bakin-1 flex min-w-0 flex-wrap items-center gap-x-bakin-2 gap-y-bakin-1">
                <Text size="meta" tone="muted" mono as="time">
                  {formatDateTime(entry.timestamp)}
                </Text>
                <Text size="meta" weight="semibold">
                  {entry.author}
                </Text>
              </div>
              <TaskLogMessage entry={entry} />
            </ListRow>
          ))}
        </ListRows>
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
        <Text size="body" tone="muted" as="p">No notes yet.</Text>
      )}
      {notesListJSX}
    </DrawerSection>
  )
}
