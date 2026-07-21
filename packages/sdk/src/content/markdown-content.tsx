'use client'

/** Canonical rich-content implementation for the focused content entrypoint. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Button,
  Checkbox,
} from '@bakin/ui'

const MARKER_PAIR = /<!--\s*bakin:([^\s]+?):start\s*-->([\s\S]*?)<!--\s*bakin:\1:end\s*-->/g
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?.*)?$/i

type Segment =
  | { kind: 'normal'; text: string }
  | { kind: 'bakin'; markerName: string; body: string }

/** Properties available when integrating Bakin's existing routing link. */
export interface MarkdownInternalLinkProps {
  href: string
  children: ReactNode
}

/** Props for rich, safe Bakin Markdown presentation. */
export interface MarkdownContentProps {
  content: string
  className?: string
  /** Use the established host/plugin link for internal SPA navigation. */
  renderInternalLink?: (props: MarkdownInternalLinkProps) => ReactNode
}

function splitBakinSegments(source: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0
  for (const match of source.matchAll(MARKER_PAIR)) {
    const start = match.index ?? 0
    if (start > lastIndex) segments.push({ kind: 'normal', text: source.slice(lastIndex, start) })
    segments.push({ kind: 'bakin', markerName: match[1], body: match[2].trim() })
    lastIndex = start + match[0].length
  }
  if (lastIndex < source.length) segments.push({ kind: 'normal', text: source.slice(lastIndex) })
  return segments
}

function nodeText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (typeof node === 'object' && 'props' in (node as Record<string, unknown>)) {
    return nodeText((node as { props?: { children?: unknown } }).props?.children)
  }
  return ''
}

function languageOf(className: string | undefined): string | null {
  return /language-([\w+-]+)/.exec(className ?? '')?.[1] ?? null
}

function CopyIcon({ copied }: { copied: boolean }) {
  return copied ? (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-2">
      <path d="m3.5 8 2.8 2.8 6.2-6.2" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.5]">
      <rect x="5.25" y="5.25" width="7" height="7" rx="1.25" />
      <path d="M10.75 5.25v-1.5h-7v7h1.5" />
    </svg>
  )
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const child = Array.isArray(children) ? children[0] : children
  const codeProps = child && typeof child === 'object' && 'props' in child
    ? (child as { props: { className?: string; children?: unknown } }).props
    : undefined
  const language = languageOf(codeProps?.className)
  const raw = nodeText(codeProps?.children).replace(/\n$/, '')

  useEffect(() => () => {
    if (resetRef.current) clearTimeout(resetRef.current)
  }, [])

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(raw)
      setCopied(true)
      if (resetRef.current) clearTimeout(resetRef.current)
      resetRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Copy is progressive enhancement; the exact code stays selectable.
    }
  }, [raw])

  return (
    <div data-md-code="" className="my-bakin-4 min-w-0 overflow-hidden rounded-bakin-surface border border-bakin-border-subtle bg-bakin-canvas-default">
      <div className="flex min-h-bakin-8 items-center justify-between gap-bakin-2 border-b border-bakin-border-subtle bg-bakin-surface-default px-bakin-3 py-bakin-1">
        <span className="truncate font-bakin-typography-family-mono [font-size:var(--bakin-typography-size-meta)] uppercase tracking-wider text-bakin-text-muted">
          {language ?? 'text'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-md-copy=""
          onClick={() => void copy()}
          aria-label="Copy code"
          className="shrink-0 text-bakin-text-muted"
        >
          <CopyIcon copied={copied} />
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </Button>
      </div>
      <pre className="m-0 max-w-full overflow-x-auto p-bakin-4 font-bakin-typography-family-mono [font-size:var(--bakin-typography-size-body)] leading-relaxed text-bakin-text-primary">
        {children}
      </pre>
    </div>
  )
}

