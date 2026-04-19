'use client'

/**
 * MemoryContentRenderer — auto-detects the format of a memory row's body.
 *
 *   JSON      → pretty-printed with 2-space indent and monospace rendering
 *   Markdown  → rendered via the shared MarkdownContent (ReactMarkdown)
 *   Text      → <pre> with preserved whitespace
 *
 * Detection is cheap and intentionally conservative: we only hit the JSON
 * branch on a full parse, and we only hit the markdown branch when there's
 * at least one fence / heading / list marker. Everything else falls through
 * to plain text so we don't accidentally mangle tool-result strings that
 * happen to contain a `#` character.
 *
 * Callers can override detection via `format` when they already know — turn
 * `tool_call` rows, for example, are always JSON-stringified toolCall blocks.
 */
import { MarkdownContent } from '@/components/markdown-content'

export type ContentFormat = 'json' | 'markdown' | 'text'

interface Props {
  content: string
  /** Force a specific renderer. Useful when the caller knows the shape. */
  format?: ContentFormat
}

export function MemoryContentRenderer({ content, format }: Props) {
  const resolved = format ?? detectFormat(content)

  if (resolved === 'json') {
    return <JsonBlock raw={content} />
  }
  if (resolved === 'markdown') {
    return (
      <div className="text-sm [&_pre]:bg-muted [&_pre]:rounded-md [&_pre]:p-3 [&_code]:text-xs">
        <MarkdownContent content={content} />
      </div>
    )
  }
  return <TextBlock content={content} />
}

function JsonBlock({ raw }: { raw: string }) {
  let pretty: string
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    pretty = raw
  }
  return (
    <pre className="text-xs font-mono bg-muted/60 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-words">
      {pretty}
    </pre>
  )
}

function TextBlock({ content }: { content: string }) {
  return (
    <pre className="text-sm font-sans whitespace-pre-wrap break-words leading-relaxed">
      {content}
    </pre>
  )
}

/** Heuristic format detection. Conservative — falls through to text. */
export function detectFormat(raw: string): ContentFormat {
  const trimmed = raw.trim()
  if (!trimmed) return 'text'

  if (isLikelyJson(trimmed)) return 'json'
  if (isLikelyMarkdown(trimmed)) return 'markdown'
  return 'text'
}

function isLikelyJson(s: string): boolean {
  const first = s[0]
  const last = s[s.length - 1]
  if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) return false
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

/**
 * Markdown detector — requires at least one unambiguous marker. We skip
 * single `#` because plain text with a hashtag is common and shouldn't
 * land in a markdown renderer that strips raw HTML.
 */
function isLikelyMarkdown(s: string): boolean {
  if (/^```/m.test(s)) return true
  if (/^#{1,6}\s+\S/m.test(s)) return true
  if (/^\s*[-*]\s+\S/m.test(s)) return true
  if (/^\s*\d+\.\s+\S/m.test(s)) return true
  if (/\[[^\]]+\]\([^)]+\)/.test(s)) return true
  return false
}
