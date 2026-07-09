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

/** Fields that describe a result, in preference order (highest signal first). */
const SUMMARY_FIELDS = ['notice', 'summary', 'message', 'title', 'name', 'assetId', 'id']
/** Status/bookkeeping keys that carry no content for a one-line summary. */
const NOISE_KEYS = new Set(['ok', 'success', 'status', 'version', 'taskid', 'via', 'duplicate'])

/**
 * ONE compact line for chips/badges. Skips status noise (`ok: true` is shown
 * by the chip's color, not its text), prefers a descriptive field, and
 * describes collections by count rather than dropping them.
 */
export function summarizeStructured(value: unknown, cap = 120): string {
  const clip = (text: string) => (text.length > cap ? `${text.slice(0, cap - 1)}…` : text)
  const v = unwrapToolResult(value) // peel any (double-)wrapped envelope first
  if (v === null || v === undefined) return ''
  if (isScalar(v)) return clip(String(v))
  if (Array.isArray(v)) return clip(`${v.length} item${v.length === 1 ? '' : 's'}`)

  const obj = v as Record<string, unknown>

  // Errors first: surface the message, not the shape.
  if (obj.ok === false || obj.success === false) {
    const err = obj.error ?? obj.message ?? obj.reason
    if (isScalar(err) && err !== '') return clip(`error: ${err}`)
    return 'error'
  }
  if (isScalar(obj.error) && obj.error !== '') return clip(`error: ${obj.error}`)

  // Highest-signal descriptive field.
  for (const key of SUMMARY_FIELDS) {
    if (isScalar(obj[key]) && obj[key] !== '') return clip(String(obj[key]))
  }

  // Describe content fields (collections by count), skipping status noise.
  const parts: string[] = []
  for (const [k, val] of Object.entries(obj)) {
    if (NOISE_KEYS.has(k.toLowerCase())) continue
    if (val === null || val === undefined || val === '') continue
    if (Array.isArray(val)) parts.push(`${val.length} ${humanizeKey(k).toLowerCase()}`)
    else if (isScalar(val)) parts.push(`${humanizeKey(k)}: ${val}`)
    else parts.push(humanizeKey(k).toLowerCase())
  }
  if (parts.length > 0) return clip(parts.join(', '))

  // Nothing but status noise → the operation simply succeeded.
  return obj.ok === true || obj.success === true ? 'done' : ''
}

/**
 * Peel a runtime tool-result envelope to its meaningful payload:
 *   { content: [{ type:'text', text }] } → the joined text, JSON-parsed when
 *   the text is itself a JSON document (bakin exec tools return JSON strings).
 * Peels REPEATEDLY — an agent that shells a tool via bash produces a
 * doubly-wrapped envelope (runtime content → shell stdout → MCP content).
 * Non-envelope values pass through unchanged. Never throws.
 */
export function unwrapToolResult(value: unknown, depth = 6): unknown {
  if (depth <= 0) return value
  if (typeof value === 'string') {
    const parsed = maybeParseJson(value)
    // If the string WAS json (parsed to an object/array), keep peeling.
    return parsed === value ? value : unwrapToolResult(parsed, depth - 1)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const content = (value as { content?: unknown }).content
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (part && typeof part === 'object' && (part as { type?: string }).type === 'text'
        ? String((part as { text?: unknown }).text ?? '')
        : ''))
      .join('')
      .trim()
    if (text) return unwrapToolResult(text, depth - 1)
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