function MediaImage({ src, alt }: { src?: string | Blob; alt?: string }) {
  const url = typeof src === 'string' ? src : ''
  if (!url) return null
  if (VIDEO_EXT.test(url)) {
    return <video src={url} controls className="my-bakin-3 max-h-96 max-w-full rounded-bakin-surface border border-bakin-border-subtle" />
  }

  const label = alt?.trim() || 'Image'
  return (
    <Dialog>
      <DialogTrigger
        render={(
          <Button
            type="button"
            variant="ghost"
            size="md"
            aria-label={`Open ${label} preview`}
            className="my-bakin-3 h-auto max-w-full rounded-bakin-surface p-0"
          />
        )}
      >
        <img
          src={url}
          alt={alt ?? ''}
          loading="lazy"
          className="max-h-80 max-w-full rounded-bakin-surface border border-bakin-border-subtle object-contain"
        />
      </DialogTrigger>
      <DialogContent
        data-md-lightbox=""
        closeLabel="Close image preview"
        className="w-auto max-w-5xl overflow-hidden bg-bakin-canvas-default p-bakin-3"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{label} preview</DialogTitle>
          <DialogDescription>Expanded image preview.</DialogDescription>
        </DialogHeader>
        <img src={url} alt={alt ?? ''} className="max-h-full max-w-full rounded-bakin-surface object-contain" />
      </DialogContent>
    </Dialog>
  )
}

function SafeAnchor({
  href,
  children,
  renderInternalLink,
}: MarkdownInternalLinkProps & Pick<MarkdownContentProps, 'renderInternalLink'>) {
  const external = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)
  if (external) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  if (renderInternalLink) return renderInternalLink({ href, children })
  return <a href={href}>{children}</a>
}

function MarkdownBody({ content, renderInternalLink }: MarkdownContentProps) {
  const components = useMemo<Components>(() => ({
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    img: ({ src, alt }) => <MediaImage src={src} alt={alt} />,
    a: ({ href = '', children }) => (
      <SafeAnchor href={href} renderInternalLink={renderInternalLink}>{children}</SafeAnchor>
    ),
    table: ({ children, ...props }) => (
      <div data-md-table="" className="my-bakin-4 max-w-full overflow-x-auto rounded-bakin-surface border border-bakin-border-subtle">
        <table {...props}>{children}</table>
      </div>
    ),
    input: ({ type, checked, disabled }) => type === 'checkbox' ? (
      <Checkbox
        checked={Boolean(checked)}
        disabled={disabled}
        aria-label={checked ? 'Completed checklist item' : 'Incomplete checklist item'}
      />
    ) : null,
  }), [renderInternalLink])

  if (!content.trim()) return null
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
      {content}
    </ReactMarkdown>
  )
}

const markdownClasses = 'min-w-0 font-bakin-typography-family-ui [font-size:var(--bakin-typography-size-body)] leading-relaxed text-bakin-text-muted'

/** Rich GFM, code, media, and managed-section presentation for Bakin content. */
export function MarkdownContent({ content, className, renderInternalLink }: MarkdownContentProps) {
  const segments = splitBakinSegments(content)
  return (
    <div data-markdown-content="" className={`${markdownClasses} ${className ?? ''}`}>
      {segments.map((segment, index) => segment.kind === 'normal' ? (
        <MarkdownBody key={index} content={segment.text} renderInternalLink={renderInternalLink} />
      ) : (
        <section
          key={index}
          data-bakin-block={segment.markerName}
          aria-label={`Managed section: ${segment.markerName}`}
          className="my-bakin-4 rounded-bakin-surface border border-dashed border-bakin-border-subtle bg-bakin-surface-default/55 px-bakin-4 py-bakin-3"
        >
          <p className="mb-bakin-2 font-bakin-typography-family-mono [font-size:var(--bakin-typography-size-meta)] uppercase tracking-widest text-bakin-text-muted">
            bakin:{segment.markerName}
          </p>
          <MarkdownBody content={segment.body} renderInternalLink={renderInternalLink} />
        </section>
      ))}
    </div>
  )
}
