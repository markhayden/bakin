/**
 * Branding list page (UX cleanup spec §5): PluginHeader with search + ONE
 * "New Brand" action → three-path chooser (build / from-website / import);
 * cover-art brand cards with completeness; the empty state IS the chooser.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Paintbrush, Plus } from 'lucide-react'
import { PluginHeader, EmptyState } from '@makinbakin/sdk/components'
import { Button, Skeleton } from '@makinbakin/sdk/ui'
import { pluginFetch } from '@makinbakin/sdk/utils'
import { BrandBuilder } from './brand-builder'
import { BrandCoverCard, type ListedBrand } from './brand-card'
import { CreatePathCards, FromWebsiteDialog, ImportBrandDialog, NewBrandChooser, type CreatePath } from './new-brand-flows'

interface ListResponse {
  brands: ListedBrand[]
  invalid: Array<{ id: string; error: string }>
}

export function BrandsPage() {
  const navigate = useNavigate()
  const openBrand = useCallback(
    (brandId: string) => void navigate({ to: '/brands/$brandId', params: { brandId } }),
    [navigate],
  )
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [chooserOpen, setChooserOpen] = useState(false)
  const [activeFlow, setActiveFlow] = useState<CreatePath | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await pluginFetch('brands', '/')
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

  const visible = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    const matches = q
      ? data.brands.filter(
          (b) =>
            b.name.toLowerCase().includes(q) ||
            b.id.toLowerCase().includes(q) ||
            (b.description ?? '').toLowerCase().includes(q),
        )
      : data.brands
    // Drafts first (they need attention), then most recently updated.
    return [...matches].sort((a, b) => {
      if (Boolean(a.draft) !== Boolean(b.draft)) return a.draft ? -1 : 1
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
    })
  }, [data, query])

  const startFlow = useCallback((path: CreatePath) => setActiveFlow(path), [])
  const flowDone = useCallback(
    (brandId: string) => {
      void refresh()
      openBrand(brandId)
    },
    [refresh, openBrand],
  )

  const empty = data !== null && data.brands.length === 0

  return (
    <div className="flex flex-col gap-4 p-4">
      <PluginHeader
        title="Branding"
        count={data?.brands.length ?? 0}
        search={{ value: query, onChange: setQuery, placeholder: 'Search brands...' }}
        actions={
          <Button onClick={() => setChooserOpen(true)} data-new-brand>
            <Plus className="size-4" /> New Brand
          </Button>
        }
      />

      <NewBrandChooser open={chooserOpen} onOpenChange={setChooserOpen} onPick={startFlow} />
      <BrandBuilder open={activeFlow === 'build'} onOpenChange={(o) => !o && setActiveFlow(null)} onCreated={flowDone} />
      <FromWebsiteDialog open={activeFlow === 'website'} onOpenChange={(o) => !o && setActiveFlow(null)} onCreated={flowDone} />
      <ImportBrandDialog open={activeFlow === 'import'} onOpenChange={(o) => !o && setActiveFlow(null)} onImported={flowDone} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && data.invalid.length > 0 && (
        <div className="rounded-lg bg-destructive/5 p-3 text-sm ring-1 ring-destructive/40">
          <p className="font-medium text-destructive">Invalid brand records</p>
          {data.invalid.map((b) => (
            <p key={b.id} className="text-muted-foreground">
              {b.id}: {b.error}
            </p>
          ))}
        </div>
      )}

      {/* Loading: skeleton cards, never a blank pane. */}
      {data === null && !error && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-brands-loading>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      )}

      {/* First run: the empty state IS the chooser. */}
      {empty && (
        <div className="mx-auto w-full max-w-2xl space-y-6 py-10" data-brands-empty>
          <EmptyState
            variant="panel"
            icon={Paintbrush}
            title="Give your agents a brand kit"
            description="Colors, voice, logos, and rules — so everything they make stays on-brand. Pick a way to start:"
          />
          <CreatePathCards size="tile" onPick={startFlow} />
        </div>
      )}

      {data !== null && !empty && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {visible.map((brand) => (
              <BrandCoverCard key={brand.id} brand={brand} onOpen={() => openBrand(brand.id)} />
            ))}
          </div>
          {visible.length === 0 && (
            <EmptyState
              title="No brands match your search"
              description="Try a different word, or create a new brand."
            />
          )}
        </>
      )}
    </div>
  )
}
