'use client'

/** Canonical controlled-editor implementation for the focused content entrypoint. */

import { type ReactNode } from 'react'
import { Textarea } from '@bakin/ui'

import { MarkdownContent, type MarkdownContentProps } from './markdown-content'

export type MarkdownEditorFormat = 'markdown' | 'yaml' | 'json' | 'text'
export type MarkdownEditorHeight = 'compact' | 'document' | 'viewport' | 'fill'
export type MarkdownEditorMode = 'edit' | 'preview'

/** Props for the preferred controlled, host-composed editor contract. */
interface MarkdownEditorControlledProps {
  label: string
  content: string
  mode: MarkdownEditorMode
  onChange: (content: string) => void
  placeholder?: string
  format?: MarkdownEditorFormat
  height?: MarkdownEditorHeight
  className?: string
  description?: ReactNode
  renderInternalLink?: MarkdownContentProps['renderInternalLink']
}

/** Existing editor shape retained for source-compatible official consumers. */
interface MarkdownEditorCompatibilityProps {
  label?: string
  content: string
  editing: boolean
  onChange: (content: string) => void
  placeholder?: string
  format?: MarkdownEditorFormat
  /** @deprecated Use the semantic `height` contract. Existing values normalize to `viewport`. */
  minHeight?: string
  className?: string
}

export type MarkdownEditorProps = MarkdownEditorControlledProps | MarkdownEditorCompatibilityProps

const heightClasses: Record<MarkdownEditorHeight, string> = {
  compact: 'min-h-40',
  document: 'min-h-80',
  viewport: 'bakin-markdown-editor-viewport',
  fill: 'min-h-full',
}

function MarkdownEditorSurface({
  label,
  content,
  mode,
  onChange,
  placeholder = 'No content',
  format = 'markdown',
  height = 'document',
  className,
  description,
  renderInternalLink,
}: MarkdownEditorControlledProps) {
  if (mode === 'edit') {
    return (
      <div data-markdown-editor="" data-mode="edit" className={`grid min-w-0 gap-bakin-2 ${className ?? ''}`}>
        <label className="font-bakin-typography-family-ui [font-size:var(--bakin-typography-size-body)] font-bakin-typography-weight-semibold text-bakin-text-primary">
          {label}
          <Textarea
            value={content}
            onChange={(event) => onChange(event.target.value)}
            className={`mt-bakin-2 ${heightClasses[height]} font-bakin-typography-family-mono`}
            placeholder={placeholder}
          />
        </label>
        {description ? (
          <div className="[font-size:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-text-muted">
            {description}
          </div>
        ) : null}
      </div>
    )
  }

  if (!content) {
    return (
      <section
        data-markdown-editor=""
        data-mode="preview"
        aria-label={`${label} preview`}
        className={`grid ${heightClasses[height]} place-items-center rounded-bakin-surface border border-dashed border-bakin-border-subtle bg-bakin-surface-default/35 px-bakin-4 py-bakin-6 text-center font-bakin-typography-family-ui text-bakin-text-muted ${className ?? ''}`}
      >
        <p>{placeholder}</p>
      </section>
    )
  }

  if (format === 'markdown') {
    return (
      <section
        data-markdown-editor=""
        data-mode="preview"
        aria-label={`${label} preview`}
        className={`${heightClasses[height]} min-w-0 ${className ?? ''}`}
      >
        <MarkdownContent content={content} renderInternalLink={renderInternalLink} />
      </section>
    )
  }

  let displayContent = content
  if (format === 'json') {
    try {
      displayContent = JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      // Invalid in-progress JSON remains exact so the user can diagnose it.
    }
  }

  return (
    <section
      data-markdown-editor=""
      data-mode="preview"
      aria-label={`${label} preview`}
      className={`min-w-0 ${heightClasses[height]} overflow-auto rounded-bakin-surface border border-bakin-border-subtle bg-bakin-canvas-default p-bakin-4 ${className ?? ''}`}
    >
      <pre className={`m-0 font-bakin-typography-family-mono [font-size:var(--bakin-typography-size-body)] leading-relaxed text-bakin-text-primary ${format === 'text' ? 'whitespace-pre-wrap' : ''}`}>
        {displayContent}
      </pre>
    </section>
  )
}

/** Controlled edit/preview surface with semantic sizing and an explicit label. */
export function MarkdownEditor(props: MarkdownEditorProps) {
  if ('editing' in props) {
    return (
      <div className="min-h-0">
        <MarkdownEditorSurface
          label={props.label ?? 'Markdown content'}
          content={props.content}
          mode={props.editing ? 'edit' : 'preview'}
          onChange={props.onChange}
          placeholder={props.placeholder}
          format={props.format}
          height={props.minHeight ? 'viewport' : 'document'}
          className={props.className}
        />
      </div>
    )
  }

  return <MarkdownEditorSurface {...props} />
}
