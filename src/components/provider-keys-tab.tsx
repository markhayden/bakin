/**
 * Integrations & Keys settings tab.
 *
 * Two sections. Image providers: where each image provider's credential comes
 * from — the active runtime, a Bakin env override, the Bakin secret store, or
 * nothing — with write-only store management (runtime-/env-sourced rows are
 * read-only status; readiness comes from the images plugin's /providers).
 * Integration secrets: every named secret in the Bakin store grouped by
 * integration (discord.botToken, brave.apiKey, …) with add/remove — the
 * standing home capability packs and doctor remediation links point at.
 * All edits go through the masked /api/secrets surface; values are never
 * rendered back.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { DataTable, ListRow, ListRows, StatusBadge, type DataTableColumn, type StatusBadgeVariant, type StatusTone } from '@makinbakin/sdk/patterns'
import { Grid, Inline } from '@makinbakin/sdk/layout'
import { Alert, AlertDescription, Button, Field, FieldLabel, Form, FormActions, Input, Skeleton, SystemState } from '@makinbakin/sdk/ui'

export const PROVIDER_KEYS_TAB_ID = 'integrations'

interface ReadinessRow {
  id: string
  label: string
  servedBy?: 'runtime' | 'shim' | 'unconfigured'
  source?: 'native' | 'runtime' | 'native+runtime'
  configuredEnvVars?: string[]
}

function badgeFor(servedBy: ReadinessRow['servedBy']): { label: string; tone: StatusTone; variant: StatusBadgeVariant } {
  if (servedBy === 'runtime') return { label: 'Runtime', tone: 'success', variant: 'solid' }
  if (servedBy === 'shim') return { label: 'Bakin key', tone: 'neutral', variant: 'solid' }
  return { label: 'Not set', tone: 'neutral', variant: 'solid' }
}

export function ProviderKeysTab() {
  const [rows, setRows] = useState<ReadinessRow[]>([])
  const [runtimeName, setRuntimeName] = useState<string | null>(null)
  const [stored, setStored] = useState<string[]>([])
  const [secretNames, setSecretNames] = useState<Record<string, string[]>>({})
  const [addDraft, setAddDraft] = useState({ provider: '', name: '', value: '' })
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const mutationPending = useRef(false)
  // Adapter identity from the providers payload — copy never hardcodes one.
  const runtimeLabel = runtimeName ? `the runtime (${runtimeName})` : 'the runtime'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const read = async (url: string) => {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        // Image providers are contributed by an optional Bits plugin. Its
        // absence must not prevent managing unrelated integration secrets.
        if (response.status === 404 && url === '/api/plugins/images/providers') return { readiness: [] }
        if (!response.ok) throw new Error(`Settings could not be loaded (${response.status}).`)
        return response.json()
      }
      const [providers, secrets] = await Promise.all([
        read('/api/plugins/images/providers'),
        read('/api/secrets'),
      ])
      setRows(Array.isArray(providers?.readiness) ? providers.readiness : [])
      setRuntimeName(typeof providers?.runtimeName === 'string' ? providers.runtimeName : null)
      setStored(Array.isArray(secrets?.stored) ? secrets.stored : [])
      setSecretNames(secrets?.secrets && typeof secrets.secrets === 'object' ? secrets.secrets : {})
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Settings could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Surface a failed write instead of silently reloading to a stale row.
  async function mutate(id: string, run: () => Promise<Response>): Promise<boolean> {
    if (mutationPending.current || loading || loadError) return false
    mutationPending.current = true
    setBusy(id)
    setError(null)
    try {
      const res = await run()
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        setError(body?.error ? `${id}: ${body.error}` : `${id}: request failed (${res.status})`)
        return false
      }
      await load()
      return true
    } catch (err) {
      setError(`${id}: ${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      mutationPending.current = false
      setBusy(null)
    }
  }

  const save = async (id: string) => {
    const apiKey = (drafts[id] ?? '').trim()
    if (!apiKey) return
    const saved = await mutate(id, () => fetch('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: id, apiKey }),
    }))
    if (saved) setDrafts(d => ({ ...d, [id]: '' }))
  }

  const clear = (id: string) =>
    mutate(id, () => fetch(`/api/secrets?provider=${encodeURIComponent(id)}`, { method: 'DELETE' }))

  const removeSecret = (provider: string, name: string) =>
    mutate(`${provider}.${name}`, () =>
      fetch(`/api/secrets?provider=${encodeURIComponent(provider)}&name=${encodeURIComponent(name)}`, { method: 'DELETE' }))

  const addSecret = async () => {
    const provider = addDraft.provider.trim()
    const name = addDraft.name.trim()
    const value = addDraft.value.trim()
    if (!provider || !name || !value) return
    const saved = await mutate(`${provider}.${name}`, () => fetch('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, name, value }),
    }))
    if (saved) setAddDraft({ provider: '', name: '', value: '' })
  }

  if (loading) {
    return (
      <div className="space-y-bakin-3 max-w-2xl">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (loadError) return <SystemState kind="error" scope="section" title="Integrations could not be loaded"
    description={loadError} action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} />

  const secrets = Object.entries(secretNames).sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([provider, names]) => [...names].sort().map(name => ({ provider, name })))
  const columns: ReadonlyArray<DataTableColumn<{ provider: string; name: string }>> = [
    { key: 'provider', header: 'Integration', narrow: 'meta', cellClassName: 'whitespace-normal break-all', cell: row => row.provider },
    { key: 'name', header: 'Secret', narrow: 'primary', cellClassName: 'whitespace-normal break-all', cell: row => row.name },
    { key: 'actions', header: 'Actions', narrow: 'trailing', align: 'end', cell: row => (
      <Button variant="ghost" size="xs" aria-label={`Remove ${row.provider} ${row.name}`} disabled={busy !== null}
        onClick={() => void removeSecret(row.provider, row.name)}>Remove</Button>
    ) },
  ]

  return (
    <div className="space-y-bakin-3 max-w-2xl">
      {error && (
        <Alert tone="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p className="text-sm text-bakin-text-muted">
        Runtime-managed providers are configured in {runtimeLabel} and shown here read-only. Bakin keys are
        used only when the runtime can&apos;t serve a route; an environment variable always overrides a stored key.
      </p>
      {rows.length === 0 && (
        <p className="text-sm text-bakin-text-muted">No image providers are available yet.</p>
      )}
      <ListRows aria-label="Image provider settings" variant="separated">
      {rows.map(row => {
        const storeable = (row.source ?? '').startsWith('native')
        const envSet = (row.configuredEnvVars?.length ?? 0) > 0
        const isStored = stored.includes(row.id)
        const badge = badgeFor(row.servedBy)
        const detail = row.servedBy === 'runtime'
          ? `Configured in ${runtimeLabel}.`
          : envSet
            ? `Set via env: ${row.configuredEnvVars!.join(', ')} — overrides any stored key.`
            : isStored
              ? 'Using a key stored in Bakin.'
              : storeable
                ? 'No key configured.'
                : `Managed by the runtime — configure it in ${runtimeLabel}.`
        return (
          <ListRow key={row.id}>
            <Inline align="center" justify="between">
              <span className="text-sm font-bakin-typography-weight-medium">{row.label}</span>
              <StatusBadge size="xs" tone={badge.tone} variant={badge.variant}>{badge.label}</StatusBadge>
            </Inline>
            <p className="text-xs text-bakin-text-muted">{detail}</p>
            {storeable && !envSet && (
              <Inline>
                <Field name={`${row.id}-api-key`} className="min-w-0 flex-1">
                  <FieldLabel className="sr-only">{row.label} API key</FieldLabel>
                  <Input
                    type="password"
                    disabled={busy !== null}
                    placeholder={isStored ? 'Replace stored key…' : 'Enter API key…'}
                    value={drafts[row.id] ?? ''}
                    onChange={e => setDrafts(d => ({ ...d, [row.id]: e.target.value }))}
                  />
                </Field>
                <Button size="sm" disabled={busy !== null || !(drafts[row.id] ?? '').trim()} onClick={() => save(row.id)}>
                  Save
                </Button>
                {isStored && (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => clear(row.id)}>
                    Clear
                  </Button>
                )}
              </Inline>
            )}
          </ListRow>
        )
      })}
      </ListRows>

      <div className="pt-bakin-4 space-y-bakin-2">
        <h3 className="text-sm font-bakin-typography-weight-medium">Integration secrets</h3>
        <p className="text-xs text-bakin-text-muted">
          Named secrets used by installed capabilities and integrations (e.g. a search API key or a bot
          token). Values are write-only — they never leave the server. An environment variable with the
          matching name always overrides a stored value.
        </p>
        {secrets.length > 0 ? <DataTable label="Integration secrets" columns={columns} rows={secrets}
          rowKey={row => JSON.stringify([row.provider, row.name])} collapseBelow="xl" listVariant="separated" />
          : <p className="text-sm text-bakin-text-muted">No named secrets stored.</p>}
        <Form aria-label="Add integration secret" onSubmit={event => { event.preventDefault(); void addSecret() }}>
        <Grid layout="thirds" gap="item">
          <Field name="secret-provider" className="min-w-0 flex-1">
            <FieldLabel>Integration</FieldLabel>
            <Input
              disabled={busy !== null}
              placeholder="integration (e.g. brave)"
              value={addDraft.provider}
              onChange={e => setAddDraft(d => ({ ...d, provider: e.target.value }))}
            />
          </Field>
          <Field name="secret-name" className="min-w-0 flex-1">
            <FieldLabel>Secret name</FieldLabel>
            <Input
              disabled={busy !== null}
              placeholder="secret name (e.g. apiKey)"
              value={addDraft.name}
              onChange={e => setAddDraft(d => ({ ...d, name: e.target.value }))}
            />
          </Field>
          <Field name="secret-value" className="min-w-0 flex-1">
            <FieldLabel>Value</FieldLabel>
            <Input
              disabled={busy !== null}
              type="password"
              placeholder="value"
              value={addDraft.value}
              onChange={e => setAddDraft(d => ({ ...d, value: e.target.value }))}
            />
          </Field>
        </Grid>
        <FormActions>
          <Button type="submit"
            size="sm"
            disabled={busy !== null || !addDraft.provider.trim() || !addDraft.name.trim() || !addDraft.value.trim()}
          >
            Add secret
          </Button>
        </FormActions>
        </Form>
      </div>
    </div>
  )
}
