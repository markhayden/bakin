/**
 * Perform a `request` decision choice from an incident card (SDK
 * `HealthDecisionChoice`): the owner's own route, JSON in, an honest error
 * message out. The caller reruns the check afterwards.
 */
import type { HealthDecisionChoice } from '@makinbakin/sdk/types'

export type RequestDecisionChoice = Extract<HealthDecisionChoice, { kind: 'request' }>

export async function performDecisionChoice(choice: RequestDecisionChoice, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(choice.url, {
    method: choice.method,
    headers: { 'Content-Type': 'application/json' },
    ...(choice.body !== undefined ? { body: JSON.stringify(choice.body) } : {}),
  })
  if (res.ok) return
  const body = await res.json().catch(() => null) as { error?: unknown; message?: unknown } | null
  const reason = typeof body?.error === 'string' ? body.error : typeof body?.message === 'string' ? body.message : `HTTP ${res.status}`
  throw new Error(`${choice.label} failed: ${reason}`)
}
