/**
 * Build-my-brand wizard (#419) — a guided drawer that walks through brand
 * setup step by step instead of dumping a form into the page. Collects the
 * raw material (incl. an optional logo, uploaded as a managed asset), creates
 * a DRAFT brand, and dispatches the drafting agent to author the rest.
 */
import { useCallback, useMemo, useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { useFileDrop } from '@makinbakin/sdk/hooks'
import { AgentSelect, StatusBadge } from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Drawer,
  DrawerSection,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Form,
  FormActions,
  Input,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { useBrandAgentOptions } from './use-brand-agent-options'

interface Answers {
  name: string
  product: string
  audience: string
  tone: string
  competitors: string
  urls: string
  notes: string
  agent: string
}

const EMPTY: Answers = { name: '', product: '', audience: '', tone: '', competitors: '', urls: '', notes: '', agent: '' }

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)

const STEPS = ['Basics', 'Voice', 'Logo', 'Review'] as const
type Step = number

export function BrandBuilder({
  open, onOpenChange, onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** taskId = the dispatched drafting task, so the detail page can link it in the drafting banner. */
  onCreated: (brandId: string, taskId?: string) => void
}) {
  const agentOptions = useBrandAgentOptions()
  const [step, setStep] = useState<Step>(0)
  const [a, setA] = useState<Answers>(EMPTY)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  // Up to 3 brand materials (PDF, screenshots — anything carrying the real
  // colors/type) the drafting agent mines for palette and style.
  const [materials, setMaterials] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => setA((prev) => ({ ...prev, [k]: v }))
  const id = useMemo(() => slugify(a.name), [a.name])
  const dirty = logoFile !== null || materials.length > 0 || (Object.keys(a) as Array<keyof Answers>).some((k) => a[k] !== EMPTY[k])

  const reset = useCallback(() => {
    setStep(0); setA(EMPTY); setLogoFile(null); setMaterials([])
    setLogoPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    setError(null)
  }, [])

  const close = useCallback(() => { reset(); onOpenChange(false) }, [reset, onOpenChange])

  const pickLogo = useCallback((file: File | null) => {
    setLogoPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return file ? URL.createObjectURL(file) : null })
    setLogoFile(file)
  }, [])

  // Per-step gating.
  const canNext = step === 0 ? a.name.trim().length > 0 && a.product.trim().length > 0 : true
  const canCreate = a.name.trim().length > 0 && a.product.trim().length > 0 && a.agent.length > 0

  const create = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      // 1. Upload the logo + brand materials so we have managed assetIds to attach.
      const uploadOne = async (file: File, description: string): Promise<string> => {
        const form = new FormData()
        form.append('file', file)
        form.append('description', description)
        const up = await fetch('/api/plugins/assets/upload', { method: 'POST', body: form })
        const upBody = (await up.json().catch(() => ({}))) as { assetId?: string; error?: string }
        if (!up.ok || !upBody.assetId) throw new Error(upBody.error ?? `Upload failed: ${file.name}`)
        return upBody.assetId
      }
      const logoAssetId = logoFile ? await uploadOne(logoFile, `${a.name.trim()} logo`) : undefined
      const materialAssetIds: string[] = []
      for (const file of materials.slice(0, 3)) {
        materialAssetIds.push(await uploadOne(file, `${a.name.trim()} brand material — ${file.name}`))
      }
      // 2. Create the draft + dispatch the drafting agent.
      const res = await fetch('/api/plugins/brands/builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: a.name.trim(),
          agent: a.agent,
          product: a.product.trim(),
          audience: a.audience.trim() || undefined,
          tone: a.tone.trim() || undefined,
          competitors: a.competitors.trim() || undefined,
          urls: a.urls.trim() || undefined,
          notes: a.notes.trim() || undefined,
          logoAssetId,
          materialAssetIds: materialAssetIds.length > 0 ? materialAssetIds : undefined,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { brand?: { id: string }; taskId?: string; error?: string }
      if (!res.ok || !body.brand) throw new Error(body.error ?? `Create failed: ${res.status}`)
      onCreated(body.brand.id, body.taskId)
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [a, id, logoFile, materials, onCreated, close])

  // Disabled primary actions explain themselves (spec §7i).
  const nextBlockedReason = !canNext ? 'Name and what-you-sell are needed first — the agent grounds everything in them.' : null
  const createBlockedReason = !canCreate
    ? !a.name.trim() || !a.product.trim()
      ? 'Name and what-you-sell are needed first.'
      : 'Choose which agent drafts the brand.'
    : null

  const gatedButton = (
    label: React.ReactNode,
    disabled: boolean,
    reason: string | null,
    onClick: (() => void) | undefined,
    testId: string,
    type: 'button' | 'submit' = 'button',
  ) => {
    const btn = (
      <Button type={type} size="sm" onClick={onClick} disabled={disabled} data-testid={testId}>
        {label}
      </Button>
    )
    if (!disabled || !reason) return btn
    return (
      <TooltipProvider delay={200}>
        <Tooltip>
          {/* A disabled button swallows pointer events — the wrapper carries the tooltip. */}
          <TooltipTrigger render={<span className="inline-flex">{btn}</span>} />
          <TooltipContent side="top">{reason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const footer = (
    <FormActions align="between" className="sticky bottom-0 z-10 bg-bakin-surface-default pb-bakin-1">
      <span className="text-bakin-typography-size-meta text-bakin-text-muted">
        Step {step + 1} of {STEPS.length}
      </span>
      <div className="flex min-w-0 gap-bakin-2">
        {step > 0 && (
          <Button variant="outline" size="sm" onClick={() => setStep((s) => s - 1)} disabled={busy}>
            Back
          </Button>
        )}
        {step < STEPS.length - 1
          ? gatedButton('Next', !canNext, nextBlockedReason, () => setStep((s) => s + 1), 'builder-next')
          : gatedButton(
              busy ? <><Loader2 className="animate-spin motion-reduce:animate-none" /> Creating…</> : 'Create draft',
              !canCreate || busy,
              createBlockedReason,
              undefined,
              'builder-create',
              'submit',
            )}
      </div>
    </FormActions>
  )

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => { if (!o) close() }}
      title="Build my brand"
      description="Answer a few questions — an agent drafts the whole brand (voice, style guide, palette, rules) as a draft you review and publish."
      dirty={dirty}
      busy={busy}
      storageKey="brand-builder"
    >
      <Form
        aria-label="Build my brand"
        busy={busy}
        onSubmit={(event) => {
          event.preventDefault()
          if (step === STEPS.length - 1 && canCreate && !busy) void create()
        }}
      >
        <ol
          aria-label="Brand creation progress"
          className="grid grid-cols-4 gap-bakin-2"
        >
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === step ? 'step' : undefined}
              data-state={i < step ? 'complete' : i === step ? 'current' : 'upcoming'}
              className={[
                'flex min-w-0 items-center gap-bakin-2 border-t-2 pt-bakin-2',
                i <= step ? 'border-bakin-signal-accent text-bakin-text-primary' : 'border-bakin-border-subtle text-bakin-text-muted',
              ].join(' ')}
            >
              <span className="font-bakin-typography-family-mono text-bakin-typography-size-meta">
                {i + 1}
              </span>
              <span className="min-w-0 truncate text-bakin-typography-size-meta font-bakin-typography-weight-semibold">
                {s}
              </span>
            </li>
          ))}
        </ol>

        {error ? (
          <Alert tone="danger">
            <AlertTitle>Brand draft could not be created</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {step === 0 && (
          <DrawerSection title="Basics" contentClassName="px-0 sm:px-bakin-2">
            <FieldGroup>
            <Field name="name">
              <FieldLabel htmlFor="builder-name" requirement="required">Brand name</FieldLabel>
              <FieldDescription>What the brand is called.</FieldDescription>
              <Input id="builder-name" required placeholder="e.g. Acme" value={a.name} onChange={(e) => set('name', e.target.value)} autoFocus />
              {a.name.trim() && (
                <p className="font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
                  id: {id}
                </p>
              )}
            </Field>
            <Field name="product">
              <FieldLabel htmlFor="builder-product" requirement="required">What do you sell?</FieldLabel>
              <FieldDescription>One line grounds the brand voice and positioning.</FieldDescription>
              <Textarea id="builder-product" required rows={3} placeholder="e.g. Warm bakery-management software for independent bakers" value={a.product} onChange={(e) => set('product', e.target.value)} />
            </Field>
            </FieldGroup>
          </DrawerSection>
        )}

        {step === 1 && (
          <DrawerSection title="Voice" contentClassName="px-0 sm:px-bakin-2">
            <FieldGroup>
            <Field name="audience">
              <FieldLabel htmlFor="builder-audience" requirement="optional">Audience</FieldLabel>
              <FieldDescription>Who reads this, and what do they already know?</FieldDescription>
              <Input id="builder-audience" placeholder="e.g. independent bakery owners, not enterprise buyers" value={a.audience} onChange={(e) => set('audience', e.target.value)} />
            </Field>
            <Field name="tone">
              <FieldLabel htmlFor="builder-tone" requirement="optional">Three tone words</FieldLabel>
              <FieldDescription>How the brand should sound.</FieldDescription>
              <Input id="builder-tone" placeholder="e.g. warm, direct, a little irreverent" value={a.tone} onChange={(e) => set('tone', e.target.value)} />
            </Field>
            <Field name="competitors">
              <FieldLabel htmlFor="builder-competitors" requirement="optional">Competitors</FieldLabel>
              <FieldDescription>Brands this kit should sound distinct from.</FieldDescription>
              <Input id="builder-competitors" placeholder="e.g. Toast, Square" value={a.competitors} onChange={(e) => set('competitors', e.target.value)} />
            </Field>
            </FieldGroup>
          </DrawerSection>
        )}

        {step === 2 && (
          <DrawerSection title="Sources" contentClassName="px-0 sm:px-bakin-2">
            <FieldGroup>
            <Field name="logo">
              <FieldLabel requirement="optional">Logo</FieldLabel>
              <FieldDescription>Shown on the brand dashboard and available to agents as a reference. PNG, SVG, or JPG.</FieldDescription>
              <LogoDrop preview={logoPreview} fileName={logoFile?.name ?? null} onPick={pickLogo} />
            </Field>
            <Field name="materials">
              <FieldLabel requirement="optional">Brand materials</FieldLabel>
              <FieldDescription>Up to three PDFs or images carrying your real colors, type, and style.</FieldDescription>
              <MaterialsDrop files={materials} onChange={setMaterials} />
            </Field>
            <Field name="urls">
              <FieldLabel htmlFor="builder-urls" requirement="optional">Website links</FieldLabel>
              <FieldDescription>The drafting agent mines these for palette, voice, and terminology.</FieldDescription>
              <Input id="builder-urls" placeholder="https://…" value={a.urls} onChange={(e) => set('urls', e.target.value)} />
            </Field>
            <Field name="notes">
              <FieldLabel htmlFor="builder-notes" requirement="optional">Anything else</FieldLabel>
              <FieldDescription>Existing direction or phrases you love or hate.</FieldDescription>
              <Textarea id="builder-notes" rows={3} value={a.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
            </FieldGroup>
          </DrawerSection>
        )}

        {step === 3 && (
          <DrawerSection title="Review" contentClassName="px-0 sm:px-bakin-2">
            <div className="grid gap-bakin-4">
            <Card size="sm">
              <CardHeader>
                <CardTitle>{a.name || 'Untitled'}</CardTitle>
                <CardDescription className="font-bakin-typography-family-mono">{id}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-bakin-3">
              {logoPreview
                ? <img src={logoPreview} alt="" className="size-bakin-10 rounded-bakin-control border border-bakin-border-subtle object-contain" />
                : <div className="flex size-bakin-10 items-center justify-center rounded-bakin-control border border-bakin-border-subtle text-bakin-typography-size-meta text-bakin-text-muted">No logo</div>}
                <p className="min-w-0 text-bakin-text-muted">{a.product || 'No product description'}</p>
              </CardContent>
            </Card>
            <dl className="grid gap-bakin-2">
              <ReviewRow label="Audience" value={a.audience} />
              <ReviewRow label="Tone" value={a.tone} />
              <ReviewRow label="Competitors" value={a.competitors} />
              <ReviewRow label="URLs" value={a.urls} />
              <ReviewRow label="Materials" value={materials.map((f) => f.name).join(', ')} />
            </dl>
            <Field name="agent">
              <FieldLabel requirement="required">Which agent drafts it?</FieldLabel>
              <FieldDescription>Who authors the first brand draft from these answers.</FieldDescription>
              <AgentSelect
                value={a.agent}
                onValueChange={(v) => set('agent', v)}
                agents={agentOptions}
                placeholder="Choose an agent..."
              />
            </Field>
            <p className="text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
              This creates a <StatusBadge size="xs" tone="accent">Draft</StatusBadge> that stays unavailable to tasks and image tools until you review and publish it.
            </p>
            </div>
          </DrawerSection>
        )}
        {footer}
      </Form>
    </Drawer>
  )
}

/** Up to 3 brand-material files (PDF/screenshots) — chips with remove, drop or browse. */
function MaterialsDrop({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const full = files.length >= 3

  const add = (incoming: FileList | File[] | null) => {
    if (!incoming) return
    const accepted = Array.from(incoming).filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (accepted.length === 0) return
    onChange([...files, ...accepted].slice(0, 3))
  }
  const { dragOver: over, dropProps } = useFileDrop({
    accept: ['image/', 'application/pdf'],
    multiple: true,
    onFiles: add,
  })

  return (
    <div className="grid gap-bakin-2">
      {files.map((f, i) => (
        <div
          key={`${f.name}-${i}`}
          className="flex min-w-0 items-center gap-bakin-2 rounded-bakin-control border border-bakin-border-subtle bg-bakin-surface-default px-bakin-3 py-bakin-2"
        >
          <span className="min-w-0 truncate">{f.name}</span>
          <span className="shrink-0 font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
            {(f.size / 1024).toFixed(0)} KB
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="ml-auto text-bakin-text-muted hover:text-bakin-signal-danger"
            onClick={() => onChange(files.filter((_, j) => j !== i))}
            aria-label={`Remove ${f.name}`}
          >
            <X />
          </Button>
        </div>
      ))}
      {!full && (
        <label
          className={[
            'flex cursor-pointer items-center gap-bakin-2 rounded-bakin-control border border-dashed p-bakin-3',
            'text-bakin-typography-size-meta text-bakin-text-muted transition-colors',
            over ? 'border-bakin-focus-ring bg-bakin-surface-default' : 'border-bakin-border-subtle hover:bg-bakin-surface-default',
          ].join(' ')}
          {...dropProps}
          data-materials-drop
        >
          <ImagePlus className="size-bakin-4 shrink-0" aria-hidden="true" />
          <span>Drop a PDF or image here, or browse ({files.length}/3)</span>
          <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        </label>
      )}
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null
  return (
    <div className="grid min-w-0 grid-cols-3 gap-bakin-3 text-bakin-typography-size-meta">
      <dt className="text-bakin-text-muted">{label}</dt>
      <dd className="col-span-2 min-w-0 break-words text-bakin-text-primary">{value}</dd>
    </div>
  )
}

function LogoDrop({ preview, fileName, onPick }: { preview: string | null; fileName: string | null; onPick: (f: File | null) => void }) {
  const { dragOver: over, dropProps } = useFileDrop({ accept: ['image/'], onFiles: ([f]) => onPick(f) })
  return (
    <div>
      <label
        className={[
          'flex cursor-pointer items-center gap-bakin-3 rounded-bakin-control border border-dashed p-bakin-3 transition-colors',
          over ? 'border-bakin-focus-ring bg-bakin-surface-default' : 'border-bakin-border-subtle hover:bg-bakin-surface-default',
        ].join(' ')}
        {...dropProps}
      >
        {preview
          ? <img src={preview} alt="Logo preview" className="size-bakin-10 rounded-bakin-control border border-bakin-border-subtle object-contain" />
          : <div className="flex size-bakin-10 items-center justify-center rounded-bakin-control border border-bakin-border-subtle text-bakin-text-muted"><ImagePlus aria-hidden="true" className="size-bakin-4" /></div>}
        <div className="min-w-0">
          {fileName
            ? <><p className="truncate font-bakin-typography-weight-semibold">{fileName}</p><p className="text-bakin-typography-size-meta text-bakin-text-muted">Browse or drop to replace</p></>
            : <><p className="font-bakin-typography-weight-semibold">Add a logo</p><p className="text-bakin-typography-size-meta text-bakin-text-muted">Browse or drop an image here</p></>}
        </div>
        <input type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      </label>
      {fileName && (
        <Button type="button" variant="link" size="xs" className="mt-bakin-1 text-bakin-text-muted hover:text-bakin-signal-danger" onClick={() => onPick(null)}>
          Remove logo
        </Button>
      )}
    </div>
  )
}
