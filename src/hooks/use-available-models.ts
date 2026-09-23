'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AvailableModel } from '@makinbakin/sdk/types'

import { usePluginEvent } from './use-plugin-event'

/**
 * The available-models catalog for pickers outside the Models page (Team's
 * agent form and detail). Read-only: one bounded `GET /api/plugins/models/
 * available[?agentId=]` per mount, shared across pickers mounting in the
 * same paint for the same SCOPE through a single-flight promise — but NEVER
 * cached across mounts: the catalog's eligibility overlay changes with
 * credentials, rejections and saves, and a picker must never offer a model
 * the server now knows is dead (#907). Every catalog-changing path on the
 * server emits `models.catalog_changed`; subscribed pickers refetch on it.
 *
 * Scope (#907 review): a picker FOR one agent asks with that agent's id so
 * eligibility is judged under the agent's own credentials — the same scope
 * the write path validates an agent pin under. Unscoped = the install.
 */
const inFlight = new Map<string, Promise<AvailableModel[]>>()

function catalogUrl(agentId?: string): string {
  return agentId ? `/api/plugins/models/available?agentId=${encodeURIComponent(agentId)}` : '/api/plugins/models/available'
}

function readCatalog(agentId?: string): Promise<AvailableModel[]> {
  return fetch(catalogUrl(agentId))
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { models?: AvailableModel[] } | null) => (data && Array.isArray(data.models) ? data.models : []))
    .catch(() => [] as AvailableModel[])
}

/**
 * Mount-time reads share the in-flight request of their scope; a `fresh`
 * read (the server said the catalog changed) always issues its own request
 * AFTER any in-flight one settles — the dedupe must never answer a refetch
 * with pre-change rows.
 */
function fetchAvailableModels(agentId: string | undefined, fresh = false): Promise<AvailableModel[]> {
  const key = agentId ?? ''
  const pending = inFlight.get(key)
  if (pending && !fresh) return pending
  const read = () => readCatalog(agentId)
  const request: Promise<AvailableModel[]> = (pending ?? Promise.resolve()).then(read, read)
  inFlight.set(key, request)
  void request.finally(() => { if (inFlight.get(key) === request) inFlight.delete(key) })
  return request
}

/**
 * The available-models catalog (empty array until loaded / on failure);
 * refetches when the server says it changed. Pass the agent a picker belongs
 * to so its verdicts are that agent's.
 */
export function useAvailableModels(agentId?: string): AvailableModel[] {
  const [models, setModels] = useState<AvailableModel[]>([])

  const load = useCallback((fresh: boolean) => {
    let cancelled = false
    void fetchAvailableModels(agentId, fresh).then((list) => {
      if (!cancelled) setModels(list)
    })
    return () => { cancelled = true }
  }, [agentId])

  useEffect(() => load(false), [load])
  usePluginEvent('models.catalog_changed', () => { load(true) })

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
