'use client'

import { useEffect, useState } from 'react'
import type { AvailableModel } from '@makinbakin/sdk/types'

/**
 * Module-level cache + single-flight promise per SCOPE for the available-
 * models catalog (`GET /api/plugins/models/available[?agentId=]`). Two
 * pickers mounting in the same paint for the same scope share one
 * round-trip. Read-only and cached — the models management page owns the
 * live `/refresh` mutation flow and keeps its own state rather than using
 * this hook. Deliberately NOT `useJsonFetch` (per-component state, no
 * cross-mount dedupe). Lives in the SDK proper (not the models plugin) since
 * T34: the wire contract is just the stable catalog URL.
 *
 * Scope (#907 review): a picker FOR one agent asks with that agent's id so
 * eligibility is judged under the agent's own credentials — the same scope
 * the write path validates an agent pin under. Unscoped = the install.
 */
const cached = new Map<string, AvailableModel[]>()
const inFlight = new Map<string, Promise<AvailableModel[]>>()

function scopeKey(agentId?: string): string {
  return agentId ?? ''
}

function catalogUrl(agentId?: string): string {
  return agentId ? `/api/plugins/models/available?agentId=${encodeURIComponent(agentId)}` : '/api/plugins/models/available'
}

function fetchAvailableModels(agentId?: string): Promise<AvailableModel[]> {
  const key = scopeKey(agentId)
  const hit = cached.get(key)
  if (hit) return Promise.resolve(hit)
  const pending = inFlight.get(key)
  if (pending) return pending
  const request = fetch(catalogUrl(agentId))
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { models?: AvailableModel[] } | null) => {
      const list = data && Array.isArray(data.models) ? data.models : []
      cached.set(key, list)
      return list
    })
    .catch(() => {
      cached.set(key, [])
      return [] as AvailableModel[]
    })
    .finally(() => { inFlight.delete(key) })
  inFlight.set(key, request)
  return request
}

/**
 * The available-models catalog (empty array until loaded / on failure).
 * Pass the agent a picker belongs to so its verdicts are that agent's.
 */
export function useAvailableModels(agentId?: string): AvailableModel[] {
  const key = scopeKey(agentId)
  const [models, setModels] = useState<AvailableModel[]>(() => cached.get(key) ?? [])

  useEffect(() => {
    const hit = cached.get(key)
    if (hit) {
      setModels(hit)
      return
    }
    let cancelled = false
    fetchAvailableModels(agentId).then((list) => {
      if (!cancelled) setModels(list)
    })
    return () => { cancelled = true }
  }, [key, agentId])

  return models
}

/** The option shape `ModelSelect` consumes — kept structurally identical to `ModelSelectOption`. */
export interface EligibleModelOption {
  id: string
  name: string
  provider?: string
  disabled: boolean
}

/**
 * Map catalog rows to picker options so NO picker can select a dead model
 * (#907): `ineligible` rows are disabled and carry the reason in their label
 * (the documented label-suffix composition until the SDK option gains a
 * description field); `unknown` rows stay selectable — missing evidence is
 * never a refusal.
 */
export function toModelSelectOptions(models: readonly AvailableModel[]): EligibleModelOption[] {
  return models.map((m) => {
    const e = m.eligibility
    const dead = e?.status === 'ineligible'
    return {
      id: m.id,
      name: dead ? `${m.name} — ${e.detail}` : m.name,
      provider: m.provider,
      disabled: dead,
    }
  })
}

/** Test-only: reset the module-level cache so tests run with a clean slate. */
export function __resetAvailableModelsCache(): void {
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) return
  cached.clear()
  inFlight.clear()
}
