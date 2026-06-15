import type { TuiStatus } from '../style-tokens'

export interface DetailFieldRow {
  field: string
  value: string
}

export function valueText(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

export function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0
}

export function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return count === 1 ? singular : pluralLabel
}

export function listText(value: unknown, fallback = '-'): string {
  if (!Array.isArray(value)) return valueText(value, fallback)
  if (value.length === 0) return fallback
  return value.map(item => valueText(item)).join(', ')
}

export function detailText(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback
  if (Array.isArray(value)) return listText(value, fallback)
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export function timestampText(value: unknown): string {
  const text = valueText(value)
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString()
}

export function metadataAgent(value: unknown): string {
  if (!value || typeof value !== 'object') return 'unknown'
  const agent = (value as { agent?: unknown }).agent
  return valueText(agent, 'unknown')
}

export function objectField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[key]
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function bytesText(value: unknown): string {
  const bytes = typeof value === 'number' && Number.isFinite(value) ? value : Number(value)
  if (!Number.isFinite(bytes)) return valueText(value)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function daysUntilText(value: unknown): string {
  const text = valueText(value)
  const diff = new Date(text).getTime() - Date.now()
  if (Number.isNaN(diff)) return text
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'expiring'
  return `${days}d`
}

export function tuiStatusValue(value: unknown): TuiStatus | undefined {
  switch (value) {
    case 'ok':
    case 'warn':
    case 'fail':
    case 'skip':
    case 'ready':
    case 'run':
    case 'blocked':
    case 'applied':
    case 'sent':
    case 'todo':
    case 'done':
      return value
    default:
      return undefined
  }
}

export function flattenDetailFields(record: Record<string, unknown>, prefix = ''): DetailFieldRow[] {
  return Object.entries(record).flatMap(([key, value]) => {
    const field = prefix ? `${prefix}.${key}` : key
    if (isPlainRecord(value)) return flattenDetailFields(value, field)
    return [{ field, value: detailText(value) }]
  })
}

export function pathRows(paths: unknown): DetailFieldRow[] {
  if (!isPlainRecord(paths)) return []
  return Object.entries(paths)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, value]) => ({ field, value: valueText(value) }))
}
