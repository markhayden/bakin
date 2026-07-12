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
import { useNavigate } from '@tanstack/react-router'
import { MarkdownContent, UnderlineTabs, SaveBar, SectionCard, ConfirmDialog, useUnsavedGuard } from '@makinbakin/sdk/components'
import {
  Button, Badge, Input, Textarea, Switch, Label,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { useQueryState, toast } from '@makinbakin/sdk/hooks'
import {
  ArrowLeft, Palette, Rocket, Pencil, Plus, Check, AlertTriangle, ExternalLink,
  Upload, FileText, BookOpen, ImageIcon, Trash2, Sparkles, Info,
} from 'lucide-react'
import type { BrandManifest, PaletteEntry, Completeness } from '../types'

interface DocInfo { name: string; description?: string; bytes: number }
interface DetailResponse { brand: BrandManifest; guidelines: DocInfo[]; lessons: DocInfo[]; fingerprint: string | null; completeness?: Completeness }
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
/** Placeholder hex for a freshly added palette row — a pristine row is dropped on save, not blocked. */
const BLANK_HEX = '#888888'

export function BrandDetail({ brandId, onBack }: { brandId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [tabParam, setTab] = useQueryState('tab', 'overview')
  const tab = TABS.some((t) => t.id === tabParam) ? tabParam : 'overview'

  // ONE staged draft spans every manifest-backed field across tabs (spec §7a):
  // edits mutate `staged`; the SaveBar commits the whole manifest in one PUT.
  const [staged, setStaged] = useState<BrandManifest | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const dirty = staged !== null
  useUnsavedGuard(dirty)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/brands/${brandId}`)
      if (!res.ok) throw new Error(`load failed: ${res.status}`)
      setDetail((await res.json()) as DetailResponse)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [brandId])

  useEffect(() => { void refresh() }, [refresh])

  const stage = useCallback(
    (patch: ManifestPatch) => {
      setStaged((prev) => {
        const base = prev ?? detail?.brand
        return base ? { ...base, ...patch } : prev
      })
    },
    [detail],
  )

  const discard = useCallback(() => {
    setStaged(null)
    setSaveError(null)
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

  const save = useCallback(async () => {
    if (!staged) return
    const cleaned = cleanStaged(staged)
    // Honest validation BEFORE the PUT — invalid rows hold the save.
    if (!cleaned.name.trim()) {
      setSaveError('The brand needs a name.')
      return
    }
    if (cleaned.palette.some((c) => !isHex(c.hex) || !c.name.trim())) {
      setSaveError('Fix the highlighted colors first — every color needs a name and a hex value like #FF5A00.')
      return
    }
    if ((cleaned.terminology ?? []).some((t) => !t.term.trim() || !t.rule.trim())) {
      setSaveError('Every terminology entry needs both the term and its rule.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const { id: _id, createdAt: _c, updatedAt: _u, ...body } = cleaned
      const res = await fetch(`/api/plugins/brands/${brandId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const resBody = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(resBody.error ?? `save failed: ${res.status}`)
      }
      await refresh()
      setStaged(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally { setSaving(false) }
  }, [staged, brandId, refresh])

  /** Every doc opens in the dedicated editor route — never an inline swap (spec §7e). */
  const editDoc = useCallback(
    (kind: DocKind, name: string, create = false) =>
      void navigate({
        to: '/brands/$brandId/docs/$kind/$name',
        params: { brandId, kind, name },
        search: (create ? { create: '1' } : {}) as never,
      }),
    [navigate, brandId],
  )

  const publish = useCallback(async () => {
    const res = await fetch(`/api/plugins/brands/${brandId}/publish`, { method: 'POST' })
    if (res.ok) await refresh()
    else setError(`publish failed: ${res.status}`)
  }, [brandId, refresh])

  if (error && !detail) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="size-3.5" /> Brands</Button>
        <p className="mt-3 text-sm text-destructive">{error}</p>
      </div>
    )
  }
  if (!detail) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>

  // Staged edits paint the page live (hero included) — what you see is what Save commits.
  const b = staged ?? detail.brand

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <Button variant="ghost" size="sm" className="w-fit -ml-2 text-muted-foreground" onClick={onBack}>
        <ArrowLeft className="size-3.5" /> Branding
      </Button>

      <PaletteHero brand={b} onPublish={b.draft ? publish : undefined} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <UnderlineTabs tabs={TABS} value={tab} onValueChange={(id) => setTab(id as typeof tab)} />

      {tab === 'overview' && <OverviewTab brand={b} detail={detail} brandId={brandId} onGoTo={setTab} onEditDoc={editDoc} />}

      {tab === 'identity' && (
        <div className="grid gap-4 lg:grid-cols-2">
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
                <Plus className="size-3.5" /> Add color
              </Button>
            }
          >
            {b.palette.length === 0 && (
              <p className="text-sm text-muted-foreground">No colors yet — without a palette, image tools have no brand colors to follow.</p>
            )}
            {b.palette.map((c, i) => {
              const hexInvalid = c.hex.trim() !== '' && c.hex !== BLANK_HEX && !isHex(c.hex)
              const update = (next: PaletteEntry) => stage({ palette: b.palette.map((row, j) => (j === i ? next : row)) })
              return (
                <div key={i} data-palette-row={i}>
                  <div className="flex items-center gap-2">
                    {/* Swatch and hex field are two views of ONE value — either edits both. */}
                    <input
                      type="color"
                      aria-label={`${c.name || 'color'} swatch`}
                      value={isHex(c.hex) ? c.hex : '#000000'}
                      onChange={(e) => update({ ...c, hex: e.target.value })}
                      className="h-8 w-10 shrink-0 cursor-pointer rounded-md bg-transparent"
                    />
                    <Input className="w-32" placeholder="Primary" aria-label="Color name" value={c.name} onChange={(e) => update({ ...c, name: e.target.value })} />
                    <Input
                      className={`w-28 font-mono ${hexInvalid ? 'ring-1 ring-destructive' : ''}`}
                      aria-label="Hex value"
                      aria-invalid={hexInvalid || undefined}
                      value={c.hex}
                      onChange={(e) => update({ ...c, hex: e.target.value })}
                    />
                    <Input className="flex-1" placeholder="buttons, links, calls-to-action" aria-label="Where it's used" value={c.usage ?? ''} onChange={(e) => update({ ...c, usage: e.target.value || undefined })} />
                    <RemoveBtn onClick={() => stage({ palette: b.palette.filter((_, j) => j !== i) })} />
                  </div>
                  {hexInvalid && <p className="mt-1 pl-12 text-xs text-destructive">Hex colors look like #FF5A00</p>}
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
                <Plus className="size-3.5" /> Add rule
              </Button>
            }
          >
            {(b.rules ?? []).length === 0 && <p className="text-sm text-muted-foreground">No rules yet — e.g. "Never use exclamation marks in headlines."</p>}
            {(b.rules ?? []).map((r, i) => (
              <div key={i} className="flex items-center gap-2">
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
                <Plus className="size-3.5" /> Add term
              </Button>
            }
          >
            {(b.terminology ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nothing yet — e.g. "workspace", never "dashboard".</p>}
            {(b.terminology ?? []).map((t, i) => (
              <div key={i} className="flex items-center gap-2">
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
        />
      )}

      {tab === 'assets' && <BrandAssetsSection brand={b} onSave={stage} />}

      {tab === 'settings' && (
        <div className="flex flex-col gap-4">
          {b.draft && (
            <Section label="Draft" icon={Rocket}>
              <p className="text-sm text-muted-foreground">
                Invisible to task pickers, dispatch, and image tools until published. Review the sections,
                then publish. Delete <code className="rounded bg-surface px-1 text-xs">_intake.md</code> under
                Guidelines if you don't want the builder intake kept.
              </p>
              <Button variant="default" size="sm" className="w-fit" onClick={() => void publish()}>
                <Rocket className="size-3.5" /> Publish brand
              </Button>
            </Section>
          )}
          {b.source && (
            <Section label="Source" icon={ExternalLink}>
              <p className="text-sm text-muted-foreground">
                Imported from <span className="font-mono text-foreground/80">{b.source.repo}</span>
                {b.source.commit ? ` @ ${b.source.commit.slice(0, 8)}` : ''}. Check for upstream drift:
                <code className="ml-1 rounded bg-surface px-1 text-xs">bakin brands check {b.id}</code>
              </p>
            </Section>
          )}
          <BrandHealthSection brandId={b.id} onDeleted={onBack} />
        </div>
      )}

      {/* ONE save path for the whole manifest — appears whenever anything is staged. */}
      <SaveBar
        dirty={dirty}
        saving={saving}
        error={saveError}
        saveLabel="Save brand"
        onSave={() => void save()}
        onDiscard={discard}
      />
    </div>
  )
}

// ─── Shared shells ────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-md bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none ring-1 ring-inset ring-outline-variant/30 transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60'

/** Elevated surface panel — the primary grouping device (no hard borders). */
function Section({
  label, icon: Icon, action, children, className,
}: {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl bg-card p-4 ring-1 ring-foreground/10 ${className ?? ''}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          {Icon && <Icon className="size-3.5" />}
          <h3 className="text-[11px] font-medium uppercase tracking-wider">{label}</h3>
        </div>
        {action}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-bright hover:text-destructive" onClick={onClick} aria-label="Remove">
      <Trash2 className="size-3.5" />
    </button>
  )
}

// ─── Hero: the brand paints its own header ────────────────────────────────────

function PaletteHero({ brand, onPublish }: { brand: BrandManifest; onPublish?: () => void }) {
  const colors = brand.palette.filter((c) => isHex(c.hex))
  const primary = colors[0]?.hex
  const logo = brand.logos.find((l) => l.variant === 'primary') ?? brand.logos[0]
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-foreground/10">
      {/* Proportioned palette band — primary widest; muted when empty. */}
      <div className="flex h-20 motion-safe:transition-all" aria-hidden={colors.length === 0}>
        {colors.length > 0 ? colors.map((c, i) => (
          <div key={`${c.name}-${i}`} title={`${c.name} ${c.hex}${c.usage ? ` — ${c.usage}` : ''}`} style={{ backgroundColor: c.hex, flexGrow: colors.length - i }} />
        )) : (
          <div className="flex w-full items-center justify-center bg-surface-container text-xs text-muted-foreground">
            No palette yet — add colors under Identity so image tools have brand colors to follow
          </div>
        )}
      </div>
      {/* Identity panel, ambient-tinted by the primary color. */}
      <div
        className="flex flex-wrap items-start justify-between gap-4 bg-card p-5"
        style={primary ? { background: `linear-gradient(115deg, color-mix(in oklab, ${primary} 12%, var(--card)) 0%, var(--card) 55%)` } : undefined}
      >
        <div className="flex min-w-0 items-start gap-4">
          {logo && (
            <img
              src={`/api/assets/${logo.assetId}`}
              alt={`${brand.name} logo`}
              className="size-14 shrink-0 rounded-xl bg-background/40 object-contain p-1.5 ring-1 ring-foreground/10"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">{brand.name}</h1>
              <span className="font-mono text-xs text-muted-foreground">{brand.id}</span>
              {brand.draft
                ? <Badge className="bg-accent/15 text-accent">Draft</Badge>
                : <Badge className="bg-success/15 text-success"><Check className="size-3" /> Published</Badge>}
              {brand.source && <Badge variant="secondary" className="gap-1 text-muted-foreground"><ExternalLink className="size-3" /> imported</Badge>}
            </div>
            {brand.description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{brand.description}</p>}
          </div>
        </div>
        {onPublish && (
          <Button variant="default" size="sm" className="shrink-0" onClick={onPublish}>
            <Rocket className="size-3.5" /> Publish brand
          </Button>
        )}
      </div>
    </div>
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

  const checklist = [
    { ok: detail.guidelines.some((d) => d.name === 'voice.md'), label: 'Voice doc', gap: 'agents get only palette + rules, not how the brand talks', tab: 'guidelines' },
    { ok: brand.palette.length > 0, label: 'Palette', gap: 'image generation has no brand colors to follow', tab: 'identity' },
    { ok: (brand.rules?.length ?? 0) > 0, label: 'Rules', gap: 'no non-negotiables ride every dispatch', tab: 'identity' },
    { ok: brand.logos.length > 0 || brand.assetGroups.length > 0, label: 'Brand assets', gap: 'no real logos/screenshots for agents to reference', tab: 'assets' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CardFootprintTile card={card} />
        <StatTile icon={FileText} label="Guidelines" value={detail.guidelines.length} sub="docs" onClick={() => onGoTo('guidelines')} />
        <StatTile icon={BookOpen} label="Lessons" value={detail.lessons.length} sub="banked" onClick={() => onGoTo('lessons')} />
        <StatTile icon={ImageIcon} label="Assets" value={assetCount} sub={`${brand.assetGroups.length} group(s)`} onClick={() => onGoTo('assets')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Section
          label="Voice" icon={Sparkles}
          action={
            <Button
              variant="ghost" size="xs" className="text-muted-foreground"
              onClick={() => onEditDoc('guidelines', 'voice.md', voice === null)}
            >
              <Pencil className="size-3" /> Edit voice
            </Button>
          }
        >
          {voice === null
            ? <p className="text-sm text-muted-foreground">No voice.md yet — the biggest lever on how on-brand output reads.</p>
            : <div className="prose-invert max-h-56 max-w-none overflow-hidden text-sm [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"><MarkdownContent content={voice} /></div>}
        </Section>

        <Section
          label="Rules & terminology" icon={AlertTriangle}
          action={<Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onGoTo('identity')}><Pencil className="size-3" /> Edit</Button>}
        >
          {(brand.rules?.length ?? 0) === 0 && (brand.terminology?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">None set — rules and terms ride every dispatch inline.</p>
          )}
          {brand.rules?.map((r) => (
            <div key={r} className="flex gap-2 text-sm"><span className="text-accent">›</span><span>{r}</span></div>
          ))}
          {brand.terminology?.map((t) => (
            <div key={t.term} className="text-sm"><span className="font-medium">{t.term}</span> <span className="text-muted-foreground">— {t.rule}</span></div>
          ))}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section label="Setup" icon={Check}>
          {checklist.map((c) => (
            <button key={c.label} className="flex w-full items-start gap-2.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-surface-bright/50" onClick={() => onGoTo(c.tab)}>
              {c.ok ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />}
              <span className="text-sm">
                <span className={c.ok ? '' : 'text-warning'}>{c.label}</span>
                {!c.ok && <span className="text-muted-foreground"> — {c.gap}</span>}
              </span>
            </button>
          ))}
        </Section>

        <Section label="Recent activity" icon={Rocket}>
          {activity.length === 0
            ? <p className="text-sm text-muted-foreground">No activity yet. Brand edits, imports, and dispatch injections show up here.</p>
            : activity.slice(0, 8).map((a, i) => (
              <div key={`${a.ts}-${i}`} className="flex items-baseline justify-between gap-2 text-sm">
                <span>{activityLabel(a)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{relTime(a.ts)}</span>
              </div>
            ))}
        </Section>
      </div>
    </div>
  )
}

function CardFootprintTile({ card }: { card: CardPreview | null }) {
  if (!card) return <StatTile icon={Sparkles} label="Card footprint" value="—" sub="per dispatch" />
  const kb = card.cardBytes / 1024
  const maxKb = card.maxBytes / 1024
  const pct = Math.min(100, (card.cardBytes / card.maxBytes) * 100)
  const tight = pct > 85
  return (
    <div className="rounded-xl bg-card p-3.5 ring-1 ring-foreground/10">
      <div className="flex items-center gap-1.5 text-muted-foreground"><Sparkles className="size-3.5" /><p className="text-[11px] uppercase tracking-wider">Card footprint</p></div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{kb.toFixed(1)}<span className="text-sm font-normal text-muted-foreground"> / {maxKb.toFixed(0)} KB</span></p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
        <div className={`h-full rounded-full transition-all ${tight ? 'bg-warning' : 'bg-success'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{card.omitted > 0 ? `${card.omitted} omitted for size` : 'nothing omitted'}</p>
    </div>
  )
}

function StatTile({ icon: Icon, label, value, sub, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; sub?: string; onClick?: () => void }) {
  const Cmp = onClick ? 'button' : 'div'
  return (
    <Cmp className={`rounded-xl bg-card p-3.5 text-left ring-1 ring-foreground/10 transition-all ${onClick ? 'hover:bg-surface-bright/40 hover:ring-foreground/20' : ''}`} onClick={onClick}>
      <div className="flex items-center gap-1.5 text-muted-foreground"><Icon className="size-3.5" /><p className="text-[11px] uppercase tracking-wider">{label}</p></div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </Cmp>
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
  kind, docs, brand, brandId, guidelines, onEditDoc, onDeleted, onToggleCardDoc,
}: {
  kind: DocKind
  docs: DocInfo[]
  brand: BrandManifest
  brandId: string
  guidelines: DocInfo[]
  onEditDoc: (kind: DocKind, name: string, create?: boolean) => void
  onDeleted: () => void
  onToggleCardDoc: (name: string, on: boolean) => void
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
          <Plus className="size-3.5" /> New {copy.noun}
        </Button>
      }
    >
      <div className="space-y-1">
        {docs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No {copy.title.toLowerCase()} yet — create one and the editor opens on a fresh page.
          </p>
        )}
        {docs.map((d) => (
          <div key={d.name} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-foreground/5" data-doc-row={d.name}>
            <button className="flex min-w-0 items-center gap-1.5 text-left" onClick={() => onEditDoc(kind, d.name)}>
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-sm">{d.name}</span>
            </button>
            {d.description && <span className="min-w-0 truncate text-xs text-muted-foreground">{d.description}</span>}
            <div className="ml-auto flex shrink-0 items-center gap-3">
              {kind === 'guidelines' && (
                <TooltipProvider delay={200}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Switch
                            checked={cardDocs.includes(d.name)}
                            onCheckedChange={(on: boolean) => onToggleCardDoc(d.name, on)}
                            aria-label={`Always include ${d.name} in agent context`}
                          />
                          Always in context
                          <Info className="size-3" />
                        </label>
                      }
                    />
                    <TooltipContent side="top" className="max-w-64">
                      Included verbatim in every branded task's context (within the size budget). Leave off to keep
                      context small — agents can still fetch the doc on demand.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onEditDoc(kind, d.name)}>
                <Pencil className="size-3" /> Edit
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setDeleting(d.name)}
                aria-label={`Delete ${d.name}`}
              >
                <Trash2 className="size-3" />
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
        <DialogContent className="bg-card border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New {copy.noun}</DialogTitle>
            <DialogDescription>Name the file — the editor opens on a fresh page and the first save creates it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
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
            <p className="text-[11px] text-muted-foreground">.md is added for you{newDocName.trim() && !newDocName.trim().endsWith('.md') ? ` — creates ${newDocName.trim()}.md` : ''}</p>
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
const TYPE_ICON: Record<string, string> = { images: '🖼', pdf: '📄', video: '▷', audio: '♪', text: '¶', data: '⊞' }

function BrandAssetsSection({ brand, onSave }: { brand: BrandManifest; onSave: (patch: ManifestPatch) => void }) {
  const [assets, setAssets] = useState<Record<string, AssetInfo>>({})
  const [options, setOptions] = useState<AssetInfo[]>([])
  const [groupDraft, setGroupDraft] = useState<{ name: string; description: string } | null>(null)

  const loadAssets = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/assets/versioned')
      if (!res.ok) return
      const body = (await res.json()) as { assets?: Array<{ assetId: string; description?: string; type?: string; hasThumb?: boolean }> }
      const list = (body.assets ?? []).map((a) => ({ assetId: a.assetId, description: a.description ?? '', type: a.type ?? 'other', hasThumb: !!a.hasThumb }))
      setOptions(list)
      setAssets(Object.fromEntries(list.map((a) => [a.assetId, a])))
    } catch { /* picker degrades to manual entry when the assets plugin is unreachable */ }
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

  const addAsset = (onPick: (assetId: string) => void) => <AddAsset options={options} onAdd={onPick} onUploaded={loadAssets} />
  const tile = (assetId: string, onRemove: () => void, extra?: React.ReactNode) => (
    <AssetTile key={assetId} info={assets[assetId]} assetId={assetId} onDescription={(d) => void saveDescription(assetId, d)} onRemove={onRemove} extra={extra} />
  )

  return (
    <Section label="Brand assets" icon={ImageIcon} action={<span className="max-w-md text-right text-[11px] text-muted-foreground">Real logos + screenshots agents reference. Add a note so agents know how to use each one.</span>}>
      <div className="space-y-5">
        <div className="space-y-2">
          <SubLabel>Logos</SubLabel>
          {brand.logos.map((logo, i) => tile(
            logo.assetId,
            () => onSave({ logos: brand.logos.filter((_, j) => j !== i) }),
            <input className={`${inputCls} w-24 py-1 text-[11px]`} value={logo.variant} title="variant (e.g. dark, light, primary)" onChange={(e) => onSave({ logos: brand.logos.map((l, j) => (j === i ? { ...l, variant: e.target.value } : l)) })} />,
          ))}
          {addAsset((assetId) => onSave({ logos: [...brand.logos, { assetId, variant: 'primary' }] }))}
        </div>

        <div className="space-y-2">
          <SubLabel>Asset groups</SubLabel>
          {brand.assetGroups.map((group, gi) => (
            <div key={group.name} className="space-y-2 rounded-lg bg-surface p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{group.name}</span>
                {group.description && <span className="text-xs text-muted-foreground">— {group.description}</span>}
                <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => onSave({ assetGroups: brand.assetGroups.filter((_, j) => j !== gi) })}>
                  Remove group
                </Button>
              </div>
              {group.assetIds.map((assetId) => tile(
                assetId,
                () => onSave({ assetGroups: brand.assetGroups.map((g, j) => (j === gi ? { ...g, assetIds: g.assetIds.filter((id) => id !== assetId) } : g)) }),
              ))}
              {addAsset((assetId) => onSave({ assetGroups: brand.assetGroups.map((g, j) => (j === gi && !g.assetIds.includes(assetId) ? { ...g, assetIds: [...g.assetIds, assetId] } : g)) }))}
            </div>
          ))}
          {groupDraft ? (
            <div className="flex items-center gap-2 rounded-lg bg-surface p-2">
              <input className={`${inputCls} w-40`} placeholder="group name" value={groupDraft.name} onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })} />
              <input className={`${inputCls} flex-1`} placeholder="usage note, e.g. real product UI — use for any product visual" value={groupDraft.description} onChange={(e) => setGroupDraft({ ...groupDraft, description: e.target.value })} />
              <Button variant="default" size="sm" disabled={!groupDraft.name.trim()} onClick={() => { onSave({ assetGroups: [...brand.assetGroups, { name: groupDraft.name.trim(), description: groupDraft.description.trim() || undefined, assetIds: [] }] }); setGroupDraft(null) }}>Add</Button>
              <Button variant="ghost" size="sm" onClick={() => setGroupDraft(null)}>Cancel</Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setGroupDraft({ name: '', description: '' })}><Plus className="size-3.5" /> New group</Button>
          )}
        </div>

        <div className="space-y-2">
          <SubLabel>Default image references <span className="normal-case text-muted-foreground/70">(≤4)</span></SubLabel>
          {(brand.defaultImageReferences ?? []).map((assetId) => tile(
            assetId,
            () => onSave({ defaultImageReferences: (brand.defaultImageReferences ?? []).filter((id) => id !== assetId) }),
          ))}
          {(brand.defaultImageReferences ?? []).length < 4 && addAsset((assetId) => {
            const current = brand.defaultImageReferences ?? []
            if (!current.includes(assetId)) onSave({ defaultImageReferences: [...current, assetId] })
          })}
        </div>
      </div>
    </Section>
  )
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{children}</p>
}

/** Upload a new asset (button or drag-drop) OR pick an already-uploaded one. */
function AddAsset({ options, onAdd, onUploaded }: { options: AssetInfo[]; onAdd: (assetId: string) => void; onUploaded: () => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = useCallback(async (file: File) => {
    setBusy(true); setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/plugins/assets/upload', { method: 'POST', body: form })
      const body = (await res.json().catch(() => ({}))) as { assetId?: string; error?: string }
      if (!res.ok || !body.assetId) throw new Error(body.error ?? 'Upload failed')
      await onUploaded()
      onAdd(body.assetId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }, [onAdd, onUploaded])

  return (
    <div className="max-w-md space-y-1">
      <div
        className={`flex items-center gap-2 rounded-lg p-1.5 transition-colors ${over ? 'bg-accent/10 ring-2 ring-accent/40' : 'bg-surface ring-1 ring-inset ring-outline-variant/30'}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) void upload(f) }}
      >
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="size-3.5" /> {busy ? 'Uploading…' : 'Upload image'}
        </Button>
        <span className="text-[11px] text-muted-foreground">or drag one here</span>
        <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => setPickOpen((v) => !v)}>Choose existing</Button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      {pickOpen && (
        <select className={`${inputCls} w-full`} value="" onChange={(e) => { if (e.target.value) { onAdd(e.target.value); setPickOpen(false) } }}>
          <option value="">Choose an already-uploaded asset…</option>
          {options.map((o) => <option key={o.assetId} value={o.assetId}>{o.description ? o.description.slice(0, 50) : o.assetId} ({o.type})</option>)}
        </select>
      )}
    </div>
  )
}

/** A referenced asset: thumbnail (click → opens the asset viewer), editable meta note, remove. */
function AssetTile({
  assetId, info, onDescription, onRemove, extra,
}: {
  assetId: string; info?: AssetInfo; onDescription: (description: string) => void; onRemove: () => void; extra?: React.ReactNode
}) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(info?.description ?? '')
  const isImage = info?.type === 'images'
  const open = () => navigate({ to: '/assets/$assetId', params: { assetId } })
  const commit = () => { setEditing(false); if (draft !== (info?.description ?? '')) onDescription(draft) }

  return (
    <div className="flex items-start gap-3 rounded-lg bg-surface p-2.5 transition-colors hover:bg-surface-bright/40">
      <button className="size-14 shrink-0 overflow-hidden rounded-lg bg-background/50 ring-1 ring-foreground/10 transition-shadow hover:ring-foreground/25" title="Open in the asset viewer" onClick={open}>
        {isImage && info?.hasThumb
          ? <img src={`/api/assets/${assetId}/thumb`} alt="" className="size-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
          : <span className="flex size-full items-center justify-center text-lg text-muted-foreground">{TYPE_ICON[info?.type ?? 'other'] ?? '⊟'}</span>}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground" onClick={open}>
            {assetId}<ExternalLink className="size-3 opacity-60" />
          </button>
          {extra}
          <button className="ml-auto shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-bright hover:text-destructive" onClick={onRemove} aria-label="Remove"><Trash2 className="size-3.5" /></button>
        </div>
        {editing ? (
          <input
            autoFocus
            className={`${inputCls} mt-1.5`}
            placeholder="What is this, and how should agents use it? e.g. Billing UI screenshot — documentation only, never marketing"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(info?.description ?? ''); setEditing(false) } }}
          />
        ) : (
          <button className="mt-1.5 flex max-w-full items-center gap-1.5 truncate text-left text-sm" onClick={() => { setDraft(info?.description ?? ''); setEditing(true) }}>
            {info?.description
              ? <span className="truncate text-foreground/90">{info.description} <Pencil className="inline size-3 text-muted-foreground" /></span>
              : <span className="flex items-center gap-1 text-muted-foreground hover:text-foreground"><Plus className="size-3" /> add a note (what it is, how agents should use it)</span>}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Settings health ──────────────────────────────────────────────────────────

function BrandHealthSection({ brandId, onDeleted }: { brandId: string; onDeleted: () => void }) {
  const [cardInfo, setCardInfo] = useState<{ cardBytes: number; maxBytes: number; omitted: number } | null>(null)
  const [dangling, setDangling] = useState<Array<{ assetId: string; where: string }>>([])
  const [deleteState, setDeleteState] = useState<{ linked: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    })()
  }, [brandId])

  return (
    <Section label="Dispatch footprint & health" icon={Sparkles}>
      {cardInfo && (
        <p className="text-sm text-muted-foreground">
          This brand's card adds ~{(cardInfo.cardBytes / 1024).toFixed(1)} KB of the {(cardInfo.maxBytes / 1024).toFixed(0)} KB budget to every branded dispatch
          {cardInfo.omitted > 0 ? ` — ${cardInfo.omitted} item(s) currently omitted for size (agents fetch them via tools).` : ' — nothing currently omitted.'}
        </p>
      )}
      {dangling.length > 0 && (
        <div className="rounded-lg bg-warning/10 p-3 ring-1 ring-warning/20">
          {dangling.map((d) => <p key={d.assetId} className="flex items-center gap-1.5 text-xs text-warning"><AlertTriangle className="size-3" /> asset {d.assetId} missing ({d.where})</p>)}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {deleteState === null ? (
        <Button
          variant="ghost" size="sm" className="w-fit text-red-400 hover:bg-destructive/10 hover:text-red-400"
          onClick={async () => {
            let linked = 0
            try {
              const res = await fetch('/api/plugins/tasks/')
              if (res.ok) {
                const board = (await res.json()) as { columns?: Record<string, Array<{ brandId?: string }>> }
                for (const [column, tasks] of Object.entries(board.columns ?? {})) {
                  if (column === 'done' || column === 'archived') continue
                  linked += tasks.filter((t) => t.brandId === brandId).length
                }
              }
            } catch { /* guard is best-effort; the confirm below is the gate */ }
            setDeleteState({ linked })
          }}
        >
          <Trash2 className="size-3.5" /> Delete brand…
        </Button>
      ) : (
        <div className="space-y-2 rounded-lg bg-destructive/5 p-3 ring-1 ring-destructive/20">
          <p className="text-sm text-red-300">
            {deleteState.linked > 0
              ? `${deleteState.linked} pending task(s) link to this brand — they will NOT dispatch until it exists again.`
              : 'No pending tasks link to this brand.'}
            {' '}Guidelines and lessons are deleted; assets stay in the asset store.
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost" size="sm" className="text-red-400 hover:bg-destructive/10 hover:text-red-400"
              onClick={async () => {
                try {
                  const res = await fetch(`/api/plugins/brands/${brandId}`, { method: 'DELETE' })
                  if (!res.ok) throw new Error(`delete failed: ${res.status}`)
                  onDeleted()
                } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
              }}
            >
              <Trash2 className="size-3.5" /> Delete permanently
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleteState(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </Section>
  )
}

