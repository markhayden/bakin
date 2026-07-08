/**
 * Brands page — minimal T0.3 shell (list + create). The full manage surface
 * (palette/rules editors, pickers, card-size preview, import flow) lands in
 * Phase 6; this proves the plugin end-to-end in the browser.
 */
import { useCallback, useEffect, useState } from 'react'
import { PluginHeader } from '@makinbakin/sdk/components'
import { useQueryState } from '@makinbakin/sdk/hooks'
import type { BrandManifest } from '../types'
import { BrandDetail } from './brand-detail'

type ListedBrand = BrandManifest & { counts?: { guidelines: number; lessons: number; assets: number } }

interface ListResponse {
  brands: ListedBrand[]
  invalid: Array<{ id: string; error: string }>
}

interface ImportPreview {
  id: string
  name: string
  description?: string
  palette: Array<{ name: string; hex: string }>
  rules: number
  guidelines: number
  lessons: number
  assets: number
  exists: boolean
  commit?: string
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)

export function BrandsPage() {
  const [selectedBrand, setSelectedBrand] = useQueryState('brand', '')
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importSource, setImportSource] = useState('')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

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

  if (selectedBrand) {
    return <BrandDetail brandId={selectedBrand} onBack={() => { setSelectedBrand(''); void refresh() }} />
  }

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
        <button
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          onClick={() => { setImportOpen((v) => !v); setImportPreview(null); setImportError(null) }}
        >
          Import…
        </button>
      </div>

      {importOpen && (
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="w-96 rounded-md border bg-background px-3 py-1.5 text-sm"
              placeholder="github:user/repo, github:user/repo/path, or a local directory"
              value={importSource}
              onChange={(e) => { setImportSource(e.target.value); setImportPreview(null) }}
            />
            <button
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              disabled={importBusy || !importSource.trim()}
              onClick={async () => {
                setImportBusy(true)
                setImportError(null)
                try {
                  const res = await fetch('/api/plugins/brands/import/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source: importSource.trim() }),
                  })
                  const body = (await res.json()) as { preview?: ImportPreview; error?: string }
                  if (!res.ok || !body.preview) throw new Error(body.error ?? `preview failed: ${res.status}`)
                  setImportPreview(body.preview)
                } catch (err) {
                  setImportError(err instanceof Error ? err.message : String(err))
                } finally {
                  setImportBusy(false)
                }
              }}
            >
              {importBusy && !importPreview ? 'Fetching…' : 'Preview'}
            </button>
          </div>

          {importError && <p className="text-sm text-destructive">{importError}</p>}

          {importPreview && (
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{importPreview.name}</span>
                <span className="text-xs text-muted-foreground">({importPreview.id})</span>
                {importPreview.exists && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-400">
                    replaces existing brand
                  </span>
                )}
              </div>
              {importPreview.palette.length > 0 && (
                <div className="flex gap-1">
                  {importPreview.palette.slice(0, 8).map((c) => (
                    <span key={c.name} title={`${c.name} ${c.hex}`} className="h-4 w-4 rounded-full border" style={{ backgroundColor: c.hex }} />
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {importPreview.rules} rule(s) · {importPreview.guidelines} guideline doc(s) · {importPreview.lessons} lesson(s) · {importPreview.assets} asset file(s)
                {importPreview.commit ? ` · ${importPreview.commit.slice(0, 8)}` : ''}
              </p>
              <button
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                disabled={importBusy}
                onClick={async () => {
                  setImportBusy(true)
                  setImportError(null)
                  try {
                    const res = await fetch('/api/plugins/brands/import', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ source: importSource.trim(), overwrite: importPreview.exists }),
                    })
                    if (!res.ok) {
                      const body = (await res.json().catch(() => ({}))) as { error?: string }
                      throw new Error(body.error ?? `import failed: ${res.status}`)
                    }
                    setImportOpen(false)
                    setImportSource('')
                    setImportPreview(null)
                    await refresh()
                  } catch (err) {
                    setImportError(err instanceof Error ? err.message : String(err))
                  } finally {
                    setImportBusy(false)
                  }
                }}
              >
                {importBusy ? 'Importing…' : importPreview.exists ? 'Replace + import' : 'Import'}
              </button>
            </div>
          )}
        </div>
      )}

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
          <div
            key={brand.id}
            className="rounded-lg border p-4 cursor-pointer hover:border-zinc-600"
            onClick={() => setSelectedBrand(brand.id)}
          >
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
            {brand.counts && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {brand.counts.guidelines} doc(s) · {brand.counts.lessons} lesson(s) · {brand.counts.assets} asset(s)
                {brand.source ? ` · from ${brand.source.repo}` : ''}
              </p>
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
