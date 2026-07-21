'use client'

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import { Button } from '../primitives/button'
import { cn } from '../utils'

const HISTORY_LIMIT = 50
const DEFAULT_MIN_HEIGHT = 88
const DEFAULT_MAX_HEIGHT = 480
const RESIZE_STEP = 16
const RESIZE_STEP_LARGE = 64
const DEFAULT_ACCEPTED_TYPES = ['image/*'] as const

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function draftKey(storageKey: string) {
  return `bakin-composer-draft:${storageKey}`
}

function historyKey(storageKey: string) {
  return `bakin-composer-history:${storageKey}`
}

function resizeKey(storageKey: string) {
  return `bakin-vresize:composer:${storageKey}`
}

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (value === null || value === '') window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Browser preference storage must never block composing a message.
  }
}

function readDraft(storageKey: string) {
  return readStorage(draftKey(storageKey)) ?? ''
}

function readHistory(storageKey: string): string[] {
  try {
    const raw = readStorage(historyKey(storageKey))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
}

function appendHistory(storageKey: string, entry: string) {
  const history = readHistory(storageKey)
  if (history.at(-1) !== entry) history.push(entry)
  writeStorage(historyKey(storageKey), JSON.stringify(history.slice(-HISTORY_LIMIT)))
}

function readResize(storageKey: string, minHeight: number, maxHeight: number) {
  const raw = readStorage(resizeKey(storageKey))
  const parsed = raw ? Number.parseInt(raw, 10) : minHeight
  return clamp(Number.isFinite(parsed) ? parsed : minHeight, minHeight, maxHeight)
}

function matchesAcceptedType(file: File, acceptedTypes: readonly string[]) {
  return acceptedTypes.some((accepted) => {
    const normalized = accepted.trim().toLowerCase()
    if (!normalized) return false
    if (normalized.startsWith('.')) return file.name.toLowerCase().endsWith(normalized)
    if (normalized.endsWith('/*')) return file.type.toLowerCase().startsWith(normalized.slice(0, -1))
    return file.type.toLowerCase() === normalized
  })
}

function acceptedFiles(files: FileList | readonly File[], acceptedTypes: readonly string[]) {
  return Array.from(files).filter((file) => matchesAcceptedType(file, acceptedTypes))
}

function attachmentLabel(acceptedTypes: readonly string[]) {
  return acceptedTypes.every((type) => type.toLowerCase().startsWith('image/'))
    ? 'Add images'
    : 'Add files'
}

function AddIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 fill-none stroke-current stroke-[1.5]">
      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 fill-none stroke-current stroke-[1.5]">
      <path d="M8 13V3M4 7l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-current">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </svg>
  )
}

function RemoveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.5]">
      <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 animate-spin fill-none stroke-current stroke-[1.5] motion-reduce:animate-none">
      <path d="M14 8a6 6 0 1 1-3.1-5.25" strokeLinecap="round" />
    </svg>
  )
}

export type ComposerAttachmentStatus = 'uploading' | 'ready' | 'error'

/** Presentation state for one consumer-owned attachment upload. */
export interface ComposerAttachmentItem {
  id: string
  name: string
  previewUrl?: string
  status?: ComposerAttachmentStatus
  /** Visible failure copy when status is `error`. */
  errorMessage?: string
}

/** Capability and callbacks for consumer-owned attachment selection and upload. */
export interface ComposerAttachments {
  enabled: boolean
  disabledReason?: string
  items: readonly ComposerAttachmentItem[]
  /** MIME wildcards, exact MIME types, or extensions. Defaults to image files. */
  acceptedTypes?: readonly string[]
  multiple?: boolean
  onAdd: (files: File[]) => void
  onRemove: (id: string) => void
}

/** Props for the persistent, IME-safe conversation input. */
export interface ComposerProps {
  /** Thread identity used only for local draft, history, and resize preferences. */
  storageKey: string
  onSend: (content: string) => void | Promise<void>
  /** A reply is active: typing remains enabled while send waits. */
  busy?: boolean
  onAbort?: () => void
  disabled?: boolean
  placeholder?: string
  inputLabel?: string
  maxLength?: number
  attachments?: ComposerAttachments
  leadingSlot?: ReactNode
  autoFocus?: boolean
  minHeight?: number
  maxHeight?: number
  className?: string
}

/**
 * Conversation input with persistent drafts/history, explicit busy behavior,
 * keyboard resizing, and capability-gated attachment selection. Upload and
 * send mutations remain consumer owned.
 */
