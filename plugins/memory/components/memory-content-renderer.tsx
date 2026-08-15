'use client'

/**
 * MemoryContentRenderer — auto-detects the format of a memory row's body.
 *
 *   JSON      → pretty-printed in the kit CodeBlock, tokenized as JSON
 *   Markdown  → rendered via the shared MarkdownContent (ReactMarkdown)
 *   Text      → the same CodeBlock with no language claimed, so the body is
 *               shown verbatim rather than mis-highlighted
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
import { CodeBlock, MarkdownContent } from '@makinbakin/sdk/content'

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
    // MarkdownContent owns its own fenced-code frame (surface, padding, copy
    // action), so this wrapper sets prose size only — overriding the kit's
    // internal `pre`/`code` DOM from here would fight that contract.
    return (
      <div className="text-bakin-typography-size-body">
        <MarkdownContent content={content} />
      </div>
    )
  }
  return <CodeBlock code={content} language="text" wrap />
}

function JsonBlock({ raw }: { raw: string }) {
  let pretty: string
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    pretty = raw
  }
  return <CodeBlock code={pretty} language="json" wrap copyable />
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
