import type { HealthReport } from '@makinbakin/sdk/types'
import { healthReportSchema } from './route-schemas'

export const HEALTH_REPORT_URL = '/api/plugins/health/doctor'
export const HEALTH_REPORT_REFRESH_MS = 60_000
export const HEALTH_REPORT_READ_TIMEOUT_MS = 15_000
// The longest registered check currently has a 120-second server deadline.
// Leave enough transport/serialization headroom for a valid full sweep.
export const HEALTH_REPORT_SWEEP_TIMEOUT_MS = 135_000

export function parseHealthReportResponse(value: unknown): HealthReport {
  const parsed = healthReportSchema.safeParse(value)
  if (!parsed.success) throw new Error('Health report response was invalid')
  return parsed.data as unknown as HealthReport
}

export async function requestHealthReport(
  url: string,
  options: { fresh: boolean; signal: AbortSignal },
): Promise<HealthReport> {
  const response = await fetch(options.fresh ? `${url}/run` : url, options.fresh
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: options.signal,
      }
    : { signal: options.signal })
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return parseHealthReportResponse(await response.json())
}
