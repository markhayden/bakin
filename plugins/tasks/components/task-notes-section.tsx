'use client'

import { BakinDrawerSection, Button } from "@makinbakin/sdk/ui"
import { Input } from "@makinbakin/sdk/ui"
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
    <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="size-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-amber-300">{compactDispatchFailureLabel(detail)}</p>
          <p className="mt-0.5 text-xs text-amber-200/80">{specificDispatchFailureLabel(detail)}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-amber-200/60">{label}</p>
            <p className="truncate text-xs text-amber-100">{value}</p>
          </div>
        ))}
      </div>
      {detail.rawError && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] font-medium text-amber-200/80">Technical details</summary>
          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 text-[11px] text-muted-foreground">
            {detail.rawError}
          </pre>
        </details>
      )}
    </div>
  )
}

function TaskLogMessage({ entry }: { entry: TaskLogEntry }) {
  const dispatchFailure = getDispatchFailureDetail(entry)
  if (dispatchFailure) return <DispatchFailureLogPanel detail={dispatchFailure} />
  return <p className="text-xs text-muted-foreground">{entry.message}</p>
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
      <div className="flex flex-col gap-2 pb-4">
        {visible.map((entry, i) => (
          <div key={i} className="rounded-md border border-border bg-background px-3 py-2">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-mono text-muted-foreground">{entry.timestamp}</span>
              <span className="text-xs font-medium text-foreground">{entry.author}</span>
            </div>
            <TaskLogMessage entry={entry} />
          </div>
        ))}
        {hasMore && !showAllNotes && (
          <button
            onClick={() => setShowAllNotes(true)}
            className="text-xs text-accent hover:underline self-start"
          >
            Show {reversed.length - NOTES_PAGE_SIZE} older notes
          </button>
        )}
      </div>
    )
  })() : null

  return (
    <BakinDrawerSection title="Notes">
      <div className="flex gap-2 mb-3">
        <Input
          value={logMessage}
          onChange={(e) => setLogMessage(e.target.value)}
          placeholder="Add a note..."
          className="flex-1 h-8 bg-surface"
          onKeyDown={(e) => { if (e.key === 'Enter') onAddLog() }}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={onAddLog}
          disabled={addingLog || !logMessage.trim()}
        >
          <Send className="size-3.5" />
        </Button>
      </div>
      {(!task.log || task.log.length === 0) && (
        <p className="text-xs text-muted-foreground">No notes yet.</p>
      )}
      {notesListJSX}
    </BakinDrawerSection>
  )
}
