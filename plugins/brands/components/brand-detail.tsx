/**
 * Brand detail — a brand paints its own page (#419, premium redesign).
 * Design language: .claude/specs/brands-ui-design.md.
 *
 * The chrome is calm and near-monochrome on Bakin's surface-elevation ladder
 * (no hard borders); the brand's OWN palette is the only strong color — a
 * proportioned hero band + ambient tint + swatch accents. Section tabs are
 * URL-backed (?tab=): Overview is a read-only dashboard, the rest are live
 * editors that round-trip through the manifest PUT / doc routes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownContent } from '@makinbakin/sdk/content'
import { Grid, Inline, Section, Stack } from '@makinbakin/sdk/layout'
import { useRouter, useUnsavedChangesGuard } from '@makinbakin/sdk/navigation'
import {
  ConfirmDialog,
  DangerZone,
  Page,
  PageBody,
  PageHeader,
  SaveBar,
  StatGroup,
  StatTile,
  StatusBadge,
  // AssetLibraryPicker is the app-aware data adapter (library fetch +
  // upload) — the presentation-only AssetPicker composed with the assets
  // plugin wiring, promoted from the frozen barrel in the kit-additions batch.
  AssetLibraryPicker,
  ColorInput,
} from '@makinbakin/sdk/patterns'
import {
  Banner, Button, Input, Textarea, Switch, Label, Skeleton, Progress, SystemState,
  Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Tabs, TabsList, TabsTrigger,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { useQueryState, usePluginEvent, toast } from '@makinbakin/sdk/hooks'
import {
  ArrowLeft, Palette, Rocket, Pencil, Plus, Check, AlertTriangle, ExternalLink,
  FileText, BookOpen, ImageIcon, Trash2, Sparkles, Info,
  File, Music, Play, Table2, Type,
} from 'lucide-react'
import type { BrandManifest, PaletteEntry, BrandDocInfo, BrandDetailResponse } from '../types'

type DocInfo = BrandDocInfo
type DetailResponse = BrandDetailResponse
type ManifestPatch = Partial<Omit<BrandManifest, 'id' | 'createdAt' | 'updatedAt'>>
type DocKind = 'guidelines' | 'lessons'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'identity', label: 'Identity' },
  { id: 'guidelines', label: 'Guidelines' },
  { id: 'lessons', label: 'Lessons' },
  { id: 'assets', label: 'Assets' },
  { id: 'settings', label: 'Settings' },
] as const

const isHex = (h: string) => /^#[0-9a-fA-F]{6}$/.test(h)
/** Frontmatter is machine metadata — previews render the body only. */
const stripFrontmatter = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n?/, '')
/** A page preview already has its own title hierarchy; omit a document's leading H1. */
const stripPreviewTitle = (md: string) => stripFrontmatter(md).replace(/^\s*#\s+[^\n]*(?:\n+|$)/, '')

/** Soft in-card empty for a section body — the kit's inline system state. */
function SectionEmpty({ children }: { children: React.ReactNode }) {
  return <SystemState kind="initial-empty" scope="inline" title={children} />
}

/**
 * The titled section card: icon + title, muted "why this matters" line, an
 * optional header action, and the body — composed from the kit's Card
 * primitives (the frozen-barrel SectionCard retired in the storybook refit).
 */
function SectionCard({
  title, icon: Icon, description, action, children, className, contentClassName,
}: {
  title: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <Card className={className} data-section-card>
      <CardHeader>
        <CardTitle className="flex items-center gap-bakin-2">
          {Icon && <Icon className="size-bakin-4 text-bakin-text-muted" />}
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={contentClassName ? `space-y-bakin-3 ${contentClassName}` : 'space-y-bakin-3'}>
        {children}
      </CardContent>
    </Card>
  )
}

/**
 * Preview container that fades long content into a solid bottom overlay with a
 * summary + call-to-action — a trailing ghost of faded text is unreadable AND
 * undiscoverable. The overlay renders when the content actually overflows
 * (ResizeObserver) or the caller knows there's more (`hasMore`).
 */
function FadeMore({
  summary, actionLabel, onAction, hasMore = false, className, children,
}: {
  summary?: string
  actionLabel: string
  onAction: () => void
  /** Caller-known "there is more than fits" hint — jsdom has no layout, and counts beat measurement when we have them. */
  hasMore?: boolean
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 4)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const showOverlay = overflowing || hasMore

  return (
    <div className="relative">
      <div ref={ref} className={`max-h-64 overflow-hidden ${showOverlay ? 'pb-bakin-8' : ''} ${className ?? ''}`}>
        {children}
      </div>
      {showOverlay && (
        <div
          className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-bakin-3 bg-gradient-to-t from-bakin-surface-default from-45% to-transparent px-bakin-1 pb-bakin-1 pt-20"
          data-fade-more
        >
          <span className="min-w-0 truncate pb-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">{summary}</span>
          <Button variant="outline" size="sm" className="shrink-0" onClick={onAction} data-fade-more-action>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  )
}
/** Placeholder hex for a freshly added palette row — a pristine row is dropped on save, not blocked. */
const BLANK_HEX = '#888888'

export function BrandDetail({ brandId, onBack }: { brandId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [tabParam, setTab] = useQueryState('tab', 'overview')
  const tab = TABS.some((t) => t.id === tabParam) ? tabParam : 'overview'

  // ONE staged draft spans every manifest-backed field across tabs (spec §7a):
  // edits mutate `staged`; the SaveBar commits the whole manifest in one PUT.
  const [staged, setStaged] = useState<BrandManifest | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  // The server updatedAt the draft was staged FROM — the freshness check that
  // stops a snapshot PUT from silently erasing concurrent writes (the drafting
  // agent authors via update_manifest while the user reviews).
  const stagedBaseRef = useRef<string | null>(null)
  const overwriteArmedRef = useRef(false)
  const dirty = staged !== null

  const [notFound, setNotFound] = useState(false)
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/brands/${brandId}`)
      if (res.status === 404) {
        setNotFound(true)
        return
      }
      if (!res.ok) throw new Error(`load failed: ${res.status}`)
      setDetail((await res.json()) as DetailResponse)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [brandId])

  useEffect(() => { void refresh() }, [refresh])

  // Live-fill: the drafting agent writes the manifest while the user watches —
  // refresh on brand.changed so tabs fill in without a reload. Staged edits
  // are untouched (b = staged ?? detail.brand); the save freshness gate owns
  // the conflict story.
  usePluginEvent('brand.changed', (payload) => {
    if ((payload as { brandId?: string }).brandId === brandId) void refresh()
  })

  const stage = useCallback(
    (patch: ManifestPatch) => {
      setStaged((prev) => {
        const base = prev ?? detail?.brand
        if (!base) return prev
        if (prev === null) {
          // First edit of this draft — remember what server version it's based on.
          stagedBaseRef.current = detail?.brand.updatedAt ?? null
          overwriteArmedRef.current = false
        }
        return { ...base, ...patch }
      })
    },
    [detail],
  )

  const discard = useCallback(() => {
    setStaged(null)
    setSaveError(null)
    stagedBaseRef.current = null
    overwriteArmedRef.current = false
  }, [])

  /** Drop rows the user added but never filled in; they're scaffolding, not intent. */
  const cleanStaged = (m: BrandManifest): BrandManifest => ({
    ...m,
    name: m.name.trim() || m.name,
    description: m.description?.trim() || undefined,
    palette: m.palette.filter((c) => c.name.trim() !== '' || (c.hex !== BLANK_HEX && c.hex.trim() !== '')),
    rules: (m.rules ?? []).filter((r) => r.trim() !== ''),
    terminology: (m.terminology ?? []).filter((t) => t.term.trim() !== '' || t.rule.trim() !== ''),
  })

  /** Returns true when the save landed — the navigation guard's save-and-exit needs the answer. */
  const save = useCallback(async (): Promise<boolean> => {
    if (!staged) return true
    // Snapshot NOW: edits staged while the PUT is in flight must survive the
    // post-save clear, not vanish with it.
    const snapshot = staged
    const cleaned = cleanStaged(snapshot)
    // Honest validation BEFORE the PUT — invalid rows hold the save.
    if (!cleaned.name.trim()) {
      setSaveError('The brand needs a name.')
      return false
    }
    if (cleaned.palette.some((c) => !isHex(c.hex) || !c.name.trim())) {
      setSaveError('Fix the highlighted colors first — every color needs a name and a hex value like #FF5A00.')
      return false
    }
    if ((cleaned.terminology ?? []).some((t) => !t.term.trim() || !t.rule.trim())) {
      setSaveError('Every terminology entry needs both the term and its rule.')
      return false
    }
    setSaving(true)
    setSaveError(null)
    try {
      // Freshness gate: this PUT replaces the WHOLE manifest, so a brand that
      // changed underneath (the drafting agent writing while the user reviews)
      // must not be silently erased. First mismatch blocks with an explanation;
      // saving again overwrites deliberately.
      if (!overwriteArmedRef.current && stagedBaseRef.current) {
        const freshRes = await fetch(`/api/plugins/brands/${brandId}`)
        if (freshRes.ok) {
          const fresh = (await freshRes.json()) as DetailResponse
          if (fresh.brand.updatedAt !== stagedBaseRef.current) {
            overwriteArmedRef.current = true
            setDetail(fresh)
            setSaveError(
              'This brand changed while you were editing — likely the drafting agent. Save again to overwrite the newer version, or Discard to see it.',
            )
            return false
          }
        }
      }
      // Identity, timestamps, AND publication state are server-owned — the
      // staged snapshot may carry a stale draft flag from before a publish.
      const { id: _id, createdAt: _c, updatedAt: _u, draft: _d, draftTaskId: _dt, ...body } = cleaned
      const res = await fetch(`/api/plugins/brands/${brandId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const resBody = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(resBody.error ?? `save failed: ${res.status}`)
      }
      const saved = (await res.json().catch(() => ({}))) as { brand?: { updatedAt?: string } }
      await refresh()
      // Clear ONLY if nothing new was staged during the round-trip — and when
      // edits DID survive, re-arm the freshness gate against the version this
      // save just produced (a null base would skip the gate on the next save).
      setStaged((prev) => {
        if (prev === snapshot) {
          stagedBaseRef.current = null
          return null
        }
        // Unparseable response keeps the OLD base — the gate then trips (safe
        // direction) instead of silently skipping.
        stagedBaseRef.current = saved.brand?.updatedAt ?? stagedBaseRef.current
        return prev
      })
      overwriteArmedRef.current = false
      return true
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      return false
    } finally { setSaving(false) }
  }, [staged, brandId, refresh])

  // In-app navigation guard: staged edits must never be silently dropped by a
  // route change (tab switches don't navigate — the draft spans them freely).
  const unsavedGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: dirty,
    saving,
    title: 'Unsaved brand changes',
    description: 'You have unsaved changes to this brand. Save them before leaving, discard them, or stay here.',
    saveLabel: 'Save brand',
    onSaveAndExit: save,
    onDiscardAndExit: discard,
  })

  /** Every doc opens in the dedicated editor route — never an inline swap (spec §7e). */
  const editDoc = useCallback(
    (kind: DocKind, name: string, create = false) => {
      const path = `/brands/${encodeURIComponent(brandId)}/docs/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`
      router.push(create ? `${path}?create=1` : path)
    },
    [router, brandId],
  )

  // Publishing gets a light confirm — it flips the switch agents act on.
  const [publishConfirm, setPublishConfirm] = useState(false)
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [logoPickerRequested, setLogoPickerRequested] = useState(false)
  const publish = useCallback(async () => {
    setPublishBusy(true)
    setPublishError(null)
    try {
      const res = await fetch(`/api/plugins/brands/${brandId}/publish`, { method: 'POST' })
      if (!res.ok) throw new Error(`publish failed: ${res.status}`)
      toast(`${detail?.brand.name ?? brandId} published — agents can use it now`, 'success')
      setPublishConfirm(false)
      await refresh()
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err))
    } finally {
      setPublishBusy(false)
    }
  }, [brandId, detail, refresh])

  if (notFound) {
    return (
      <Page data-brand-detail-not-found>
        <BrandStateHeader brandId={brandId} onBack={onBack} />
        <PageBody
          state={(
            <SystemState
              kind="initial-empty"
              scope="page"
              title="This brand doesn't exist"
              description="It may have been deleted, or the link is stale."
              action={<Button variant="outline" onClick={onBack}>Open brands</Button>}
            />
          )}
        />
      </Page>
    )
  }
  if (error && !detail) {
    return (
      <Page data-brand-detail-error>
        <BrandStateHeader brandId={brandId} onBack={onBack} />
        <PageBody
          state={(
            <SystemState
              kind="error"
              scope="page"
              recovery="available"
              title="Brand details couldn't load"
              description={error}
              action={<Button variant="outline" onClick={() => void refresh()}>Try again</Button>}
            />
          )}
        />
      </Page>
    )
  }
  if (!detail) {
    return (
      <Page data-brand-detail-loading>
        <BrandStateHeader brandId={brandId} onBack={onBack} />
        <PageBody
          state={(
            <SystemState
              kind="loading"
              scope="page"
              title="Loading brand"
              description="The brand identity, guidance, lessons, and assets will appear here."
              preview={(
                <Stack gap="item">
                  <Skeleton className="h-bakin-8 w-full max-w-lg" />
                  <Skeleton className="h-24 w-full rounded-bakin-surface" />
                </Stack>
              )}
            />
          )}
        />
      </Page>
    )
  }

  // Staged edits paint the page live (hero included) — what you see is what Save commits.
  const b = staged ?? detail.brand

  return (
    <Page data-brand-detail>
      <BrandPageHeader
        brand={b}
        onBack={onBack}
        onAddLogo={() => {
          setTab('assets')
          setLogoPickerRequested(true)
        }}
      />

      {b.draft && <DraftBanner brand={b} brandId={brandId} onPublish={() => setPublishConfirm(true)} />}

      <ConfirmDialog
        open={publishConfirm}
        title={`Publish ${b.name}?`}
        description="Agents start using this brand on linked tasks immediately — and any tasks waiting on it unblock."
        confirmLabel="Publish"
        busyLabel="Publishing..."
        busy={publishBusy}
        error={publishError}
        onConfirm={() => void publish()}
        onCancel={() => {
          if (!publishBusy) setPublishConfirm(false)
        }}
      />

      {error && (
        <Banner
          tone="danger"
          title="The latest brand data couldn't load"
          description={error}
          action={<Button variant="outline" size="sm" onClick={() => void refresh()}>Try again</Button>}
        />
      )}

      <Tabs value={tab} onValueChange={(id) => setTab(id as typeof tab)}>
        <TabsList variant="underline" activateOnFocus aria-label={`${b.name} sections`}>
          {TABS.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              id={`brand-detail-tab-${item.id}`}
              aria-controls={`brand-detail-panel-${item.id}`}
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <PageBody>
        <div
          id={`brand-detail-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`brand-detail-tab-${tab}`}
          className="flex min-w-0 flex-1 flex-col gap-bakin-6"
        >
          {tab === 'overview' && <OverviewTab brand={b} detail={detail} brandId={brandId} onGoTo={setTab} onEditDoc={editDoc} />}

      {tab === 'identity' && (
        <div className="grid gap-bakin-4 lg:grid-cols-2">
          <SectionCard
            className="lg:col-span-2"
            title="Name & description"
            icon={Sparkles}
            description="The first thing agents read about this brand — the description rides every branded task and image prompt."
          >
            <Input
              value={b.name}
              aria-label="Brand name"
              onChange={(e) => stage({ name: e.target.value })}
            />
            <Textarea
              rows={3}
              placeholder="One or two sentences on what this brand is and how it should come across."
              aria-label="Brand description"
              value={b.description ?? ''}
              onChange={(e) => stage({ description: e.target.value || undefined })}
            />
          </SectionCard>

          <SectionCard
            className="lg:col-span-2"
            title="Palette"
            icon={Palette}
            description="Agents pull these exact values into everything they generate — images, docs, UI. First color is the primary."
            action={
              <Button variant="outline" size="sm" onClick={() => stage({ palette: [...b.palette, { name: '', hex: BLANK_HEX }] })} data-add-color>
                <Plus className="size-bakin-3" /> Add color
              </Button>
            }
          >
            {b.palette.length === 0 && (
              <SectionEmpty>No colors yet — without a palette, image tools have no brand colors to follow.</SectionEmpty>
            )}
            {b.palette.map((c, i) => {
              const hexInvalid = c.hex.trim() !== '' && c.hex !== BLANK_HEX && !isHex(c.hex)
              const update = (next: PaletteEntry) => stage({ palette: b.palette.map((row, j) => (j === i ? next : row)) })
              return (
                <div key={i} data-palette-row={i}>
                  <div className="flex items-center gap-bakin-2">
                    {/* Swatch and hex field are two views of ONE value — either edits both. */}
                    <ColorInput
                      ariaLabel={`${c.name || 'color'} swatch`}
                      value={c.hex}
                      onValueChange={(hex) => update({ ...c, hex })}
                    />
                    <Input className="w-32" placeholder="Primary" aria-label="Color name" value={c.name} onChange={(e) => update({ ...c, name: e.target.value })} />
                    <Input
                      className={`w-28 font-bakin-typography-family-mono ${hexInvalid ? 'ring-1 ring-bakin-signal-danger' : ''}`}
                      aria-label="Hex value"
                      aria-invalid={hexInvalid || undefined}
                      value={c.hex}
                      onChange={(e) => update({ ...c, hex: e.target.value })}
                    />
                    <Input className="flex-1" placeholder="buttons, links, calls-to-action" aria-label="Where it's used" value={c.usage ?? ''} onChange={(e) => update({ ...c, usage: e.target.value || undefined })} />
                    <RemoveBtn onClick={() => stage({ palette: b.palette.filter((_, j) => j !== i) })} />
                  </div>
                  {hexInvalid && <p className="mt-bakin-1 pl-12 text-bakin-typography-size-meta text-bakin-signal-danger">Hex colors look like #FF5A00</p>}
                </div>
              )
            })}
          </SectionCard>

          <SectionCard
            title="Rules"
            icon={AlertTriangle}
            description="Hard do's and don'ts — injected into every branded task, never optional."
            action={
              <Button variant="outline" size="sm" onClick={() => stage({ rules: [...(b.rules ?? []), ''] })} data-add-rule>
                <Plus className="size-bakin-3" /> Add rule
              </Button>
            }
          >
            {(b.rules ?? []).length === 0 && <SectionEmpty>No rules yet — e.g. "Never use exclamation marks in headlines."</SectionEmpty>}
            {(b.rules ?? []).map((r, i) => (
              <div key={i} className="flex items-center gap-bakin-2">
                <Input className="flex-1" placeholder='e.g. "Never use emojis"' value={r} onChange={(e) => stage({ rules: (b.rules ?? []).map((row, j) => (j === i ? e.target.value : row)) })} />
                <RemoveBtn onClick={() => stage({ rules: (b.rules ?? []).filter((_, j) => j !== i) })} />
              </div>
            ))}
          </SectionCard>

          <SectionCard
            title="Terminology"
            icon={BookOpen}
            description="Say-this-not-that words agents must get right — product names, banned phrases."
            action={
              <Button variant="outline" size="sm" onClick={() => stage({ terminology: [...(b.terminology ?? []), { term: '', rule: '' }] })} data-add-term>
                <Plus className="size-bakin-3" /> Add term
              </Button>
            }
          >
            {(b.terminology ?? []).length === 0 && <SectionEmpty>Nothing yet — e.g. "workspace", never "dashboard".</SectionEmpty>}
            {(b.terminology ?? []).map((t, i) => (
              <div key={i} className="flex items-center gap-bakin-2">
                <Input className="w-56" placeholder="workspace" aria-label="Term" value={t.term} onChange={(e) => stage({ terminology: (b.terminology ?? []).map((row, j) => (j === i ? { ...row, term: e.target.value } : row)) })} />
                <Input className="flex-1" placeholder='never "dashboard"' aria-label="Rule" value={t.rule} onChange={(e) => stage({ terminology: (b.terminology ?? []).map((row, j) => (j === i ? { ...row, rule: e.target.value } : row)) })} />
                <RemoveBtn onClick={() => stage({ terminology: (b.terminology ?? []).filter((_, j) => j !== i) })} />
              </div>
            ))}
          </SectionCard>
        </div>
      )}

      {(tab === 'guidelines' || tab === 'lessons') && (
        <DocsEditor
          kind={tab}
          docs={tab === 'guidelines' ? detail.guidelines : detail.lessons}
          brand={b}
          brandId={brandId}
          guidelines={detail.guidelines}
          onEditDoc={editDoc}
          onDeleted={() => void refresh()}
          onToggleCardDoc={(name, on) => {
            const current = b.cardDocs ?? (detail.guidelines.some((g) => g.name === 'voice.md') ? ['voice.md'] : [])
            stage({ cardDocs: on ? [...current, name] : current.filter((n) => n !== name) })
          }}
          onToggleLesson={(name, active) => {
            const current = b.disabledLessons ?? []
            stage({ disabledLessons: active ? current.filter((n) => n !== name) : [...current, name] })
          }}
        />
      )}

      {tab === 'assets' && (
        <BrandAssetsSection
          brand={b}
          onSave={stage}
          logoPickerRequested={logoPickerRequested}
          onLogoPickerRequestHandled={() => setLogoPickerRequested(false)}
        />
      )}

      {tab === 'settings' && (
        <BrandSettingsTab
          brand={b}
          brandId={brandId}
          onPublish={() => setPublishConfirm(true)}
          // Explicit list navigation — history-back would land on the brand we
          // just deleted. Discard FIRST and let the guard's effect unregister
          // before navigating, or the unsaved-changes dialog blocks the exit
          // and offers to Save to a brand that no longer exists.
          onDeleted={() => {
            discard()
            setTimeout(() => router.push('/brands'), 0)
          }}
          onChanged={() => void refresh()}
        />
      )}
        </div>
      </PageBody>

      {/* ONE save path for the whole manifest — appears whenever anything is staged. */}
      <SaveBar
        dirty={dirty}
        saving={saving}
        error={saveError}
        saveLabel="Save brand"
        onSave={() => void save()}
        onDiscard={discard}
      />
      {unsavedGuard.dialog}
    </Page>
  )
}

// ─── Shared shells ────────────────────────────────────────────────────────────

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="shrink-0 text-bakin-text-muted hover:text-bakin-signal-danger"
      onClick={onClick}
      aria-label="Remove"
    >
      <Trash2 className="size-bakin-3" />
    </Button>
  )
}

// ─── Shared detail identity ───────────────────────────────────────────────────

function BrandBackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="rounded-bakin-pill"
      onClick={onBack}
      aria-label="Back to brands"
    >
      <ArrowLeft />
    </Button>
  )
}

function BrandStateHeader({ brandId, onBack }: { brandId: string; onBack: () => void }) {
  return (
    <PageHeader
      measure="wide"
      navigation={<BrandBackButton onBack={onBack} />}
      eyebrow="Branding / Detail"
      title="Brand detail"
      meta={<code className="font-bakin-typography-family-mono">{brandId}</code>}
    />
  )
}

function BrandPageHeader({
  brand,
  onAddLogo,
  onBack,
}: {
  brand: BrandManifest
  onAddLogo: () => void
  onBack: () => void
}) {
  const colors = brand.palette.filter((c) => isHex(c.hex))
  const logo = brand.logos.find((l) => l.variant === 'primary') ?? brand.logos[0]

  return (
    <Grid
      layout="single"
      gap="item"
      align="start"
      className="@3xl/layout-grid:grid-cols-4 @3xl/layout-grid:gap-x-bakin-6"
      data-brand-header
    >
      <PageHeader
        className="@3xl/layout-grid:col-span-3"
        measure="wide"
        navigation={<BrandBackButton onBack={onBack} />}
        eyebrow="Branding / Detail"
        title={brand.name}
        description={brand.description}
        meta={(
          <>
            <code className="font-bakin-typography-family-mono">{brand.id}</code>
            {brand.draft
              ? <StatusBadge tone="attention" variant="solid">Draft</StatusBadge>
              : <StatusBadge tone="success" variant="solid" icon={Check}>Published</StatusBadge>}
            {brand.source ? <StatusBadge tone="neutral" variant="soft" icon={ExternalLink}>Imported</StatusBadge> : null}
          </>
        )}
      />
      <Stack
        align="start"
        className="w-full @3xl/layout-grid:col-start-4 @3xl/layout-grid:row-start-1 @3xl/layout-grid:mt-bakin-8 @3xl/layout-grid:items-end @3xl/layout-grid:pt-bakin-3"
        data-brand-visual-identity
      >
        {logo ? (
          <img
            src={`/api/assets/${logo.assetId}`}
            alt={`${brand.name} logo`}
            className="size-24 shrink-0 object-contain"
            data-brand-logo
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <Button
            variant="outline"
            className="h-24 w-full flex-col whitespace-normal border-dashed text-center"
            onClick={onAddLogo}
            data-add-logo-from-header
          >
            <ImageIcon className="size-bakin-6" />
            Add logo
          </Button>
        )}
      </Stack>
      {colors.length > 0 ? (
        <span
          role="img"
          aria-label={`Brand palette: ${colors.map((color) => `${color.name} ${color.hex}`).join(', ')}`}
          className="flex h-bakin-2 w-full overflow-hidden border border-bakin-border-subtle @3xl/layout-grid:col-span-2 @3xl/layout-grid:col-start-1 @3xl/layout-grid:row-start-2"
          data-brand-palette
        >
          {colors.map((color) => (
            <span
              key={`${color.name}-${color.hex}`}
              className="h-full min-w-0 flex-1"
              style={{ backgroundColor: color.hex }}
            >
              <span className="sr-only">
                {color.name} {color.hex}{color.usage ? ` — ${color.usage}` : ''}
              </span>
            </span>
          ))}
        </span>
      ) : null}
    </Grid>
  )
}

// ─── Overview: read-only dashboard ────────────────────────────────────────────

interface CardPreview { cardBytes: number; maxBytes: number; omitted: number }
interface ActivityRow { ts: string; event: string; agent: string; data: Record<string, unknown> }

function OverviewTab({
  brand, detail, brandId, onGoTo, onEditDoc,
}: {
  brand: BrandManifest; detail: DetailResponse; brandId: string; onGoTo: (tab: string) => void
  onEditDoc: (kind: DocKind, name: string, create?: boolean) => void
}) {
  const [card, setCard] = useState<CardPreview | null>(null)
  const [voice, setVoice] = useState<string | null>(null)
  const [activity, setActivity] = useState<ActivityRow[]>([])

  useEffect(() => {
    setCard(null); setVoice(null); setActivity([])
    void (async () => {
      try {
        const res = await fetch(`/api/plugins/brands/${brandId}/card-preview`)
        if (res.ok) {
          const body = (await res.json()) as { meta: { cardBytes: number; omitted: unknown[] }; maxBytes: number }
          setCard({ cardBytes: body.meta.cardBytes, maxBytes: body.maxBytes, omitted: body.meta.omitted.length })
        }
      } catch { /* best-effort */ }
    })()
    if (detail.guidelines.some((d) => d.name === 'voice.md')) {
      void (async () => {
        try {
          const res = await fetch(`/api/plugins/brands/${brandId}/docs/guidelines/voice.md`)
          if (res.ok) setVoice(((await res.json()) as { content?: string }).content ?? '')
        } catch { /* best-effort */ }
      })()
    }
    void (async () => {
      try {
        const res = await fetch(`/api/plugins/brands/${brandId}/activity`)
        if (res.ok) setActivity(((await res.json()) as { activity: ActivityRow[] }).activity ?? [])
      } catch { /* best-effort */ }
    })()
  }, [brandId, detail.guidelines])

  const assetCount = useMemo(() => new Set([
    ...brand.logos.map((l) => l.assetId),
    ...brand.assetGroups.flatMap((g) => g.assetIds),
    ...(brand.defaultImageReferences ?? []),
  ]).size, [brand])

  const completeness = detail.completeness

  return (
    <Stack gap="section" data-brand-overview>
      {/* Finish-your-kit checklist: server-computed, every miss is a jump link. */}
      {completeness && completeness.percent < 100 && (
        <Section
          spacing="compact"
          data-kit-completeness
          data-tone="neutral"
          className="relative overflow-hidden rounded-bakin-surface border border-bakin-border-strong bg-bakin-surface-default px-bakin-4 py-bakin-4 before:absolute before:inset-y-0 before:start-0 before:w-bakin-1 before:bg-bakin-text-muted"
        >
          <OverviewSectionHeader
            title="Finish your kit"
            icon={Info}
            iconClassName="text-bakin-text-muted"
            description="What's still missing before agents have the full picture — each item jumps to where you fix it."
            action={(
              <Inline gap="dense" wrap={false}>
              <Progress value={completeness.percent} className="h-1.5 w-24" aria-label={`Kit ${completeness.percent}% complete`} />
                <span className="text-bakin-typography-size-meta tabular-nums text-bakin-text-muted">{completeness.percent}%</span>
              </Inline>
            )}
          />
          <Grid layout="split" gap="dense" data-kit-checklist>
            {completeness.items.map((item) => (
              <Button
                key={item.key}
                variant="ghost"
                className="h-auto min-h-bakin-8 justify-start whitespace-normal px-bakin-2 py-bakin-2 text-left"
                onClick={() => onGoTo(item.fixTab)}
                data-kit-item={item.key}
              >
                {item.done
                  ? (
                      <span
                        aria-hidden="true"
                        className="flex size-bakin-4 shrink-0 items-center justify-center rounded-bakin-control bg-bakin-action-primary-background text-bakin-action-primary-foreground"
                        data-kit-checkbox="complete"
                      >
                        <Check className="size-bakin-3" />
                      </span>
                    )
                  : (
                      <span
                        aria-hidden="true"
                        className="size-bakin-4 shrink-0 rounded-bakin-control border border-bakin-text-muted/80 bg-bakin-canvas-default"
                        data-kit-checkbox="incomplete"
                      />
                    )}
                <span className="min-w-0 text-bakin-typography-size-body leading-relaxed">
                  <span>{item.label}</span>
                  {!item.done && <span className="text-bakin-text-muted"> — {item.hint}</span>}
                </span>
              </Button>
            ))}
          </Grid>
        </Section>
      )}

      {/* Stat tiles */}
      <StatGroup
        label="Brand summary metrics"
        className="[&>[data-stat-tile]]:min-w-[min(100%,12rem)] [&>[data-stat-tile]]:flex-1 @4xl/page-shell:[&>[data-stat-tile]]:max-w-72"
      >
        <CardFootprintTile card={card} />
        <StatTile icon={FileText} label="Guidelines" value={detail.guidelines.length} sub="docs" onClick={() => onGoTo('guidelines')} />
        <StatTile icon={BookOpen} label="Lessons" value={detail.lessons.length} sub="banked" onClick={() => onGoTo('lessons')} />
        <StatTile icon={ImageIcon} label="Assets" value={assetCount} sub={`${brand.assetGroups.length} group(s)`} onClick={() => onGoTo('assets')} />
      </StatGroup>

      <Grid layout="main-aside" gap="section" align="start">
        <Section divider="top" spacing="compact">
          <OverviewSectionHeader
            title="Voice"
            icon={Sparkles}
            description="How the brand talks — the biggest lever on how on-brand output reads."
            action={(
            <Button
              variant="ghost" size="xs" className="text-bakin-text-muted"
              onClick={() => onEditDoc('guidelines', 'voice.md', voice === null)}
            >
              <Pencil className="size-bakin-3" /> Edit voice
            </Button>
            )}
          />
          {voice === null
            ? <SectionEmpty>No voice.md yet — the biggest lever on how on-brand output reads.</SectionEmpty>
            : (
              <FadeMore
                summary="Preview only"
                actionLabel="Read the full voice guide"
                onAction={() => onEditDoc('guidelines', 'voice.md')}
              >
                <div className="prose-invert max-w-none text-bakin-typography-size-body"><MarkdownContent content={stripPreviewTitle(voice)} /></div>
              </FadeMore>
            )}
        </Section>

        <Section divider="top" spacing="compact">
          <OverviewSectionHeader
            title="Rules & terminology"
            icon={AlertTriangle}
            description="Non-negotiables that ride every branded task inline."
            action={<Button variant="ghost" size="xs" className="text-bakin-text-muted" onClick={() => onGoTo('identity')}><Pencil className="size-bakin-3" /> Edit</Button>}
          />
          <RulesTermsSummary brand={brand} onGoTo={onGoTo} />
        </Section>
      </Grid>

      <Section divider="top" spacing="compact">
        <OverviewSectionHeader
          title="Recent activity"
          icon={Rocket}
          description="Edits, imports, publishes, and dispatch injections for this brand."
        />
        {activity.length === 0
          ? <SectionEmpty>Nothing yet — activity shows up as the brand gets used.</SectionEmpty>
          : activity.slice(0, 8).map((a, i) => (
            <Inline key={`${a.ts}-${i}`} align="baseline" justify="between" gap="dense">
              <span>{activityLabel(a)}</span>
              <span className="shrink-0 text-bakin-typography-size-meta text-bakin-text-muted">{relTime(a.ts)}</span>
            </Inline>
          ))}
      </Section>
    </Stack>
  )
}

function OverviewSectionHeader({
  action,
  description,
  icon: Icon,
  iconClassName = 'text-bakin-signal-accent',
  title,
}: {
  action?: React.ReactNode
  description: string
  icon: React.ComponentType<{ className?: string }>
  iconClassName?: string
  title: string
}) {
  return (
    <Inline align="start" justify="between" gap="item">
      <Stack gap="dense">
        <Inline gap="dense" wrap={false}>
          <Icon className={`size-bakin-4 shrink-0 ${iconClassName}`} aria-hidden="true" />
          <h2 className="m-0 text-bakin-typography-size-section-title font-bakin-typography-weight-semibold text-bakin-text-primary">
            {title}
          </h2>
        </Inline>
        <p className="m-0 max-w-prose text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
          {description}
        </p>
      </Stack>
      {action}
    </Inline>
  )
}

/**
 * Overview preview of rules + terminology — same fade-into-overlay treatment
 * as the Voice card beside it. Full editing lives on the Identity tab.
 */
const SUMMARY_ROWS = 3
function RulesTermsSummary({ brand, onGoTo }: { brand: BrandManifest; onGoTo: (tab: string) => void }) {
  const rules = brand.rules ?? []
  const terms = brand.terminology ?? []
  if (rules.length === 0 && terms.length === 0) {
    return <SectionEmpty>None set yet — rules and terms ride every branded task inline.</SectionEmpty>
  }
  return (
    <FadeMore
      summary={`${rules.length} rule${rules.length === 1 ? '' : 's'} · ${terms.length} term${terms.length === 1 ? '' : 's'}`}
      actionLabel="View all in Identity"
      onAction={() => onGoTo('identity')}
      hasMore={rules.length + terms.length > SUMMARY_ROWS * 2}
      className="space-y-bakin-2"
    >
      {rules.map((r) => (
        <div key={r} className="flex gap-bakin-2 text-bakin-typography-size-body"><span className="text-bakin-text-muted">›</span><span>{r}</span></div>
      ))}
      {terms.map((t) => (
        <div key={t.term} className="text-bakin-typography-size-body"><span className="font-bakin-typography-weight-medium">{t.term}</span> <span className="text-bakin-text-muted">— {t.rule}</span></div>
      ))}
    </FadeMore>
  )
}

/** The dispatch-footprint metric on the SDK StatTile (promoted from here). */
function CardFootprintTile({ card }: { card: CardPreview | null }) {
  if (!card) return <StatTile icon={Sparkles} label="Card footprint" value="—" sub="per dispatch" />
  const kb = card.cardBytes / 1024
  const maxKb = card.maxBytes / 1024
  const pct = Math.min(100, (card.cardBytes / card.maxBytes) * 100)
  return (
    <StatTile
      icon={Sparkles}
      label="Card footprint"
      value={
        <>
          {kb.toFixed(1)}
          <span className="text-bakin-typography-size-body font-bakin-typography-weight-regular text-bakin-text-muted"> / {maxKb.toFixed(0)} KB</span>
        </>
      }
      progress={{ percent: pct, tone: pct > 85 ? 'attention' : 'success' }}
      sub={card.omitted > 0 ? `${card.omitted} omitted for size` : 'nothing omitted'}
    />
  )
}

function activityLabel(a: ActivityRow): string {
  switch (a.event) {
    case 'brand.injected': return `Injected into a dispatch${a.data.triage ? ' (triage)' : ''}`
    case 'brand.lesson_added': return `Lesson added${a.data.title ? `: ${a.data.title}` : ''}`
    case 'brand.dispatch_blocked': return 'A task deferred — brand unavailable'
    case 'brand.asset_missing': return 'Missing asset reference flagged'
    case 'brand.lessons_unavailable': return 'Lessons unavailable (search down)'
    case 'brand.updated': return 'Brand edited'
    case 'brand.imported': return 'Imported from source'
    case 'brand.exported': return 'Exported'
    case 'brand.draft_published': return 'Published'
    case 'brand.unpublished': return 'Unpublished — back to draft'
    case 'brand.created': return 'Created'
    default: return a.event.replace('brand.', '')
  }
}

function relTime(ts: string): string {
  const ms = Date.now() - Date.parse(ts)
  if (!Number.isFinite(ms)) return ''
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ─── Docs editor (guidelines + lessons) ───────────────────────────────────────

const DOC_COPY: Record<DocKind, { title: string; description: string; noun: string }> = {
  guidelines: {
    title: 'Guidelines',
    description: 'The docs that teach agents this brand — voice, style, anything they should read before producing work.',
    noun: 'doc',
  },
  lessons: {
    title: 'Lessons',
    description: 'Learned from real tasks — the most relevant lessons are recalled automatically per task. Hard rules belong in Identity → Rules instead.',
    noun: 'lesson',
  },
}

function DocsEditor({
  kind, docs, brand, brandId, guidelines, onEditDoc, onDeleted, onToggleCardDoc, onToggleLesson,
}: {
  kind: DocKind
  docs: DocInfo[]
  brand: BrandManifest
  brandId: string
  guidelines: DocInfo[]
  onEditDoc: (kind: DocKind, name: string, create?: boolean) => void
  onDeleted: () => void
  onToggleCardDoc: (name: string, on: boolean) => void
  onToggleLesson: (name: string, active: boolean) => void
}) {
  const [newOpen, setNewOpen] = useState(false)
  const [newDocName, setNewDocName] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const cardDocs = brand.cardDocs ?? (guidelines.some((g) => g.name === 'voice.md') ? ['voice.md'] : [])
  const copy = DOC_COPY[kind]

  const deleteDoc = useCallback(async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/plugins/brands/${brandId}/docs/${kind}/${encodeURIComponent(deleting)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`delete failed: ${res.status}`)
      toast(`Deleted ${deleting}`, 'success')
      setDeleting(null)
      onDeleted()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleteBusy(false)
    }
  }, [deleting, brandId, kind, onDeleted])

  const submitNewDoc = () => {
    const raw = newDocName.trim()
    if (!raw) return
    const name = raw.endsWith('.md') ? raw : `${raw}.md`
    setNewOpen(false)
    setNewDocName('')
    onEditDoc(kind, name, true)
  }

  return (
    <SectionCard
      title={copy.title}
      icon={kind === 'guidelines' ? FileText : BookOpen}
      description={copy.description}
      action={
        <Button variant="outline" size="sm" onClick={() => setNewOpen(true)} data-new-doc>
          <Plus className="size-bakin-3" /> New {copy.noun}
        </Button>
      }
    >
      <div className="space-y-bakin-2">
        {docs.length === 0 && (
          <SectionEmpty>No {copy.title.toLowerCase()} yet — create one and the editor opens on a fresh page.</SectionEmpty>
        )}
        {docs.map((d) => (
          // Each row is a distinct tile — flat hover-only rows blended into one block.
          // Benched lessons read as benched.
          <div
            key={d.name}
            // Disabled lessons de-emphasize via muted text — never an
            // opacity fade that drops text below contrast.
            className={`flex items-center gap-bakin-3 rounded-bakin-control bg-bakin-text-primary/5 px-bakin-3 py-bakin-2 ring-1 ring-bakin-text-primary/5 transition-colors hover:bg-bakin-text-primary/10 motion-reduce:transition-none ${
              kind === 'lessons' && (brand.disabledLessons ?? []).includes(d.name) ? '[&_span]:text-bakin-text-muted' : ''
            }`}
            data-doc-row={d.name}
          >
            {/* The filename is the identity — it never yields space to the description. */}
            <Button
              type="button"
              variant="ghost"
              size="inline"
              className="max-w-72 shrink-0 gap-bakin-1 font-bakin-typography-weight-regular hover:bg-transparent"
              onClick={() => onEditDoc(kind, d.name)}
            >
              <FileText className="size-bakin-3 shrink-0 text-bakin-text-muted" />
              <span className="truncate font-bakin-typography-family-mono text-bakin-typography-size-body">{d.name}</span>
            </Button>
            {d.description && <span className="min-w-0 flex-1 truncate text-bakin-typography-size-meta text-bakin-text-muted">{d.description}</span>}
            <div className="ml-auto flex shrink-0 items-center gap-bakin-3">
              {kind === 'guidelines' && (
                <TooltipProvider delay={200}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <label className="flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
                          <Switch
                            checked={cardDocs.includes(d.name)}
                            onCheckedChange={(on: boolean) => onToggleCardDoc(d.name, on)}
                            aria-label={`Always include ${d.name} in agent context`}
                          />
                          Always in context
                          <Info className="size-bakin-3" />
                        </label>
                      }
                    />
                    <TooltipContent side="top" className="max-w-64">
                      Included verbatim in every branded task's context (within the size budget). Leave off to keep
                      context small — agents can still fetch the doc on demand. Takes effect when you save.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {kind === 'lessons' && (
                <TooltipProvider delay={200}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <label className="flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
                          <Switch
                            checked={!(brand.disabledLessons ?? []).includes(d.name)}
                            onCheckedChange={(active: boolean) => onToggleLesson(d.name, active)}
                            aria-label={`Lesson ${d.name} active`}
                          />
                          Active
                          <Info className="size-bakin-3" />
                        </label>
                      }
                    />
                    <TooltipContent side="top" className="max-w-64">
                      Off = kept on disk but never recalled into tasks — use it to bench an outdated or wrong lesson
                      without deleting it. Takes effect when you save.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <Button variant="ghost" size="xs" className="text-bakin-text-muted" onClick={() => onEditDoc(kind, d.name)}>
                <Pencil className="size-bakin-3" /> Edit
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="text-bakin-text-muted hover:text-bakin-signal-danger"
                onClick={() => setDeleting(d.name)}
                aria-label={`Delete ${d.name}`}
              >
                <Trash2 className="size-bakin-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting}?`}
        description={`The ${copy.noun} is removed from the brand — agents stop seeing it immediately. This can't be undone.`}
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void deleteDoc()}
        onCancel={() => {
          if (!deleteBusy) setDeleting(null)
        }}
      />

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New {copy.noun}</DialogTitle>
            <DialogDescription>Name the file — the editor opens on a fresh page and the first save creates it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-bakin-1">
            <Label htmlFor="new-doc-name">File name</Label>
            <Input
              id="new-doc-name"
              autoFocus
              placeholder={kind === 'guidelines' ? 'imagery' : 'launch-learnings'}
              value={newDocName}
              onChange={(e) => setNewDocName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNewDoc()
              }}
            />
            <p className="text-bakin-typography-size-meta text-bakin-text-muted">.md is added for you{newDocName.trim() && !newDocName.trim().endsWith('.md') ? ` — creates ${newDocName.trim()}.md` : ''}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={submitNewDoc} disabled={!newDocName.trim()} data-new-doc-create>
              Create & edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}

