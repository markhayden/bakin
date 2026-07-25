'use client'

/**
 * Composer — THE conversation input, styled after the ChatGPT input: one
 * rounded container holding a dedicated attachment strip (thumbnails with
 * remove, upload-progress chips), a `+` attach button in the left slot, a
 * borderless auto-growing textarea, and a circular send/stop button on the
 * right. Drag the handle above to raise the minimum height; typing can
 * still grow to the cap. Enter/Shift+Enter/Esc with an IME guard,
 * shell-style ↑/↓ input history, per-thread draft persistence — and typing
 * is NEVER blocked while a turn streams; only send waits.
 */
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, ListEnd, Loader2, Plus, Square, X } from 'lucide-react'

import { useVerticalResize } from '@/hooks/use-vertical-resize'

const HISTORY_LIMIT = 50
const DEFAULT_MIN_HEIGHT = 88
const DEFAULT_MAX_HEIGHT = 480

function draftKey(storageKey: string) {
  return `bakin-composer-draft:${storageKey}`
}
function historyKey(storageKey: string) {
  return `bakin-composer-history:${storageKey}`
}

function readDraft(storageKey: string): string {
  try {
    return localStorage.getItem(draftKey(storageKey)) ?? ''
  } catch {
    return ''
  }
}

function writeDraft(storageKey: string, value: string): void {
  try {
    if (value) localStorage.setItem(draftKey(storageKey), value)
    else localStorage.removeItem(draftKey(storageKey))
  } catch {
    // Storage failures never break typing.
  }
}

