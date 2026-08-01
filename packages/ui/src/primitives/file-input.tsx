'use client'

import {
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type Ref,
} from 'react'

import { cn } from '../utils'
import { Button, type ButtonSize, type ButtonVariant } from './button'

export interface FileInputHandle {
  /** Open the browser file dialog — for flows whose visible trigger lives elsewhere (menus). */
  open: () => void
}

export interface FileInputProps {
  /** Accessible name for the file input (and the trigger when it has no visible text). */
  label: string
  /** Called with the chosen files — from the dialog or a drop on the trigger. */
  onFiles: (files: File[]) => void
  /** Native accept filter, e.g. `image/*` or `image/png,image/jpeg`. Drops are filtered the same way. */
  accept?: string
  multiple?: boolean
  disabled?: boolean
  /**
   * Visible trigger content. Omit to render only the (visually hidden) input
   * and open the dialog imperatively via the `open()` handle.
   */
  children?: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  /** Called when a drop contained only files rejected by `accept` — surface it, never swallow. */
  onRejected?: (files: File[]) => void
  ref?: Ref<FileInputHandle>
}

function acceptMatches(accept: string | undefined, file: File): boolean {
  if (!accept) return true
  return accept.split(',').some((raw) => {
    const pattern = raw.trim().toLowerCase()
    if (!pattern) return false
    if (pattern.startsWith('.')) return file.name.toLowerCase().endsWith(pattern)
    if (pattern.endsWith('/*')) return file.type.toLowerCase().startsWith(pattern.slice(0, -1))
    return file.type.toLowerCase() === pattern
  })
}

/**
 * Kit-styled file intake: a Button trigger wrapping the native file input,
 * with an accessible name, drag-enter affordance, and drop support. The
 * consumer owns what happens to the files — upload, preview, validation.
 */
export function FileInput({
  label,
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  children,
  variant = 'outline',
  size = 'sm',
  className,
  onRejected,
  ref,
}: FileInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  useImperativeHandle(ref, () => ({ open: () => inputRef.current?.click() }), [])

  const takeFiles = (list: FileList | File[] | null | undefined, filterDrops: boolean) => {
    const all = Array.from(list ?? [])
    if (all.length === 0) return
    const accepted = filterDrops ? all.filter((file) => acceptMatches(accept, file)) : all
    const sliced = multiple ? accepted : accepted.slice(0, 1)
    if (sliced.length > 0) onFiles(sliced)
    else onRejected?.(all)
  }

  const dropProps = children
    ? {
      onDragOver: (event: DragEvent) => {
        event.preventDefault()
        if (!disabled) setDragOver(true)
      },
      onDragLeave: (event: DragEvent) => {
        event.preventDefault()
        setDragOver(false)
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault()
        setDragOver(false)
        if (!disabled) takeFiles(event.dataTransfer?.files, true)
      },
    }
    : undefined

  return (
    <>
      {children ? (
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={disabled}
          data-slot="file-input-trigger"
          data-drag-active={dragOver || undefined}
          className={cn(
            'data-[drag-active]:outline-2 data-[drag-active]:outline-solid data-[drag-active]:outline-offset-2 data-[drag-active]:outline-bakin-focus-ring',
            className,
          )}
          onClick={() => inputRef.current?.click()}
          {...dropProps}
        >
          {children}
        </Button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        data-slot="file-input"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-label={label}
        tabIndex={-1}
        className="hidden"
        onChange={(event) => {
          takeFiles(event.target.files, false)
          event.target.value = ''
        }}
      />
    </>
  )
}