// ─── Assets ───────────────────────────────────────────────────────────────────

interface AssetInfo { assetId: string; description: string; type: string; hasThumb: boolean }
// Lucide, not emoji — emoji glyphs render platform-dependent.
const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  images: ImageIcon, pdf: FileText, video: Play, audio: Music, text: Type, data: Table2,
}

const LOGO_VARIANTS = ['primary', 'dark', 'light', 'mono', 'icon', 'wordmark']

function BrandAssetsSection({
  brand,
  logoPickerRequested,
  onLogoPickerRequestHandled,
  onSave,
}: {
  brand: BrandManifest
  logoPickerRequested: boolean
  onLogoPickerRequestHandled: () => void
  onSave: (patch: ManifestPatch) => void
}) {
  const [assets, setAssets] = useState<Record<string, AssetInfo>>({})
  const [groupDraft, setGroupDraft] = useState<{ name: string; description: string } | null>(null)
  // ONE AssetPicker instance; whichever section opens it provides the target.
  const [pickTarget, setPickTarget] = useState<{ title: string; description: string; onPick: (assetId: string) => void } | null>(null)
  // One confirm for every remove on this tab. Copy stays honest: removal only
  // drops the brand's REFERENCE (staged until Save) — the file stays in the
  // asset library. `patch` computes from the manifest AT CONFIRM TIME, never a
  // snapshot from when the dialog opened (the drafting agent may have written
  // meanwhile; a stale-closure apply silently erased its work).
  const [removeTarget, setRemoveTarget] = useState<{ title: string; description: string; patch: (current: BrandManifest) => ManifestPatch } | null>(null)
  const loadAssets = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/assets/versioned')
      if (!res.ok) return
      const body = (await res.json()) as { assets?: Array<{ assetId: string; description?: string; type?: string; hasThumb?: boolean }> }
      const list = (body.assets ?? []).map((a) => ({ assetId: a.assetId, description: a.description ?? '', type: a.type ?? 'other', hasThumb: !!a.hasThumb }))
      setAssets(Object.fromEntries(list.map((a) => [a.assetId, a])))
    } catch { /* tiles degrade to id-only when the assets plugin is unreachable */ }
  }, [])

  useEffect(() => { void loadAssets() }, [loadAssets])

  const saveDescription = useCallback(async (assetId: string, description: string) => {
    setAssets((prev) => ({ ...prev, [assetId]: { ...(prev[assetId] ?? { assetId, description: '', type: 'other', hasThumb: false }), description } }))
    try {
      await fetch(`/api/plugins/assets/versioned/${assetId}/metadata`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description }),
      })
    } catch { /* optimistic; a reload reconciles */ }
  }, [])

  const openPicker = (title: string, description: string, onPick: (assetId: string) => void) =>
    setPickTarget({ title, description, onPick })

  const openLogoPicker = useCallback(() => {
    setPickTarget({
      title: 'Add a logo',
      description: 'Pick or upload the logo image agents should use.',
      onPick: (assetId) => onSave({
        logos: [...brand.logos, { assetId, variant: brand.logos.length === 0 ? 'primary' : 'dark' }],
      }),
    })
  }, [brand.logos, onSave])

  useEffect(() => {
    if (!logoPickerRequested) return
    openLogoPicker()
    onLogoPickerRequestHandled()
  }, [logoPickerRequested, onLogoPickerRequestHandled, openLogoPicker])

  const tile = (assetId: string, patch: (current: BrandManifest) => ManifestPatch, extra?: React.ReactNode) => (
    <AssetTile
      key={assetId}
      info={assets[assetId]}
      assetId={assetId}
      onDescription={(d) => void saveDescription(assetId, d)}
      onRemove={() =>
        setRemoveTarget({
          title: 'Remove this reference?',
          description: `${assets[assetId]?.description || assetId} stays in your asset library — this brand just stops referencing it. Takes effect when you save.`,
          patch,
        })
      }
      extra={extra}
    />
  )

  return (
    <div className="flex flex-col gap-bakin-4">
      <AssetLibraryPicker
        open={pickTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPickTarget(null)
        }}
        onPick={(assetId) => {
          pickTarget?.onPick(assetId)
          void loadAssets()
        }}
        title={pickTarget?.title ?? 'Choose an asset'}
        description={pickTarget?.description}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title={removeTarget?.title ?? ''}
        description={removeTarget?.description}
        confirmLabel="Remove"
        confirmTestId="asset-remove-confirm"
        onConfirm={() => {
          // Compute the patch from the CURRENT manifest — the brand may have
          // refreshed (agent writes) while the dialog was open.
          if (removeTarget) onSave(removeTarget.patch(brand))
          setRemoveTarget(null)
        }}
        onCancel={() => setRemoveTarget(null)}
      />

      <SectionCard
        title="Logos"
        icon={ImageIcon}
        description="The face of the brand — the first logo shows on cards and covers; variants (dark/light) help agents pick the right one."
        action={
          <Button
            variant="outline" size="sm" data-add-logo
            onClick={openLogoPicker}
          >
            <Plus className="size-bakin-3" /> Add logo
          </Button>
        }
      >
        {brand.logos.length === 0 && (
          <SectionEmpty>No logo yet — cards show a monogram until you add one.</SectionEmpty>
        )}
        {brand.logos.length > 0 && (
          <div className="grid gap-bakin-3 lg:grid-cols-2">
            {brand.logos.map((logo, i) =>
              tile(
                logo.assetId,
                (m) => ({ logos: m.logos.filter((l) => l.assetId !== logo.assetId) }),
                <VariantSelect
                  value={logo.variant}
                  onChange={(variant) => onSave({ logos: brand.logos.map((l, j) => (j === i ? { ...l, variant } : l)) })}
                />,
              ),
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Asset groups"
        icon={ImageIcon}
        description="Bundles of reference material (product shots, UI screenshots) agents browse by name when they need the real thing."
        action={
          !groupDraft ? (
            <Button variant="outline" size="sm" onClick={() => setGroupDraft({ name: '', description: '' })} data-add-group>
              <Plus className="size-bakin-3" /> New group
            </Button>
          ) : undefined
        }
      >
        {brand.assetGroups.length === 0 && !groupDraft && (
          <SectionEmpty>No groups yet — e.g. "product-ui" for real screenshots agents should reference instead of inventing UI.</SectionEmpty>
        )}
        {brand.assetGroups.map((group, gi) => (
          <div key={group.name} className="space-y-bakin-2 rounded-bakin-control bg-bakin-surface-default p-bakin-3">
            <div className="flex items-center gap-bakin-2 text-bakin-typography-size-body">
              <span className="font-bakin-typography-weight-medium">{group.name}</span>
              {group.description && <span className="text-bakin-typography-size-meta text-bakin-text-muted">— {group.description}</span>}
              <div className="ml-auto flex shrink-0 items-center gap-bakin-1">
                <Button
                  variant="ghost" size="xs" className="text-bakin-text-muted"
                  onClick={() => openPicker(`Add to ${group.name}`, group.description || 'Pick or upload reference material for this group.', (assetId) => onSave({ assetGroups: brand.assetGroups.map((g, j) => (j === gi && !g.assetIds.includes(assetId) ? { ...g, assetIds: [...g.assetIds, assetId] } : g)) }))}
                >
                  <Plus className="size-bakin-3" /> Add
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-bakin-text-muted hover:text-bakin-signal-danger"
                  onClick={() =>
                    setRemoveTarget({
                      title: `Remove group ${group.name}?`,
                      description: `Its ${group.assetIds.length} reference${group.assetIds.length === 1 ? '' : 's'} come off this brand — the files stay in your asset library. Takes effect when you save.`,
                      patch: (m) => ({ assetGroups: m.assetGroups.filter((g) => g.name !== group.name) }),
                    })
                  }
                  aria-label={`Remove group ${group.name}`}
                >
                  <Trash2 className="size-bakin-3" />
                </Button>
              </div>
            </div>
            {group.assetIds.length === 0 && <p className="text-bakin-typography-size-meta text-bakin-text-muted">Empty group — add screenshots or imagery.</p>}
            {group.assetIds.length > 0 && (
              <div className="grid gap-bakin-3 lg:grid-cols-2">
                {group.assetIds.map((assetId) =>
                  tile(assetId, (m) => ({ assetGroups: m.assetGroups.map((g) => (g.name === group.name ? { ...g, assetIds: g.assetIds.filter((id) => id !== assetId) } : g)) })),
                )}
              </div>
            )}
          </div>
        ))}
        {groupDraft && (
          <div className="flex items-center gap-bakin-2 rounded-bakin-control bg-bakin-surface-default p-bakin-2">
            <Input className="w-40" placeholder="product-ui" aria-label="Group name" value={groupDraft.name} onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })} />
            <Input className="flex-1" placeholder="real product UI — use for any product visual" aria-label="Group usage note" value={groupDraft.description} onChange={(e) => setGroupDraft({ ...groupDraft, description: e.target.value })} />
            <Button variant="default" size="sm" disabled={!groupDraft.name.trim()} onClick={() => { onSave({ assetGroups: [...brand.assetGroups, { name: groupDraft.name.trim(), description: groupDraft.description.trim() || undefined, assetIds: [] }] }); setGroupDraft(null) }}>Add group</Button>
            <Button variant="ghost" size="sm" onClick={() => setGroupDraft(null)}>Cancel</Button>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Default image references"
        icon={ImageIcon}
        description="Up to 4 images automatically attached as style references to every branded image generation — image tools consume these directly."
        action={
          (brand.defaultImageReferences ?? []).length < 4 ? (
            <Button
              variant="outline" size="sm" data-add-image-ref
              onClick={() => openPicker('Add an image reference', 'Attached automatically to branded image generations as a style reference.', (assetId) => {
                const current = brand.defaultImageReferences ?? []
                if (!current.includes(assetId)) onSave({ defaultImageReferences: [...current, assetId] })
              })}
            >
              <Plus className="size-bakin-3" /> Add reference
            </Button>
          ) : (
            <span className="text-bakin-typography-size-meta text-bakin-text-muted">4 of 4 — remove one to swap</span>
          )
        }
      >
        {(brand.defaultImageReferences ?? []).length === 0 && (
          <SectionEmpty>None yet — without references, branded image generations rely on the palette and text alone.</SectionEmpty>
        )}
        {(brand.defaultImageReferences ?? []).length > 0 && (
          <div className="grid gap-bakin-3 lg:grid-cols-2">
            {(brand.defaultImageReferences ?? []).map((assetId) =>
              tile(assetId, (m) => ({ defaultImageReferences: (m.defaultImageReferences ?? []).filter((id) => id !== assetId) })),
            )}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

/** Labeled logo-variant picker — common variants plus whatever the manifest already says. */
function VariantSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = LOGO_VARIANTS.includes(value) ? LOGO_VARIANTS : [value, ...LOGO_VARIANTS]
  return (
    <span className="flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
      variant
      <Select value={value} onValueChange={(next) => { if (next) onChange(next) }}>
        <SelectTrigger size="sm" aria-label="Logo variant" className="w-auto shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((v) => (
            <SelectItem key={v} value={v}>{v}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  )
}

/**
 * A referenced asset as an image CARD (thumbnail-first grid, not a horizontal
 * row — these are pictures, and rows hid the one thing that identifies them).
 * Thumbnail opens the viewer; note edits in place; remove floats on hover.
 */
function AssetTile({
  assetId, info, onDescription, onRemove, extra,
}: {
  assetId: string; info?: AssetInfo; onDescription: (description: string) => void; onRemove: () => void; extra?: React.ReactNode
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(info?.description ?? '')
  const isImage = info?.type === 'images'
  const open = () => router.push(`/assets/${encodeURIComponent(assetId)}`)
  const commit = () => { setEditing(false); if (draft !== (info?.description ?? '')) onDescription(draft) }

  return (
    // Horizontal card: compact image LEFT, the description gets the width it
    // deserves on the right. Two across, stretch to fit.
    <div className="group relative flex overflow-hidden rounded-bakin-surface bg-bakin-surface-default ring-1 ring-bakin-text-primary/10 transition-shadow hover:ring-bakin-text-primary/25" data-asset-card={assetId}>
      <Button
        type="button"
        variant="ghost"
        size="inline"
        className="block min-h-36 w-36 shrink-0 self-stretch overflow-hidden rounded-none bg-bakin-canvas-default/50 text-left hover:bg-bakin-canvas-default/60"
        aria-label="Open in the asset viewer"
        onClick={open}
      >
        {isImage && info?.hasThumb
          ? <img src={`/api/assets/${assetId}/thumb`} alt="" className="size-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
          : (() => {
              const TypeGlyph = TYPE_ICON[info?.type ?? 'other'] ?? File
              return (
                <span className="flex size-full items-center justify-center text-bakin-text-muted">
                  <TypeGlyph aria-hidden="true" className="size-bakin-8" />
                </span>
              )
            })()}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        // The reveal convention: hover/focus reveal on pointer-hover
        // viewports only — touch keeps the control visible.
        className="absolute right-1.5 top-1.5 bg-bakin-canvas-default/70 text-bakin-text-muted backdrop-blur transition-opacity hover:text-bakin-signal-danger md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100 motion-reduce:transition-none"
        onClick={onRemove}
        aria-label="Remove"
      >
        <Trash2 className="size-bakin-3" />
      </Button>

      {/* pr-9 reserves the hover-trash gutter — the floating icon must never sit on the note text. */}
      <div className="flex min-w-0 flex-1 flex-col gap-bakin-1 py-bakin-3 pl-bakin-3 pr-9 text-bakin-typography-size-meta">
        {extra}
        {editing ? (
          <Textarea
            autoFocus
            rows={2}
            className="text-bakin-typography-size-meta"
            placeholder="What is this, and how should agents use it?"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) commit(); if (e.key === 'Escape') { setDraft(info?.description ?? ''); setEditing(false) } }}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="inline"
            className="font-bakin-typography-weight-regular hover:bg-transparent"
            onClick={() => { setDraft(info?.description ?? ''); setEditing(true) }}
          >
            {info?.description
              ? <span className="line-clamp-3 text-bakin-text-primary/90">{info.description} <Pencil className="inline size-bakin-3 text-bakin-text-muted" /></span>
              : <span className="flex items-center gap-bakin-1 text-bakin-text-muted transition-colors hover:text-bakin-text-primary"><Plus className="size-bakin-3" /> Add a note</span>}
          </Button>
        )}
        {/* Machine detail — surfaces on hover only; when shown it reads at
            full muted contrast (never double-faded). */}
        <span className="truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none">{assetId}</span>
      </div>
    </div>
  )
}

// ─── Draft banner + settings ──────────────────────────────────────────────────

/** Tasks in todo currently waiting on this brand (draft or missing). */
function useBlockedCount(brandId: string, enabled: boolean): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    void (async () => {
      try {
        const res = await fetch('/api/plugins/brands/blocked-tasks')
        if (!res.ok) return
        const body = (await res.json()) as { perTask?: Record<string, string> }
        setCount(Object.values(body.perTask ?? {}).filter((id) => id === brandId).length)
      } catch { /* the count is a nudge, not a gate */ }
    })()
  }, [brandId, enabled])
  return count
}