function readHistory(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(historyKey(storageKey))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function appendHistory(storageKey: string, entry: string): void {
  try {
    const history = readHistory(storageKey)
    if (history[history.length - 1] !== entry) history.push(entry)
    localStorage.setItem(historyKey(storageKey), JSON.stringify(history.slice(-HISTORY_LIMIT)))
  } catch {
    // Storage failures never break sending.
  }
}

export interface ComposerAttachmentItem {
  id: string
  name: string
  previewUrl?: string
  /** 'uploading' renders a progress chip; absent/'ready' renders the thumbnail. */
  status?: 'uploading' | 'ready'
}

export interface ComposerAttachments {
  /** Whether this agent/model accepts image input (capability-gated by the caller). */
  enabled: boolean
  /** Honest explanation shown on the disabled affordance. */
  disabledReason?: string
  items: ComposerAttachmentItem[]
  onAdd: (files: File[]) => void
  onRemove: (id: string) => void
}

/** Imperative surface for queue-remove restore (spec D8): the surface can
 *  ask "is the composer empty?" and hand a removed message's text back. */
export interface ComposerHandle {
  isEmpty(): boolean
  /** Replace the composer text (draft persists) and focus. */
  setText(text: string): void
}

export interface ComposerProps {
  /** Thread identity: keys drafts, history, and the resize persistence. */
  storageKey: string
  onSend: (content: string) => void | Promise<void>
  /** Imperative handle for restore-to-composer flows. */
  handleRef?: React.Ref<ComposerHandle>
  /** A turn is streaming: typing stays live; see queueMode for what send does. */
  busy?: boolean
  onAbort?: () => void
  /**
   * Queue-aware surface (#732): while busy, the action button MORPHS —
   * Stop when the composer is empty, queue-send when text/attachments are
   * present (Enter queues; Esc always stops). Strict surfaces (default)
   * hold send while busy.
   */
  queueMode?: boolean
  /** Hard-disabled surface (read-only/archived). */
  disabled?: boolean
  placeholder?: string
  maxLength?: number
  attachments?: ComposerAttachments
  /** Rendered left of the textarea (e.g. an agent switcher). */
  leadingSlot?: React.ReactNode
  autoFocus?: boolean
  minHeight?: number
  maxHeight?: number
}

export function Composer({
  storageKey,
  onSend,
  handleRef,
  busy = false,
  onAbort,
  queueMode = false,
  disabled = false,
  placeholder = 'Send a message…',
  maxLength,
  attachments,
  leadingSlot,
  autoFocus = true,
  minHeight = DEFAULT_MIN_HEIGHT,
  maxHeight = DEFAULT_MAX_HEIGHT,
}: ComposerProps) {
  const [value, setValue] = useState(() => readDraft(storageKey))
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  // History cursor: null = not browsing; otherwise index into history.
  const historyPosRef = useRef<number | null>(null)
  const pendingDraftRef = useRef('')

  const { height: dragMin, handleProps } = useVerticalResize({
    defaultHeight: minHeight,
    minHeight,
    maxHeight,
    storageKey: `composer:${storageKey}`,
  })

  // Thread switch: load that thread's draft, reset history browsing, focus.
  useEffect(() => {
    setValue(readDraft(storageKey))
    historyPosRef.current = null
    if (autoFocus) taRef.current?.focus()
  }, [storageKey, autoFocus])

  // Auto-grow between the dragged minimum and the cap.
  useLayoutEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    const desired = Math.max(el.scrollHeight, dragMin)
    const capped = Math.min(desired, maxHeight)
    el.style.height = `${capped}px`
    el.style.overflowY = desired > maxHeight ? 'auto' : 'hidden'
  }, [value, dragMin, maxHeight])

  const setDraft = useCallback(
    (next: string) => {
      setValue(next)
      writeDraft(storageKey, next)
    },
    [storageKey],
  )

  const valueRef = useRef(value)
  valueRef.current = value
  useImperativeHandle(
    handleRef,
    () => ({
      isEmpty: () => valueRef.current.trim().length === 0,
      setText: (text: string) => {
        setDraft(text)
        taRef.current?.focus()
      },
    }),
    [setDraft],
  )

  const hasText = value.trim().length > 0
  const readyAttachments = attachments?.items.filter((a) => a.status !== 'uploading') ?? []
  const uploadsPending = (attachments?.items.length ?? 0) > readyAttachments.length
  const hasPayload = hasText || readyAttachments.length > 0
  // Queue surfaces may send while busy — the action queues server-side.
  const canSend = !disabled && (!busy || queueMode) && !uploadsPending && hasPayload

  const send = useCallback(() => {
    if (!canSend) return
    const content = value.trim()
    if (content) appendHistory(storageKey, content)
    historyPosRef.current = null
    setDraft('')
    onSend(content)
  }, [canSend, value, storageKey, setDraft, onSend])

  const stepHistory = useCallback(
    (direction: -1 | 1) => {
      const history = readHistory(storageKey)
      if (!history.length) return false
      let pos = historyPosRef.current
      if (pos === null) {
        if (direction === 1) return false
        pendingDraftRef.current = value
        pos = history.length - 1
      } else {
        pos += direction
      }
      if (pos >= history.length) {
        historyPosRef.current = null
        setDraft(pendingDraftRef.current)
        return true
      }
      if (pos < 0) return true
      historyPosRef.current = pos
      setDraft(history[pos])
      return true
    },
    [storageKey, value, setDraft],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return
    if (e.key === 'Escape' && busy && onAbort) {
      e.preventDefault()
      onAbort()
      return
    }
    const el = e.currentTarget
    const caretAtStart = el.selectionStart === 0 && el.selectionEnd === 0
    if (e.key === 'ArrowUp' && (value === '' || caretAtStart || historyPosRef.current !== null)) {
      if (stepHistory(-1)) e.preventDefault()
      return
    }
    if (e.key === 'ArrowDown' && historyPosRef.current !== null) {
      if (stepHistory(1)) e.preventDefault()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
      e.preventDefault()
      send()
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!attachments?.enabled) return
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    attachments.onAdd(files)
  }

  const onDrop = (e: React.DragEvent) => {
    if (!attachments?.enabled) return
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    attachments.onAdd(files)
  }

  const showCounter = maxLength !== undefined && value.length >= maxLength * 0.8

  return (
    <div
      className="shrink-0 bg-background"
      onDrop={onDrop}
      onDragOver={(e) => {
        if (attachments?.enabled) e.preventDefault()
      }}
    >
      <div
        {...handleProps}
        aria-label="Resize message input"
        className="group/handle flex h-2 w-full cursor-row-resize items-center justify-center"
      >
        <div className="h-0.5 w-10 rounded-full bg-border opacity-0 transition-opacity group-hover/handle:opacity-100" />
      </div>

      <div className="px-4 pb-3">
        <div className="rounded-2xl border border-border bg-muted/30 transition-colors focus-within:border-ring">
          {attachments?.items.length ? (
            <div className="flex flex-wrap gap-2 px-3 pt-3" data-composer-attachments>
              {attachments.items.map((item) => (
                <div key={item.id} className="relative">
                  {item.status === 'uploading' ? (
                    <div
                      data-composer-attach-uploading
                      className="flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-muted/40"
                      title={`Uploading ${item.name}…`}
                    >
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : item.previewUrl ? (
                    <img
                      src={item.previewUrl}
                      alt={item.name}
                      className="h-20 w-20 rounded-lg border border-border object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-muted/40 p-1 text-center text-[10px] text-muted-foreground">
                      {item.name}
                    </div>
                  )}
                  <button
                    type="button"
                    data-composer-attach-remove
                    aria-label={`Remove ${item.name}`}
                    onClick={() => attachments.onRemove(item.id)}
                    className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-background p-1 text-foreground shadow-sm transition-colors hover:bg-foreground/10"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {/* Text on top (flush left), action row along the bottom. */}
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => {
              historyPosRef.current = null
              setDraft(e.target.value)
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={() => {
              composingRef.current = false
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            disabled={disabled}
            maxLength={maxLength}
            className="block w-full resize-none border-0 bg-transparent px-3 pt-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
          />

          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <div className="flex items-center gap-1">
              {attachments ? (
                <>
                  <button
                    type="button"
                    data-composer-attach
                    disabled={!attachments.enabled || disabled}
                    title={attachments.enabled ? 'Add photos & files' : attachments.disabledReason ?? 'Attachments unavailable'}
                    aria-label="Add photos & files"
                    onClick={() => fileRef.current?.click()}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="size-4" />
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? [])
                      if (files.length) attachments.onAdd(files)
                      e.target.value = ''
                    }}
                  />
                </>
              ) : null}
              {leadingSlot}
            </div>

            {busy && !onAbort ? (
              // A busy surface with no abort (draft-mode create/upload/send
              // window): a spinner, never a dead Stop button.
              <button
                type="button"
                data-composer-sending
                disabled
                aria-label="Sending"
                className="flex size-8 shrink-0 cursor-default items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" />
              </button>
            ) : busy && queueMode && canSend ? (
              // The single morphing button (D4): text present → queue-send.
              // Enter queues; the instant morph-back to Stop after sending
              // is the steering sequence (queue → Stop → drain).
              <button
                type="button"
                data-composer-queue
                onClick={send}
                aria-label="Queue message"
                title="Queue for when the reply finishes (Enter)"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                <ListEnd className="size-4" />
              </button>
            ) : busy ? (
              <button
                type="button"
                data-composer-stop
                onClick={onAbort}
                aria-label="Stop the reply"
                title="Stop the reply (Esc)"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-colors hover:opacity-90"
              >
                <Square className="size-3 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                data-composer-send
                onClick={send}
                disabled={!canSend}
                aria-label="Send"
                title="Send (Enter)"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="text-[11px] text-muted-foreground/70">
            {!busy
              ? ''
              : !onAbort
                ? 'Sending…'
                : queueMode
                  ? hasPayload
                    ? 'Replying — Enter queues your message; Esc stops the reply.'
                    : 'Replying — type to queue a follow-up; Esc stops the reply.'
                  : 'Replying — wait for the reply to finish, or stop it.'}
          </div>
          {showCounter ? (
            <div
              data-composer-count
              className={`font-mono text-[11px] ${value.length >= (maxLength ?? 0) ? 'text-destructive' : 'text-muted-foreground/70'}`}
            >
              {value.length} / {maxLength}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
