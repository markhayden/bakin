'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'

import { copyToClipboard } from '@/lib/copy-to-clipboard'

/**
 * Markdown renderer.
 *
 * Responsibilities beyond plain react-markdown:
 *   1. GitHub-Flavored Markdown via remark-gfm — tables, strikethrough,
 *      task lists, autolinks.
 *   2. Syntax highlighting via rehype-highlight (lowlight `common` grammar
 *      subset — deliberately NOT the full highlight.js language bundle),
 *      with a language label + copy button on fenced blocks.
 *   3. Media: images render lazily with a click-to-lightbox overlay;
 *      video-extension URLs render as a <video> element. Agent asset URLs
 *      (`/api/assets/...`) work as-is.
 *   4. Safe links: external hrefs open in a new tab with
 *      `rel="noopener noreferrer"`; internal (`/...`) links navigate
 *      normally. (Plain anchors on purpose — this component renders in
 *      contexts without a router provider.)
 *   5. Bakin marker awareness — `<!-- bakin:X:start -->...<!-- bakin:X:end -->`
 *      pairs render inside a styled container so the user can see at a
 *      glance which sections are projector-managed.
 */

const MARKER_PAIR = /<!--\s*bakin:([^\s]+?):start\s*-->([\s\S]*?)<!--\s*bakin:\1:end\s*-->/g

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?.*)?$/i

type Segment =
  | { kind: 'normal'; text: string }
  | { kind: 'bakin'; markerName: string; body: string }

/**
 * Split markdown source on bakin marker pairs. Orphan markers (start
 * without matching end) are left in the normal segment as-is.
 */
function splitBakinSegments(source: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0
  for (const match of source.matchAll(MARKER_PAIR)) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      segments.push({ kind: 'normal', text: source.slice(lastIndex, start) })
    }
    segments.push({
      kind: 'bakin',
      markerName: match[1],
      body: match[2].trim(),
    })
    lastIndex = start + match[0].length
  }
  if (lastIndex < source.length) {
    segments.push({ kind: 'normal', text: source.slice(lastIndex) })
  }
  return segments
}

/** Flatten a react-markdown children tree to its raw text. */
function nodeText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (typeof node === 'object' && 'props' in (node as Record<string, unknown>)) {
    return nodeText((node as { props?: { children?: unknown } }).props?.children)
  }
  return ''
}

function languageOf(codeClassName: string | undefined): string | null {
  const match = /language-([\w+-]+)/.exec(codeClassName ?? '')
  return match ? match[1] : null
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const child = Array.isArray(children) ? children[0] : children
  const codeProps =
    child && typeof child === 'object' && 'props' in child
      ? (child as { props: { className?: string; children?: unknown } }).props
      : undefined
  const language = languageOf(codeProps?.className)
  const raw = nodeText(codeProps?.children).replace(/\n$/, '')

  const copy = useCallback(() => {
    void copyToClipboard(raw).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [raw])

  return (
    <div className="group/code my-3 overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {language ?? 'text'}
        </span>
        <button
          type="button"
          data-md-copy
          onClick={copy}
          aria-label="Copy code"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:text-foreground group-hover/code:opacity-100"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-sm leading-relaxed">{children}</pre>
    </div>
  )
}

function MediaImage({ src, alt }: { src?: string | Blob; alt?: string }) {
  const [open, setOpen] = useState(false)
  const url = typeof src === 'string' ? src : ''

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!url) return null
  if (VIDEO_EXT.test(url)) {
    // Agent-produced media has no caption track.
    return <video src={url} controls className="my-2 max-h-96 max-w-full rounded-md" />
  }
  return (
    <>
      <img
        src={url}
        alt={alt ?? ''}
        loading="lazy"
        onClick={() => setOpen(true)}
        className="my-2 max-h-80 max-w-full cursor-zoom-in rounded-md border border-border"
      />
      {open
        ? createPortal(
            <div
              data-md-lightbox
              role="dialog"
              aria-label={alt || 'Image'}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-8"
            >
              <img src={url} alt={alt ?? ''} className="max-h-full max-w-full rounded-md" />
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

function SafeAnchor({
  href,
  children,
}: {
  href?: string
  children?: React.ReactNode
}) {
  const external = /^[a-z][a-z0-9+.-]*:/i.test(href ?? '')
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
  return <a href={href}>{children}</a>
}

const MARKDOWN_COMPONENTS: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  img: ({ src, alt }) => <MediaImage src={src} alt={alt} />,
  a: ({ href, children }) => <SafeAnchor href={href}>{children}</SafeAnchor>,
}

function MarkdownBody({ content }: { content: string }) {
  if (!content.trim()) return null
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  )
}

export function MarkdownContent({ content }: { content: string }) {
  const segments = splitBakinSegments(content)
  return (
    <div className="prose-invert">
      {segments.map((seg, i) =>
        seg.kind === 'normal' ? (
          <MarkdownBody key={i} content={seg.text} />
        ) : (
          <div
            key={i}
            data-bakin-block={seg.markerName}
            className="bakin-block my-3 rounded-md border border-dashed border-zinc-500/70 px-4 py-3 bg-zinc-800/40"
          >
            <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-mono mb-2">
              bakin:{seg.markerName}
            </div>
            <MarkdownBody content={seg.body} />
          </div>
        ),
      )}
    </div>
  )
}