/** What the drafting task is doing right now, in plain language. */
const DRAFT_TASK_STATUS: Record<string, { label: string; tone: 'working' | 'queued' | 'done' | 'blocked' }> = {
  backlog: { label: 'Queued on the board — an agent picks it up shortly.', tone: 'queued' },
  todo: { label: 'Queued on the board — an agent picks it up shortly.', tone: 'queued' },
  inProgress: { label: 'An agent is working on it right now.', tone: 'working' },
  review: { label: 'The draft is written — review the tabs, then publish.', tone: 'done' },
  done: { label: 'Drafting finished — review the tabs, then publish.', tone: 'done' },
  blocked: { label: 'The drafting task hit a problem — open it to see why.', tone: 'blocked' },
}

/**
 * The wait-for-the-agent story (spec §7h): a fresh draft never looks silent.
 * The drafting task id lives ON the manifest (draftTaskId — survives reloads;
 * ?draftTask= is the create-flow fallback), and its LIVE board status renders
 * here, refreshed on every taskboard SSE tick.
 */
function DraftBanner({ brand, brandId, onPublish }: { brand: BrandManifest; brandId: string; onPublish: () => void }) {
  const router = useRouter()
  const [draftTaskParam] = useQueryState('draftTask', '')
  const taskId = brand.draftTaskId || draftTaskParam
  const blocked = useBlockedCount(brandId, true)
  const [taskColumn, setTaskColumn] = useState<string | null>(null)

  // Stale-response guard (ui-patterns #9): rapid taskboard events can resolve
  // out of order — only the newest request may paint.
  const loadSeqRef = useRef(0)
  const loadTask = useCallback(async () => {
    if (!taskId) return
    const seq = ++loadSeqRef.current
    try {
      const res = await fetch(`/api/plugins/tasks/${encodeURIComponent(taskId)}`)
      if (seq !== loadSeqRef.current) return
      if (!res.ok) {
        // Task deleted (404 etc.) — clear rather than freeze the last-known
        // status as "Agent working" forever.
        setTaskColumn(null)
        return
      }
      const body = (await res.json()) as { column?: string }
      if (seq !== loadSeqRef.current) return
      setTaskColumn(body.column ?? null)
    } catch { /* the banner degrades to the static copy */ }
  }, [taskId])

  useEffect(() => {
    void loadTask()
  }, [loadTask])
  // Board moves (dispatch picks it up, agent completes) re-render the status live.
  usePluginEvent('taskboard', () => void loadTask())

  const status = taskColumn ? DRAFT_TASK_STATUS[taskColumn] : null
  const availability = 'You can keep editing and reviewing it, but tasks and image tools cannot use it yet. Publishing makes it available to agents immediately.'
  const description = status
    ? `${status.label} ${availability}${blocked > 0 ? ` ${blocked} task${blocked === 1 ? ' is' : 's are'} waiting on this brand.` : ''}`
    : `${taskId
      ? `An agent is drafting it from your intake — usually takes a few minutes. ${availability}`
      : availability
    }${blocked > 0 ? ` ${blocked} task${blocked === 1 ? ' is' : 's are'} waiting on this brand.` : ''}`

  return (
    <Banner
      tone="attention"
      data-draft-banner
      title={(
        <span className="inline-flex min-w-0 flex-wrap items-center gap-bakin-2">
          This brand is a draft
          {status && (
            <span data-draft-task-status={taskColumn}>
              <StatusBadge
                tone={status.tone === 'working' ? 'attention' : status.tone === 'done' ? 'success' : status.tone === 'blocked' ? 'danger' : 'neutral'}
                className="font-bakin-typography-weight-regular"
              >
                {status.tone === 'working' && <span className="size-bakin-1 animate-pulse rounded-bakin-pill bg-bakin-signal-highlight" aria-hidden />}
                {status.tone === 'working' ? 'Agent working' : status.tone === 'done' ? 'Draft ready' : status.tone === 'blocked' ? 'Blocked' : 'Queued'}
              </StatusBadge>
            </span>
          )}
        </span>
      )}
      description={description}
      action={(
        <>
          {taskId && (
            <Button variant="outline" size="sm" onClick={() => router.push(`/tasks?taskId=${encodeURIComponent(taskId)}`)} data-draft-task-link>
              View the drafting task
            </Button>
          )}
          <Button size="sm" onClick={onPublish}>
            <Rocket className="size-bakin-3" /> Publish
          </Button>
        </>
      )}
    />
  )
}

