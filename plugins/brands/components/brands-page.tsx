/**
 * Branding list page (UX cleanup spec §5): PluginHeader with search + ONE
 * "New Brand" action → three-path chooser (build / from-website / import);
 * cover-art brand cards with completeness; the empty state IS the chooser.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Grid } from '@makinbakin/sdk/layout'
import { useQueryState, useRouter } from '@makinbakin/sdk/navigation'
import { Page, PageBody, PageHeader, SearchInput } from '@makinbakin/sdk/patterns'
import { Badge, Banner, Button, Skeleton, SystemState } from '@makinbakin/sdk/ui'
import { pluginFetch } from '@makinbakin/sdk/utils'
import { BrandBuilder } from './brand-builder'
import { BrandCoverCard, type ListedBrand } from './brand-card'
import { CreatePathCards, FromWebsiteDialog, ImportBrandDialog, NewBrandChooser, type CreatePath } from './new-brand-flows'

interface ListResponse {
  brands: ListedBrand[]
  invalid: Array<{ id: string; error: string }>
}

export function BrandsPage() {
  const router = useRouter()
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // URL-backed filter state (CLAUDE.md) — the search survives reloads and deep-links.
  const [query, setQuery] = useQueryState('q', '')
  const [chooserOpen, setChooserOpen] = useState(false)
  const [activeFlow, setActiveFlow] = useState<CreatePath | null>(null)

  // Courtesy redirect for pre-path-routing history: /brands?brand=<id> used to
  // BE the detail page — send those straight to the route instead of silently
  // showing the list.
  useEffect(() => {
    const legacy = new URLSearchParams(window.location.search).get('brand')
    if (legacy) router.replace(`/brands/${encodeURIComponent(legacy)}`)
  }, [router])

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
    (brandId: string, taskId?: string) => {
      // Straight to the new brand (the drafting banner links the dispatched
      // task); the list refetches on its own next mount — no refresh here.
      const path = `/brands/${encodeURIComponent(brandId)}`
      router.push(taskId ? `${path}?draftTask=${encodeURIComponent(taskId)}` : path)
    },
    [router],
  )

  const empty = data !== null && data.brands.length === 0
  const loading = data === null && !error
  const invalidFeedback = data && data.invalid.length > 0 ? (
    <Banner
      tone="danger"
      title="Some brand records could not be loaded"
      description={(
        <>
          {data.invalid.map((brand) => (
            <span key={brand.id} className="block">
              {brand.id}: {brand.error}
            </span>
          ))}
        </>
      )}
    />
  ) : undefined

  const resultState = error ? (
    <SystemState
      kind="error"
      title="Brands could not be loaded"
      description={error}
      action={<Button variant="outline" onClick={() => void refresh()}>Try again</Button>}
    />
  ) : loading ? (
    <SystemState
      kind="loading"
      title="Loading brands"
      description="Your brand kits will appear here when they are ready."
      preview={(
        <Grid layout="split" gap="item" data-brands-loading>
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-56 rounded-bakin-surface" />
          ))}
        </Grid>
      )}
    />
  ) : empty ? (
    <div className="mx-auto w-full max-w-2xl space-y-bakin-6 py-bakin-8" data-brands-empty>
      <SystemState
        kind="initial-empty"
        title="Give your agents a brand kit"
        description="Colors, voice, logos, and rules keep everything they make on-brand. Pick a way to start."
      />
      <CreatePathCards size="tile" onPick={startFlow} />
    </div>
  ) : visible.length === 0 ? (
    <SystemState
      kind="no-results"
      scope="page"
      title="No brands match your search"
      description="Clear the current search to return to every brand kit."
      action={<Button variant="outline" onClick={() => setQuery('')}>Clear search</Button>}
    />
  ) : undefined

  return (
    <Page>
      <PageHeader
        title="Branding"
        description="Define the voice, visual identity, rules, and references agents use to keep every output on-brand."
        meta={data ? <Badge size="xs" variant="outline">{visible.length} shown</Badge> : undefined}
        controlsLabel="Brand search"
        controls={(
          <SearchInput
            align="end"
            label="Brand search"
            value={query}
            onValueChange={setQuery}
            placeholder="Search brands…"
            mobileFullWidth
          />
        )}
        actionsLabel="Brand actions"
        actions={
          <Button onClick={() => setChooserOpen(true)} data-new-brand>
            <Plus /> New Brand
          </Button>
        }
      />

      <NewBrandChooser open={chooserOpen} onOpenChange={setChooserOpen} onPick={startFlow} />
      <BrandBuilder open={activeFlow === 'build'} onOpenChange={(o) => !o && setActiveFlow(null)} onCreated={flowDone} />
      <FromWebsiteDialog open={activeFlow === 'website'} onOpenChange={(o) => !o && setActiveFlow(null)} onCreated={flowDone} />
      <ImportBrandDialog open={activeFlow === 'import'} onOpenChange={(o) => !o && setActiveFlow(null)} onImported={flowDone} />

      <PageBody
        label="Brand results"
        feedback={invalidFeedback}
        state={resultState}
      >
        {data !== null && !empty ? (
          <Grid layout="split" gap="item">
            {visible.map((brand) => (
              <BrandCoverCard key={brand.id} brand={brand} />
            ))}
          </Grid>
        ) : null}
      </PageBody>
    </Page>
  )
}