export function Composer({
  storageKey,
  onSend,
  busy = false,
  onAbort,
  disabled = false,
  placeholder = 'Send a message…',
  inputLabel,
  maxLength,
  attachments,
  leadingSlot,
  autoFocus = true,
  minHeight = DEFAULT_MIN_HEIGHT,
  maxHeight = DEFAULT_MAX_HEIGHT,
  className,
}: ComposerProps) {
  const [value, setValue] = useState(() => readDraft(storageKey))
  const [dragMinimum, setDragMinimum] = useState(() => readResize(storageKey, minHeight, maxHeight))
  const [dropActive, setDropActive] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const historyPositionRef = useRef<number | null>(null)
  const pendingDraftRef = useRef('')
  const resizeValueRef = useRef(dragMinimum)
  const resizeStartRef = useRef({ clientY: 0, height: dragMinimum })
  const resizePointerRef = useRef<number | null>(null)
  const resizeBodyStyleRef = useRef({ cursor: '', userSelect: '' })
  const descriptionId = useId()
  const attachmentReasonId = useId()
  const acceptedTypes = attachments?.acceptedTypes?.length
    ? attachments.acceptedTypes
    : DEFAULT_ACCEPTED_TYPES
  const addLabel = attachmentLabel(acceptedTypes)

  useEffect(() => {
    setValue(readDraft(storageKey))
    historyPositionRef.current = null
    const nextHeight = readResize(storageKey, minHeight, maxHeight)
    resizeValueRef.current = nextHeight
    setDragMinimum(nextHeight)
    if (autoFocus) textareaRef.current?.focus()
  }, [storageKey, autoFocus, minHeight, maxHeight])

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    const desired = Math.max(element.scrollHeight, dragMinimum)
    const capped = Math.min(desired, maxHeight)
    element.style.height = `${capped}px`
    element.style.overflowY = desired > maxHeight ? 'auto' : 'hidden'
  }, [value, dragMinimum, maxHeight])

  const setDraft = useCallback((next: string) => {
    setValue(next)
    writeStorage(draftKey(storageKey), next)
  }, [storageKey])

  const setResize = useCallback((next: number) => {
    const resolved = clamp(next, minHeight, maxHeight)
    resizeValueRef.current = resolved
    setDragMinimum(resolved)
    writeStorage(resizeKey(storageKey), String(resolved))
  }, [maxHeight, minHeight, storageKey])

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    resizePointerRef.current = event.pointerId
    resizeStartRef.current = { clientY: event.clientY, height: resizeValueRef.current }
    resizeBodyStyleRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const continueResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizePointerRef.current !== event.pointerId) return
    const delta = resizeStartRef.current.clientY - event.clientY
    const next = clamp(resizeStartRef.current.height + delta, minHeight, maxHeight)
    resizeValueRef.current = next
    setDragMinimum(next)
  }

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizePointerRef.current !== event.pointerId) return
    resizePointerRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    writeStorage(resizeKey(storageKey), String(resizeValueRef.current))
    document.body.style.cursor = resizeBodyStyleRef.current.cursor
    document.body.style.userSelect = resizeBodyStyleRef.current.userSelect
  }

  useEffect(() => () => {
    if (resizePointerRef.current === null) return
    document.body.style.cursor = resizeBodyStyleRef.current.cursor
    document.body.style.userSelect = resizeBodyStyleRef.current.userSelect
  }, [])

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    let direction = 0
    if (event.key === 'ArrowUp') direction = 1
    if (event.key === 'ArrowDown') direction = -1
    if (!direction) return
    event.preventDefault()
    setResize(resizeValueRef.current + direction * (event.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP))
  }

  const readyAttachments = attachments?.items.filter((item) => !item.status || item.status === 'ready') ?? []
  const uploadsPending = attachments?.items.some((item) => item.status === 'uploading') ?? false
  const canSend = !disabled
    && !busy
    && !uploadsPending
    && (value.trim().length > 0 || readyAttachments.length > 0)

  const send = useCallback(() => {
    if (!canSend) return
    const content = value.trim()
    if (content) appendHistory(storageKey, content)
    historyPositionRef.current = null
    setDraft('')
    void onSend(content)
  }, [canSend, onSend, setDraft, storageKey, value])

  const stepHistory = useCallback((direction: -1 | 1) => {
    const history = readHistory(storageKey)
    if (!history.length) return false
    let position = historyPositionRef.current
    if (position === null) {
      if (direction === 1) return false
      pendingDraftRef.current = value
      position = history.length - 1
    } else {
      position += direction
    }
    if (position >= history.length) {
      historyPositionRef.current = null
      setDraft(pendingDraftRef.current)
      return true
    }
    if (position < 0) return true
    historyPositionRef.current = position
    setDraft(history[position])
    return true
  }, [setDraft, storageKey, value])

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return
    if (event.key === 'Escape' && busy && onAbort) {
      event.preventDefault()
      onAbort()
      return
    }
    const element = event.currentTarget
    const caretAtStart = element.selectionStart === 0 && element.selectionEnd === 0
    if (event.key === 'ArrowUp' && (value === '' || caretAtStart || historyPositionRef.current !== null)) {
      if (stepHistory(-1)) event.preventDefault()
      return
    }
    if (event.key === 'ArrowDown' && historyPositionRef.current !== null) {
      if (stepHistory(1)) event.preventDefault()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !composingRef.current) {
      event.preventDefault()
      send()
    }
  }

  const addAcceptedFiles = (files: FileList | readonly File[]) => {
    if (!attachments?.enabled) return false
    const accepted = acceptedFiles(files, acceptedTypes)
    if (!accepted.length) return false
    attachments.onAdd(attachments.multiple === false ? accepted.slice(0, 1) : accepted)
    return true
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (addAcceptedFiles(event.clipboardData?.files ?? [])) event.preventDefault()
  }

  const showCounter = maxLength !== undefined && value.length >= maxLength * 0.8

  return (
    <div
      data-composer-root=""
      data-drop-active={dropActive ? '' : undefined}
      onDrop={(event) => {
        const added = addAcceptedFiles(event.dataTransfer?.files ?? [])
        if (added) event.preventDefault()
        setDropActive(false)
      }}
      onDragEnter={(event) => {
        if (!attachments?.enabled) return
        event.preventDefault()
        setDropActive(true)
      }}
      onDragOver={(event) => {
        if (attachments?.enabled) event.preventDefault()
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false)
      }}
      className={cn(
        'min-w-0 shrink-0 bg-bakin-canvas-default font-bakin-typography-family-ui',
        className,
      )}
    >
      <div
        role="separator"
        tabIndex={disabled ? -1 : 0}
        aria-label="Resize message input"
        aria-orientation="horizontal"
        aria-valuemin={minHeight}
        aria-valuemax={maxHeight}
        aria-valuenow={dragMinimum}
        onPointerDown={beginResize}
        onPointerMove={continueResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={resizeWithKeyboard}
        className={cn(
          'group/handle flex h-bakin-2 w-full items-center justify-center outline-none',
          disabled ? 'cursor-not-allowed' : 'cursor-row-resize',
          'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-bakin-focus-ring',
        )}
      >
        <span className="h-px w-bakin-8 rounded-bakin-pill bg-bakin-border-subtle opacity-0 transition-opacity group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100" />
      </div>

      <div className="px-bakin-4 pb-bakin-3">
        <div
          className={cn(
            'min-w-0 rounded-bakin-overlay border border-bakin-border-subtle bg-bakin-surface-default/40',
            'transition-[background-color,border-color] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
            'focus-within:border-bakin-focus-ring',
            dropActive && 'border-bakin-signal-accent bg-bakin-signal-accent/10',
          )}
        >
          {attachments?.items.length ? (
            <div className="flex min-w-0 flex-wrap gap-bakin-2 px-bakin-3 pt-bakin-3" data-composer-attachments="">
              {attachments.items.map((item) => {
                const status = item.status ?? 'ready'
                return (
                  <div key={item.id} className="relative min-w-0">
                    {status === 'uploading' ? (
                      <div
                        role="status"
                        aria-label={`Uploading ${item.name}`}
                        className="flex size-20 items-center justify-center rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default text-bakin-text-muted"
                      >
                        <SpinnerIcon />
                        <span className="sr-only">Uploading {item.name}</span>
                      </div>
                    ) : status === 'error' ? (
                      <div
                        role="alert"
                        className="flex size-20 flex-col items-center justify-center gap-bakin-1 rounded-bakin-surface border border-bakin-signal-danger bg-bakin-signal-danger/10 p-bakin-2 text-center text-[length:var(--bakin-typography-size-meta)] text-bakin-text-primary"
                      >
                        <span className="line-clamp-2 font-bakin-typography-weight-semibold">{item.name}</span>
                        <span className="line-clamp-2 text-bakin-signal-danger">{item.errorMessage ?? 'Upload failed'}</span>
                      </div>
                    ) : item.previewUrl ? (
                      <img
                        src={item.previewUrl}
                        alt={item.name}
                        className="size-20 rounded-bakin-surface border border-bakin-border-subtle object-cover"
                      />
                    ) : (
                      <div className="flex size-20 items-center justify-center rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-2 text-center text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
                        <span className="line-clamp-3 break-all">{item.name}</span>
                      </div>
                    )}
                    <Button
                      type="button"
                      data-composer-attach-remove=""
                      variant="secondary"
                      size="icon-xs"
                      disabled={disabled}
                      aria-label={`Remove ${item.name}`}
                      onClick={() => attachments.onRemove(item.id)}
                      className="absolute -right-bakin-1 -top-bakin-1 rounded-bakin-pill shadow-md"
                    >
                      <RemoveIcon />
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : null}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              historyPositionRef.current = null
              setDraft(event.currentTarget.value)
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            placeholder={placeholder}
            aria-label={inputLabel ?? placeholder}
            aria-describedby={busy || showCounter ? descriptionId : undefined}
            disabled={disabled}
            maxLength={maxLength}
            className={cn(
              'block w-full min-w-0 resize-none border-0 bg-transparent px-bakin-3 pt-bakin-3',
              'font-bakin-typography-family-ui text-base leading-relaxed text-bakin-text-primary md:text-[length:var(--bakin-typography-size-body)]',
              'outline-none placeholder:text-bakin-text-muted disabled:cursor-not-allowed disabled:opacity-[var(--bakin-state-opacity-disabled)]',
            )}
          />

          <div className="flex min-w-0 items-center justify-between gap-bakin-2 px-bakin-2 pb-bakin-2 pt-bakin-1">
            <div className="flex min-w-0 items-center gap-bakin-1">
              {attachments ? (
                <>
                  <Button
                    type="button"
                    data-composer-attach=""
                    variant="ghost"
                    size="icon-sm"
                    disabled={!attachments.enabled || disabled}
                    title={attachments.enabled ? addLabel : attachments.disabledReason ?? 'Attachments unavailable'}
                    aria-label={addLabel}
                    aria-describedby={!attachments.enabled ? attachmentReasonId : undefined}
                    onClick={() => fileRef.current?.click()}
                    className="rounded-bakin-pill text-bakin-text-muted"
                  >
                    <AddIcon />
                  </Button>
                  {!attachments.enabled ? (
                    <span id={attachmentReasonId} className="sr-only">
                      {attachments.disabledReason ?? 'Attachments unavailable'}
                    </span>
                  ) : null}
                  <input
                    ref={fileRef}
                    type="file"
                    aria-label={`${addLabel} file picker`}
                    accept={acceptedTypes.join(',')}
                    multiple={attachments.multiple !== false}
                    disabled={!attachments.enabled || disabled}
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(event) => {
                      addAcceptedFiles(event.currentTarget.files ?? [])
                      event.currentTarget.value = ''
                    }}
                  />
                </>
              ) : null}
              {leadingSlot}
            </div>

            {busy && onAbort ? (
              <Button
                type="button"
                data-composer-stop=""
                variant="secondary"
                size="icon-sm"
                onClick={onAbort}
                aria-label="Stop the reply"
                title="Stop the reply (Esc)"
                className="rounded-bakin-pill"
              >
                <StopIcon />
              </Button>
            ) : busy ? (
              <span
                role="status"
                aria-label="Reply in progress"
                className="flex size-bakin-8 items-center justify-center text-bakin-text-muted"
              >
                <SpinnerIcon />
                <span className="sr-only">Reply in progress</span>
              </span>
            ) : (
              <Button
                type="button"
                data-composer-send=""
                variant="primary"
                size="icon-sm"
                onClick={send}
                disabled={!canSend}
                aria-label="Send"
                title="Send (Enter)"
                className="rounded-bakin-pill"
              >
                <SendIcon />
              </Button>
            )}
          </div>
        </div>

        <div id={descriptionId} className="flex min-h-bakin-4 items-start justify-between gap-bakin-3 pt-bakin-1 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
          <span aria-live="polite">
            {busy ? 'Replying—you can keep typing. Send waits until the reply finishes.' : ''}
          </span>
          {showCounter ? (
            <span
              data-composer-count=""
              aria-live="polite"
              className={cn(
                'shrink-0 font-bakin-typography-family-mono',
                value.length >= (maxLength ?? 0) && 'text-bakin-signal-danger',
              )}
            >
              {value.length} / {maxLength}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
