/**
 * Brands page — minimal T0.3 shell (list + create). The full manage surface
 * (palette/rules editors, pickers, card-size preview, import flow) lands in
 * Phase 6; this proves the plugin end-to-end in the browser.
 */
import { useCallback, useEffect, useState } from 'react'
import { PluginHeader } from '@makinbakin/sdk/components'
import type { BrandManifest } from '../types'

interface ListResponse {
  brands: BrandManifest[]
  invalid: Array<{ id: string; error: string }>
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)

export function BrandsPage() {
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/brands/')
      if (!res.ok) throw new Error(`list failed: ${res.status}`)
      setData((await res.json()) as ListResponse)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch('/api/plugins/brands/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: slugify(name), name }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `create failed: ${res.status}`)
      }
      setNewName('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }, [newName, refresh])

  return (
    <div className="flex flex-col gap-4 p-4">
      <PluginHeader title="Brands" count={data?.brands.length ?? 0} />

      <div className="flex items-center gap-2">
        <input
          className="w-64 rounded-md border bg-background px-3 py-1.5 text-sm"
          placeholder="New brand name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
          }}
        />
        <button
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          disabled={creating || !newName.trim()}
          onClick={() => void create()}
        >
          Create brand
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && data.invalid.length > 0 && (
        <div className="rounded-md border border-destructive/50 p-3 text-sm">
          <p className="font-medium text-destructive">Invalid brand records</p>
          {data.invalid.map((b) => (
            <p key={b.id} className="text-muted-foreground">
              {b.id}: {b.error}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.brands.map((brand) => (
          <div key={brand.id} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{brand.name}</h3>
              {brand.draft && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">draft</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{brand.id}</p>
            {brand.description && <p className="mt-2 text-sm">{brand.description}</p>}
            {brand.palette.length > 0 && (
              <div className="mt-2 flex gap-1">
                {brand.palette.slice(0, 8).map((c) => (
                  <span
                    key={c.name}
                    title={`${c.name} ${c.hex}`}
                    className="h-4 w-4 rounded-full border"
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {data && data.brands.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No brands yet. Create one to give your agents a source of truth for voice, palette, and
            reference assets.
          </p>
        )}
      </div>
    </div>
  )
}
