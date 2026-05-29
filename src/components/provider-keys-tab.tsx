/**
 * Provider Keys settings tab (image-scoped).
 *
 * Shows where each image provider's credential comes from — runtime (OpenClaw),
 * a Bakin env override, the Bakin secret store, or nothing — and lets you
 * manage the Bakin-owned store key (write-only). Runtime- and env-sourced rows
 * are read-only status. Status comes from the images plugin's /providers
 * readiness; store edits go through /api/secrets.
 *
 * The broader, all-domains credential inventory is tracked in GitHub #378; this
 * tab is intentionally image-scoped for now.
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
  const [stored, setStored] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [providers, secrets] = await Promise.all([
        fetch('/api/plugins/images/providers').then(r => r.json()).catch(() => ({})),
        fetch('/api/secrets').then(r => r.json()).catch(() => ({ stored: [] })),
      ])
      setRows(Array.isArray(providers?.readiness) ? providers.readiness : [])
      setStored(Array.isArray(secrets?.stored) ? secrets.stored : [])
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

  if (loading) {
    return (
      <div className="space-y-3 max-w-2xl">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No image providers are available yet.</p>
  }

  return (
    <div className="space-y-3 max-w-2xl">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Runtime-managed providers are configured in OpenClaw and shown here read-only. Bakin keys are
        used only when the runtime can&apos;t serve a route; an environment variable always overrides a stored key.
      </p>
      {rows.map(row => {
        const storeable = (row.source ?? '').startsWith('native')
        const envSet = (row.configuredEnvVars?.length ?? 0) > 0
        const isStored = stored.includes(row.id)
        const badge = badgeFor(row.servedBy)
        const detail = row.servedBy === 'runtime'
          ? 'Configured in the runtime (OpenClaw).'
          : envSet
            ? `Set via env: ${row.configuredEnvVars!.join(', ')} — overrides any stored key.`
            : isStored
              ? 'Using a key stored in Bakin.'
              : storeable
                ? 'No key configured.'
                : 'Managed by the runtime — configure it in OpenClaw.'
        return (
          <div key={row.id} className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{row.label}</span>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{detail}</p>
            {storeable && !envSet && (
              <div className="flex items-center gap-2">
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
    </div>
  )
}
