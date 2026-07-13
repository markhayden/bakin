/**
 * Build-my-brand wizard (#419) — a guided drawer that walks through brand
 * setup step by step instead of dumping a form into the page. Collects the
 * raw material (incl. an optional logo, uploaded as a managed asset), creates
 * a DRAFT brand, and dispatches the drafting agent to author the rest.
 */
import { useCallback, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { AgentSelect, BakinDrawer } from '@makinbakin/sdk/components'
import { useFileDrop } from '@makinbakin/sdk/hooks'
import { Button, Input, Label, Textarea, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@makinbakin/sdk/ui'

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

  const gatedButton = (label: React.ReactNode, disabled: boolean, reason: string | null, onClick: () => void, testId: string) => {
    const btn = (
      <Button size="sm" onClick={onClick} disabled={disabled} data-testid={testId}>
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
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">Step {step + 1} of {STEPS.length} · {STEPS[step]}</span>
      <div className="flex gap-2">
        {step > 0 && (
          <Button variant="outline" size="sm" onClick={() => setStep((s) => s - 1)} disabled={busy}>
            Back
          </Button>
        )}
        {step < STEPS.length - 1
          ? gatedButton('Next', !canNext, nextBlockedReason, () => setStep((s) => s + 1), 'builder-next')
          : gatedButton(
              busy ? <><Loader2 className="mr-1.5 size-3.5 animate-spin" /> Creating...</> : 'Create draft',
              !canCreate || busy,
              createBlockedReason,
              () => void create(),
              'builder-create',
            )}
      </div>
    </div>
  )

  return (
    <BakinDrawer
      open={open}
      onOpenChange={(o) => { if (!o) close() }}
      title="Build my brand"
      description="Answer a few questions — an agent drafts the whole brand (voice, style guide, palette, rules) as a draft you review and publish."
      actions={footer}
      dirty={dirty}
      storageKey="brand-builder"
    >
      <div className="flex flex-col gap-4 p-1">
        {/* Step rail */}
        <div className="flex gap-1">
          {STEPS.map((s, i) => (
            <div key={s} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-accent' : 'bg-border'}`} title={s} />
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {step === 0 && (
          <div className="space-y-5">
            <Field num={1} label="Brand name" hint="What the brand is called.">
              <Input placeholder="e.g. Acme" value={a.name} onChange={(e) => set('name', e.target.value)} autoFocus />
              {a.name.trim() && <p className="mt-1 text-[11px] text-muted-foreground">id: <span className="font-mono">{id}</span></p>}
            </Field>
            <Field num={2} label="What do you sell?" hint="One line — the agent grounds voice + positioning in this.">
              <Textarea rows={2} placeholder="e.g. Warm bakery-management software for independent bakers" value={a.product} onChange={(e) => set('product', e.target.value)} />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <Field num={1} label="Audience" hint="Who reads this? What do they already know?">
              <Input placeholder="e.g. independent bakery owners, not enterprise buyers" value={a.audience} onChange={(e) => set('audience', e.target.value)} />
            </Field>
            <Field num={2} label="Three tone words" hint="How the brand should sound.">
              <Input placeholder="e.g. warm, direct, a little irreverent" value={a.tone} onChange={(e) => set('tone', e.target.value)} />
            </Field>
            <Field num={3} label="Competitors" hint="Brands to sound distinct from (optional).">
              <Input placeholder="e.g. Toast, Square" value={a.competitors} onChange={(e) => set('competitors', e.target.value)} />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <Field num={1} label="Logo" hint="Shown on the brand dashboard and available to agents as a reference. PNG/SVG/JPG.">
              <LogoDrop preview={logoPreview} fileName={logoFile?.name ?? null} onPick={pickLogo} />
            </Field>
            <Field num={2} label="Brand materials" hint="Up to 3 files with your real branding on them — a PDF, screenshots, a deck slide. The agent mines them for your palette, type, and style (optional).">
              <MaterialsDrop files={materials} onChange={setMaterials} />
            </Field>
            <Field num={3} label="Website URL(s)" hint="The drafting agent reads these to ground the brand in reality — palette, voice, and terminology get mined from them (optional).">
              <Input placeholder="https://..." value={a.urls} onChange={(e) => set('urls', e.target.value)} />
            </Field>
            <Field num={4} label="Anything else" hint="Existing docs, phrases you love or hate — anything that helps (optional).">
              <Textarea rows={3} value={a.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border p-3">
              {logoPreview
                ? <img src={logoPreview} alt="logo" className="h-12 w-12 rounded-md border object-contain" />
                : <div className="flex h-12 w-12 items-center justify-center rounded-md border text-[10px] text-muted-foreground">no logo</div>}
              <div className="min-w-0">
                <p className="font-medium">{a.name || 'Untitled'} <span className="font-mono text-xs text-muted-foreground">{id}</span></p>
                <p className="truncate text-xs text-muted-foreground">{a.product || 'No product description'}</p>
              </div>
            </div>
            <ReviewRow label="Audience" value={a.audience} />
            <ReviewRow label="Tone" value={a.tone} />
            <ReviewRow label="Competitors" value={a.competitors} />
            <ReviewRow label="URLs" value={a.urls} />
            <ReviewRow label="Materials" value={materials.map((f) => f.name).join(', ')} />
            <Field label="Which agent drafts it?" hint="Who authors the brand from your answers.">
              <AgentSelect value={a.agent} onValueChange={(v) => set('agent', v)} placeholder="Choose an agent..." />
            </Field>
            <p className="text-xs text-muted-foreground">
              This creates a <span className="text-fuchsia-400">draft</span> (invisible to tasks + image tools) and dispatches {a.agent || 'the agent'} to
              author voice, palette, rules, and terminology. Review and publish it on the brand page when done.
            </p>
          </div>
        )}
      </div>
    </BakinDrawer>
  )
}

function Field({ num, label, hint, children }: { num?: number; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="block border-t border-border/60 pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-2.5">
        {num !== undefined && (
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-medium text-muted-foreground">
            {num}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <Label className="text-sm font-medium">{label}</Label>
          {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
          <div className="mt-2">{children}</div>
        </div>
      </div>
    </div>
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
    <div className="space-y-1.5">
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-foreground/5 px-2.5 py-1.5 text-sm">
          <span className="min-w-0 truncate">{f.name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
          <button
            className="ml-auto shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-destructive"
            onClick={() => onChange(files.filter((_, j) => j !== i))}
            aria-label={`Remove ${f.name}`}
          >
            ✕
          </button>
        </div>
      ))}
      {!full && (
        <label
          className={`flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground transition-colors ${over ? 'border-foreground/40 bg-foreground/5' : 'hover:border-foreground/30'}`}
          {...dropProps}
          data-materials-drop
        >
          <span>＋ Drop a PDF or screenshot here, or click to browse ({files.length}/3)</span>
          <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        </label>
      )}
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  )
}

function LogoDrop({ preview, fileName, onPick }: { preview: string | null; fileName: string | null; onPick: (f: File | null) => void }) {
  const { dragOver: over, dropProps } = useFileDrop({ accept: ['image/'], onFiles: ([f]) => onPick(f) })
  return (
    <div>
      <label
        className={`flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 transition-colors ${over ? 'border-foreground/40 bg-foreground/5' : 'hover:border-foreground/30'}`}
        {...dropProps}
      >
        {preview
          ? <img src={preview} alt="logo preview" className="h-14 w-14 rounded-md border object-contain" />
          : <div className="flex h-14 w-14 items-center justify-center rounded-md border text-xl text-muted-foreground">＋</div>}
        <div className="min-w-0 text-sm">
          {fileName
            ? <><p className="truncate font-medium">{fileName}</p><p className="text-[11px] text-muted-foreground">Click or drop to replace</p></>
            : <><p className="font-medium">Add a logo</p><p className="text-[11px] text-muted-foreground">Click to browse or drop an image here</p></>}
        </div>
        <input type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      </label>
      {fileName && (
        <button className="mt-1 text-[11px] text-muted-foreground hover:text-destructive" onClick={() => onPick(null)}>Remove logo</button>
      )}
    </div>
  )
}
