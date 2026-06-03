import type { TaskLogEntry } from '../types'

export interface DispatchFailureDetail {
  category?: string
  reasonCode?: string
  summary?: string
  specificReason?: string
  retryable?: boolean
  provider?: string
  model?: string
  cooldownReason?: string
  rawError?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function getDispatchFailureDetail(entry: TaskLogEntry): DispatchFailureDetail | null {
  const data = entry.data
  if (!isRecord(data)) return null
  const raw = data.dispatchFailure
  if (!isRecord(raw)) return null

  return {
    category: asString(raw.category),
    reasonCode: asString(raw.reasonCode),
    summary: asString(raw.summary),
    specificReason: asString(raw.specificReason),
    retryable: typeof raw.retryable === 'boolean' ? raw.retryable : undefined,
    provider: asString(raw.provider),
    model: asString(raw.model),
    cooldownReason: asString(raw.cooldownReason),
    rawError: asString(raw.rawError),
  }
}

export function getLatestDispatchFailure(log?: TaskLogEntry[]): DispatchFailureDetail | null {
  if (!log) return null
  for (let i = log.length - 1; i >= 0; i--) {
    const detail = getDispatchFailureDetail(log[i])
    if (detail) return detail
  }
  return null
}

export function compactDispatchFailureLabel(detail: DispatchFailureDetail): string {
  if (detail.category === 'model_provider_unavailable') {
    return 'Dispatch failed: model provider unavailable'
  }
  return detail.summary || 'Dispatch failed'
}

export function specificDispatchFailureLabel(detail: DispatchFailureDetail): string {
  if (detail.specificReason) return detail.specificReason
  if (detail.reasonCode === 'provider_cooldown') return 'Provider in cooldown after timeout'
  if (detail.reasonCode === 'auth_profile_unavailable') return 'Auth profile unavailable'
  return 'Runtime dispatch failed'
}
