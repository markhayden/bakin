'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Markdown renderer.
 *
 * Two responsibilities beyond plain react-markdown:
 *   1. GitHub-Flavored Markdown via remark-gfm — tables, strikethrough,
 *      task lists, autolinks. Tables in particular are common in agent
 *      content (skills with parameter tables, lessons, etc.)
 *   2. Bakin marker awareness — `<!-- bakin:X:start -->...<!-- bakin:X:end -->`
 *      pairs render inside a styled container so the user can see at a
 *      glance which sections are projector-managed and shouldn't be
 *      hand-edited. Subtle treatment: thin dotted border + small label.
 */

const MARKER_PAIR = /<!--\s*bakin:([^\s]+?):start\s*-->([\s\S]*?)<!--\s*bakin:\1:end\s*-->/g

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

function MarkdownBody({ content }: { content: string }) {
  if (!content.trim()) return null
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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