function BrandSettingsTab({
  brand, brandId, onPublish, onDeleted, onChanged,
}: {
  brand: BrandManifest; brandId: string; onPublish: () => void; onDeleted: () => void; onChanged: () => void
}) {
  const [unpublishConfirm, setUnpublishConfirm] = useState(false)
  const [unpublishBusy, setUnpublishBusy] = useState(false)
  const [unpublishError, setUnpublishError] = useState<string | null>(null)
  const unpublish = useCallback(async () => {
    setUnpublishBusy(true)
    setUnpublishError(null)
    try {
      const res = await fetch(`/api/plugins/brands/${brandId}/unpublish`, { method: 'POST' })
      if (!res.ok) throw new Error(`unpublish failed: ${res.status}`)
      toast(`${brand.name} is a draft again — linked tasks pause until you republish`, 'info')
      setUnpublishConfirm(false)
      onChanged()
    } catch (err) {
      setUnpublishError(err instanceof Error ? err.message : String(err))
    } finally {
      setUnpublishBusy(false)
    }
  }, [brandId, brand.name, onChanged])
  const [cardInfo, setCardInfo] = useState<{ cardBytes: number; maxBytes: number; omitted: number } | null>(null)
  const [dangling, setDangling] = useState<Array<{ assetId: string; where: string }>>([])
  const [linked, setLinked] = useState<number | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const blocked = useBlockedCount(brandId, Boolean(brand.draft))

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/plugins/brands/${brandId}/card-preview`)
        if (res.ok) {
          const body = (await res.json()) as { meta: { cardBytes: number; omitted: unknown[] }; maxBytes: number }
          setCardInfo({ cardBytes: body.meta.cardBytes, maxBytes: body.maxBytes, omitted: body.meta.omitted.length })
        }
      } catch { /* preview is best-effort */ }
      try {
        const res = await fetch(`/api/plugins/brands/${brandId}/integrity`)
        if (res.ok) {
          const body = (await res.json()) as { findings: Array<{ brandId: string; dangling: Array<{ assetId: string; where: string }> }> }
          setDangling(body.findings.find((f) => f.brandId === brandId)?.dangling ?? [])
        }
      } catch { /* integrity is best-effort here; the doctor is the backstop */ }
      // How many open tasks reference this brand — context for the danger zone.
      try {
        const res = await fetch('/api/plugins/tasks/')
        if (res.ok) {
          const board = (await res.json()) as { columns?: Record<string, Array<{ brandId?: string }>> }
          let n = 0
          for (const [column, tasks] of Object.entries(board.columns ?? {})) {
            if (column === 'done' || column === 'archived') continue
            n += tasks.filter((t) => t.brandId === brandId).length
          }
          setLinked(n)
        }
      } catch { /* count is context, not a gate */ }
    })()
  }, [brandId])

  const deleteBrand = useCallback(async () => {
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/plugins/brands/${brandId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`delete failed: ${res.status}`)
      toast(`Deleted ${brand.name}`, 'success')
      onDeleted()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleteBusy(false)
    }
  }, [brandId, brand.name, onDeleted])

  return (
    <div className="flex flex-col gap-bakin-4">
      <SectionCard
        title="Status"
        icon={Rocket}
        description={brand.draft ? 'Drafts are invisible to tasks and image tools until published.' : 'Published — agents use this brand on every linked task.'}
      >
        {brand.draft ? (
          <>
            <p className="text-bakin-typography-size-body text-bakin-text-muted">
              Review the tabs, then publish. Delete <code className="rounded bg-bakin-surface-default px-bakin-1 text-bakin-typography-size-meta">_intake.md</code> under
              Guidelines if you don't want the builder intake kept.
              {blocked > 0 && ` ${blocked} task${blocked === 1 ? ' is' : 's are'} waiting on this brand right now.`}
            </p>
            <Button variant="default" size="sm" className="w-fit" onClick={onPublish}>
              <Rocket className="size-bakin-3" /> Publish brand
            </Button>
          </>
        ) : (
          <>
            <p className="flex items-center gap-bakin-1 text-bakin-typography-size-body text-bakin-text-muted">
              <Check className="size-bakin-4 text-bakin-action-primary-background" /> Live since {new Date(brand.updatedAt).toLocaleDateString()}
              {linked !== null && ` — linked to ${linked} open task${linked === 1 ? '' : 's'}.`}
            </p>
            <Button variant="outline" size="sm" className="w-fit" onClick={() => setUnpublishConfirm(true)} data-unpublish>
              Unpublish
            </Button>
            <ConfirmDialog
              open={unpublishConfirm}
              title={`Unpublish ${brand.name}?`}
              description={
                linked !== null && linked > 0
                  ? `It goes back to draft — agents stop using it, and the ${linked} open task${linked === 1 ? '' : 's'} linked to it will pause until you publish again.`
                  : 'It goes back to draft — agents stop using it, and any linked tasks will pause until you publish again.'
              }
              confirmLabel="Unpublish"
              busyLabel="Unpublishing..."
              busy={unpublishBusy}
              error={unpublishError}
              onConfirm={() => void unpublish()}
              onCancel={() => {
                if (!unpublishBusy) setUnpublishConfirm(false)
              }}
            />
          </>
        )}
      </SectionCard>

      {brand.source && (
        <SectionCard
          title="Imported from"
          icon={ExternalLink}
          description="Where this brand kit came from — local edits win over the upstream copy."
        >
          <p className="text-bakin-typography-size-body text-bakin-text-muted">
            <span className="font-bakin-typography-family-mono text-bakin-text-primary/80">{brand.source.repo}</span>
            {brand.source.commit ? ` @ ${brand.source.commit.slice(0, 8)}` : ''}. Check for upstream changes:
            <code className="ml-bakin-1 rounded bg-bakin-surface-default px-bakin-1 text-bakin-typography-size-meta">bakin brands check {brand.id}</code>
          </p>
        </SectionCard>
      )}

      <SectionCard
        title="What agents see"
        icon={Sparkles}
        description="Every branded task carries a compact card of this brand — rules, palette, terminology, and the always-in-context docs."
      >
        {cardInfo ? (
          <p className="text-bakin-typography-size-body text-bakin-text-muted">
            The card currently adds ~{(cardInfo.cardBytes / 1024).toFixed(1)} KB of its {(cardInfo.maxBytes / 1024).toFixed(0)} KB allowance to every branded task
            {cardInfo.omitted > 0 ? ` — ${cardInfo.omitted} item${cardInfo.omitted === 1 ? ' is' : 's are'} left out for size (agents fetch them on demand).` : ' — nothing is left out.'}
          </p>
        ) : (
          <p className="text-bakin-typography-size-body text-bakin-text-muted">Measuring the card…</p>
        )}
        {dangling.length > 0 && (
          <div className="rounded-bakin-control bg-bakin-signal-highlight/10 p-bakin-3 ring-1 ring-bakin-signal-highlight/20">
            {dangling.map((d) => <p key={d.assetId} className="flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-signal-highlight"><AlertTriangle className="size-bakin-3" /> asset {d.assetId} is missing ({d.where}) — remove or replace it under Assets</p>)}
          </div>
        )}
      </SectionCard>

      <DangerZone
        description={
          linked !== null && linked > 0
            ? `Deletes the brand, its guidelines, and lessons. ${linked} open task${linked === 1 ? '' : 's'} link${linked === 1 ? 's' : ''} to it and will pause until you remove the link. Assets stay in the asset store.`
            : 'Deletes the brand, its guidelines, and lessons. Tasks linked to it later will pause until it exists again. Assets stay in the asset store.'
        }
        confirmLabel="Delete this brand"
        confirmValue={brandId}
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void deleteBrand()}
      />
    </div>
  )
}
