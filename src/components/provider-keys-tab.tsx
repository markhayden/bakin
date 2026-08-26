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
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

export const PROVIDER_KEYS_TAB_ID = '__provider_keys__'

interface ReadinessRow {
  id: string
  label: string
  servedBy?: 'runtime' | 'shim' | 'unconfigured'
  source?: 'native' | 'runtime' | 'native+runtime'
  configuredEnvVars?: string[]
}

function badgeFor(servedBy: ReadinessRow['servedBy']): { label: string; variant: 'default' | 'secondary' | 'outline' } {
  if (servedBy === 'runtime') return { label: 'Runtime', variant: 'default' }
  if (servedBy === 'shim') return { label: 'Bakin key', variant: 'secondary' }
  return { label: 'Not set', variant: 'outline' }
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
  // Adapter identity from the providers payload — copy never hardcodes one.
  const runtimeLabel = runtimeName ? `the runtime (${runtimeName})` : 'the runtime'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [providers, secrets] = await Promise.all([
        fetch('/api/plugins/images/providers').then(r => r.json()).catch(() => ({})),
        fetch('/api/secrets').then(r => r.json()).catch(() => ({ stored: [] })),
      ])
      setRows(Array.isArray(providers?.readiness) ? providers.readiness : [])
      setRuntimeName(typeof providers?.runtimeName === 'string' ? providers.runtimeName : null)
      setStored(Array.isArray(secrets?.stored) ? secrets.stored : [])
      setSecretNames(secrets?.secrets && typeof secrets.secrets === 'object' ? secrets.secrets : {})
      setError(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Surface a failed write instead of silently reloading to a stale row.
  async function mutate(id: string, run: () => Promise<Response>): Promise<void> {
    setBusy(id)
    setError(null)
    try {
      const res = await run()
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        setError(body?.error ? `${id}: ${body.error}` : `${id}: request failed (${res.status})`)
        return
      }
      await load()
    } catch (err) {
      setError(`${id}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const save = async (id: string) => {
    const apiKey = (drafts[id] ?? '').trim()
    if (!apiKey) return
    await mutate(id, () => fetch('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: id, apiKey }),
    }))
    setDrafts(d => ({ ...d, [id]: '' }))
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
    await mutate(`${provider}.${name}`, () => fetch('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, name, value }),
    }))
    setAddDraft({ provider: '', name: '', value: '' })
  }

  if (loading) {
    return (
      <div className="space-y-bakin-3 max-w-2xl">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-bakin-3 max-w-2xl">
      {error && (
        <p role="alert" className="rounded-md border border-bakin-signal-danger/40 bg-bakin-signal-danger/10 px-bakin-3 py-bakin-2 text-sm text-bakin-signal-danger">
          {error}
        </p>
      )}
      <p className="text-sm text-bakin-text-muted">
        Runtime-managed providers are configured in {runtimeLabel} and shown here read-only. Bakin keys are
        used only when the runtime can&apos;t serve a route; an environment variable always overrides a stored key.
      </p>
      {rows.length === 0 && (
        <p className="text-sm text-bakin-text-muted">No image providers are available yet.</p>
      )}
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
          <div key={row.id} className="flex flex-col gap-bakin-2 rounded-md border p-bakin-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bakin-typography-weight-medium">{row.label}</span>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            <p className="text-xs text-bakin-text-muted">{detail}</p>
            {storeable && !envSet && (
              <div className="flex items-center gap-bakin-2">
                <Input
                  type="password"
                  placeholder={isStored ? 'Replace stored key…' : 'Enter API key…'}
                  value={drafts[row.id] ?? ''}
                  onChange={e => setDrafts(d => ({ ...d, [row.id]: e.target.value }))}
                />
                <Button size="sm" disabled={busy === row.id || !(drafts[row.id] ?? '').trim()} onClick={() => save(row.id)}>
                  Save
                </Button>
                {isStored && (
                  <Button size="sm" variant="outline" disabled={busy === row.id} onClick={() => clear(row.id)}>
                    Clear
                  </Button>
                )}
              </div>
            )}
          </div>
        )
      })}

      <div className="pt-bakin-4 space-y-bakin-2">
        <h3 className="text-sm font-bakin-typography-weight-medium">Integration secrets</h3>
        <p className="text-xs text-bakin-text-muted">
          Named secrets used by installed capabilities and integrations (e.g. a search API key or a bot
          token). Values are write-only — they never leave the server. An environment variable with the
          matching name always overrides a stored value.
        </p>
        {Object.entries(secretNames).sort(([a], [b]) => a.localeCompare(b)).map(([provider, names]) => (
          <div key={provider} className="flex flex-col gap-bakin-2 rounded-md border p-bakin-3">
            <span className="text-sm font-bakin-typography-weight-medium">{provider}</span>
            <div className="flex flex-wrap items-center gap-bakin-2">
              {names.map(name => (
                <span key={name} className="inline-flex items-center gap-bakin-1 rounded-md border px-bakin-2 py-0.5 text-xs">
                  {name}
                  <button
                    type="button"
                    aria-label={`Remove ${provider} ${name}`}
                    className="text-bakin-text-muted hover:text-bakin-signal-danger"
                    disabled={busy === `${provider}.${name}`}
                    onClick={() => removeSecret(provider, name)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-bakin-2">
          <Input
            placeholder="integration (e.g. brave)"
            value={addDraft.provider}
            onChange={e => setAddDraft(d => ({ ...d, provider: e.target.value }))}
          />
          <Input
            placeholder="secret name (e.g. apiKey)"
            value={addDraft.name}
            onChange={e => setAddDraft(d => ({ ...d, name: e.target.value }))}
          />
          <Input
            type="password"
            placeholder="value"
            value={addDraft.value}
            onChange={e => setAddDraft(d => ({ ...d, value: e.target.value }))}
          />
          <Button
            size="sm"
            disabled={!addDraft.provider.trim() || !addDraft.name.trim() || !addDraft.value.trim()}
            onClick={() => void addSecret()}
          >
            Add secret
          </Button>
        </div>
      </div>
    </div>
  )
}
