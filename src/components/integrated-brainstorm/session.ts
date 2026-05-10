import type { BrainstormMessage } from './types'

const ACTIVITY_CONTENT_MAX_CHARS = 500
const ACTIVITY_PREVIEW_MAX_CHARS = 2000
const ACTIVITY_METADATA_MAX_CHARS = 4000
const ACTIVITY_DATA_MAX_KEYS = 24

export interface BrainstormActivityStorageInput {
  id?: string
  kind?: string
  content?: string
  data?: unknown
  timestamp?: string
}

export interface BrainstormActivityStorageRecord {
  kind: string
  content: string
  data?: unknown
}

export function brainstormThreadId(scope: string, entityId: string, agentId: string): string {
  return [scope, entityId, agentId].map(threadIdPart).join(':')
}

export function normalizeBrainstormActivityForStorage(
  activity: BrainstormActivityStorageInput,
): BrainstormActivityStorageRecord | null {
  const content = typeof activity.content === 'string' ? truncate(activity.content.trim(), ACTIVITY_CONTENT_MAX_CHARS) : ''
  if (!content) return null
  const data = normalizeActivityData(activity.data)
  return {
    kind: typeof activity.kind === 'string' && activity.kind ? activity.kind : 'runtime_status',
    content,
    ...(data !== undefined ? { data } : {}),
  }
}

export function normalizeBrainstormActivityMessageForStorage(
  activity: BrainstormActivityStorageInput,
): Pick<BrainstormMessage, 'role' | 'kind' | 'content' | 'data'> | null {
  const normalized = normalizeBrainstormActivityForStorage(activity)
  if (!normalized) return null
  return {
    role: 'activity',
    kind: normalized.kind,
    content: normalized.content,
    ...(normalized.data !== undefined ? { data: normalized.data } : {}),
  }
}

function threadIdPart(value: string): string {
  const trimmed = value.trim()
  return encodeURIComponent(trimmed || 'default')
}

function normalizeActivityData(data: unknown): unknown {
  if (data === undefined) return undefined
  if (!isRecord(data)) return normalizeActivityValue(data, 'value')

  const out: Record<string, unknown> = {}
  let count = 0
  for (const [key, value] of Object.entries(data)) {
    if (count >= ACTIVITY_DATA_MAX_KEYS) {
      out.truncatedKeys = Object.keys(data).length - count
      break
    }
    out[key] = normalizeActivityValue(value, key)
    count += 1
  }
  return out
}

function normalizeActivityValue(value: unknown, key: string): unknown {
  if (typeof value === 'string') {
    const max = isPreviewKey(key) ? ACTIVITY_PREVIEW_MAX_CHARS : ACTIVITY_METADATA_MAX_CHARS
    return truncate(value, max)
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (value === undefined) return undefined
  return truncate(stringify(value), ACTIVITY_METADATA_MAX_CHARS)
}

function isPreviewKey(key: string): boolean {
  return key === 'inputPreview' ||
    key === 'argumentsPreview' ||
    key === 'outputPreview' ||
    key === 'resultPreview'
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
