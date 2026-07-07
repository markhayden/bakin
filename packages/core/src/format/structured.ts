/**
 * Human-readable rendering of structured (JSON-ish) values — the shared home
 * (#608) so UI surfaces, channels, and tool-activity feeds never dump raw
 * JSON blobs at people. Client + server safe (pure, no deps).
 *
 * Variants:
 *   - formatStructured(value, { markdown }) → labeled multi-line prose
 *     (`Label: value`, nested objects indented; markdown bolds the labels
 *     for channel messages).
 *   - summarizeStructured(value, cap) → ONE compact line for chips/badges.
 *   - unwrapToolResult(value) → peel a runtime tool-result envelope
 *     (`{content:[{type:'text',text}]}`) down to its meaningful payload,
 *     parsing an inner JSON string when present.
 */

export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

export interface FormatStructuredOptions {
  /** Bold labels for markdown surfaces (channel messages). */
  markdown?: boolean
  /** Override the section heading; a blank line follows it. Omit for no heading. */
  heading?: string
  /** Cap the rendered body; appends a truncation marker when exceeded. */
  cap?: number
}

function renderEntry(key: string, value: unknown, indent: string, markdown: boolean): string[] {
  const name = humanizeKey(key)
  const label = `${indent}${markdown ? `**${name}:**` : `${name}:`}`
  if (value === null || value === undefined || value === '') return []
  if (isScalar(value)) {
    const text = String(value)
    return text.length > 80 ? [label, `${indent}${text}`] : [`${label} ${text}`]
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return []
    if (value.every(isScalar)) return [`${label} ${value.map(String).join(', ')}`]
    return [label, ...value.flatMap((entry, i) => renderEntry(String(i + 1), entry, `${indent}  `, markdown))]
  }
  if (typeof value === 'object') {
    const children = Object.entries(value as Record<string, unknown>)
      .flatMap(([childKey, child]) => renderEntry(childKey, child, `${indent}  `, markdown))
    return children.length > 0 ? [label, ...children] : []
  }
  return []
}

/**
 * Labeled prose for a structured value. Returns '' when there's nothing
 * human-reviewable (empty object / all-empty fields) — callers show nothing
 * rather than a bare "{}". A scalar renders as itself.
 */
export function formatStructured(value: unknown, opts: FormatStructuredOptions = {}): string {
  if (value === null || value === undefined) return ''
  if (isScalar(value)) return String(value)

  const markdown = opts.markdown ?? false
  const entries = Array.isArray(value)
    ? value.flatMap((entry, i) => renderEntry(String(i + 1), entry, '', markdown))
    : Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => renderEntry(k, v, '', markdown))
  if (entries.length === 0) return ''

  const rendered = entries.join('\n')
  const cap = opts.cap ?? Infinity
  const body = rendered.length > cap ? `${rendered.slice(0, cap)}\n...[truncated]` : rendered
  if (opts.heading) return `${opts.heading}\n\n${body}`
  return body
}

/**
 * ONE compact line for chips/badges: prefers a status/summary field, else a
 * `key: value, …` join of scalar fields, else a length-capped fallback.
 */
export function summarizeStructured(value: unknown, cap = 120): string {
  const clip = (text: string) => (text.length > cap ? `${text.slice(0, cap - 1)}…` : text)
  if (value === null || value === undefined) return ''
  if (isScalar(value)) return clip(String(value))
  if (Array.isArray(value)) return clip(`${value.length} item${value.length === 1 ? '' : 's'}`)

  const obj = value as Record<string, unknown>
  // A common tool shape: { ok: true, ...one meaningful field }.
  for (const key of ['summary', 'message', 'title', 'name', 'id', 'assetId', 'error']) {
    if (isScalar(obj[key]) && obj[key] !== '') {
      const prefix = obj.ok === false || key === 'error' ? 'error: ' : ''
      return clip(`${prefix}${obj[key]}`)
    }
  }
  const scalars = Object.entries(obj)
    .filter(([, v]) => isScalar(v) && v !== '')
    .map(([k, v]) => `${humanizeKey(k)}: ${v}`)
  if (scalars.length > 0) return clip(scalars.join(', '))
  return clip(Object.keys(obj).length > 0 ? `{ ${Object.keys(obj).join(', ')} }` : '')
}

/**
 * Peel a runtime tool-result envelope to its meaningful payload:
 *   { content: [{ type:'text', text }] } → the joined text, JSON-parsed when
 *   the text is itself a JSON document (bakin exec tools return JSON strings).
 * Non-envelope values pass through unchanged. Never throws.
 */
export function unwrapToolResult(value: unknown): unknown {
  if (typeof value === 'string') return maybeParseJson(value)
  if (!value || typeof value !== 'object') return value

  const content = (value as { content?: unknown }).content
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (part && typeof part === 'object' && (part as { type?: string }).type === 'text'
        ? String((part as { text?: unknown }).text ?? '')
        : ''))
      .join('')
      .trim()
    if (text) return maybeParseJson(text)
  }
  return value
}

function maybeParseJson(text: string): unknown {
  const trimmed = text.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return text
  try {
    return JSON.parse(trimmed)
  } catch {
    return text
  }
}
