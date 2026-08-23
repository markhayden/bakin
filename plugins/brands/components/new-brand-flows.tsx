/**
 * The three ways a brand comes to exist (UX cleanup spec §6): Build my brand
 * (questionnaire wizard → agent), From a website (URL-led, agent mines the
 * sources), and Import (portable repo/dir). One chooser, plain language, and
 * every path ends with the user looking at the brand they made.
 */
import { useCallback, useState } from 'react'
import { Globe, FolderDown, Wand2, } from 'lucide-react'
import { AgentSelect } from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Form,
  Input,
  Spinner,
  SubmitButton,
  Text,
  Textarea,
} from '@makinbakin/sdk/ui'
import { useBrandAgentOptions } from './use-brand-agent-options'
import { toast } from '@makinbakin/sdk/hooks'
import { cn, pluginFetch } from '@makinbakin/sdk/utils'

export type CreatePath = 'build' | 'website' | 'import'

export const CREATE_PATHS: Array<{ id: CreatePath; icon: typeof Wand2; title: string; description: string }> = [
  {
    id: 'build',
    icon: Wand2,
    title: 'Build my brand',
    description: 'Answer a few quick questions and an agent drafts the whole kit for you to review.',
  },
  {
    id: 'website',
    icon: Globe,
    title: 'From a website',
    description: 'Point an agent at your site or style guide. It extracts colors, voice, and terminology automatically.',
  },
  {
    id: 'import',
    icon: FolderDown,
    title: 'Import',
    description: 'Bring in an existing brand kit from GitHub or a folder on disk.',
  },
]

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)

/** The three path cards — used inside the chooser dialog AND inline on the empty state. */
export function CreatePathCards({ onPick, size = 'row' }: { onPick: (path: CreatePath) => void; size?: 'row' | 'tile' }) {
  return (
    <div
      className={size === 'tile' ? 'grid gap-bakin-3 @lg:grid-cols-3' : 'grid gap-bakin-2'}
      data-create-paths
      data-layout={size}
    >
      {CREATE_PATHS.map((p) => (
        <Card
          key={p.id}
          size="sm"
          interactive={{ label: p.title, onActivate: () => onPick(p.id) }}
          data-create-path={p.id}
        >
          <CardHeader>
            <div className={cn('flex gap-bakin-3', size === 'tile' ? 'flex-col' : 'items-start')}>
              <Avatar size="md" aria-hidden="true">
                <AvatarFallback>
                  <p.icon className="size-bakin-4" />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <CardTitle>{p.title}</CardTitle>
                <CardDescription className="mt-bakin-1 text-bakin-typography-size-meta">{p.description}</CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

export function NewBrandChooser({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (path: CreatePath) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New brand</DialogTitle>
          <DialogDescription>Every path creates a kit you review before agents start using it.</DialogDescription>
        </DialogHeader>
        <CreatePathCards
          onPick={(path) => {
            onOpenChange(false)
            onPick(path)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

/** From-a-website: name + source URLs + agent → POST /builder (website mode). */
export function FromWebsiteDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** taskId = the dispatched drafting task, so the detail page can link it in the drafting banner. */
  onCreated: (brandId: string, taskId?: string) => void
}) {
  const agentOptions = useBrandAgentOptions()
  const [name, setName] = useState('')
  const [urls, setUrls] = useState('')
  const [agent, setAgent] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = slugify(name)

  const reset = useCallback(() => {
    setName('')
    setUrls('')
    setAgent('')
    setNotes('')
    setError(null)
  }, [])

  const create = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await pluginFetch('brands', 'builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: name.trim(),
          agent,
          urls: urls.trim(),
          notes: notes.trim() || undefined,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { brand?: { id: string }; taskId?: string; error?: string }
      if (!res.ok || !body.brand) throw new Error(body.error ?? `Create failed: ${res.status}`)
      toast(`Draft created — the agent is reading your links`, 'success')
      reset()
      onOpenChange(false)
      onCreated(body.brand.id, body.taskId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [id, name, agent, urls, notes, reset, onOpenChange, onCreated])

  const ready = name.trim().length > 0 && urls.trim().length > 0 && agent.length > 0

  return (
    <Dialog open={open} busy={busy} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md" data-from-website>
        <DialogHeader>
          <DialogTitle>New brand from a website</DialogTitle>
          <DialogDescription>
            The agent reads your links, extracts colors, voice, and terminology, and drafts the kit for you to review.
          </DialogDescription>
        </DialogHeader>
        <Form
          aria-label="Create brand from website"
          busy={busy}
          onSubmit={(event) => {
            event.preventDefault()
            if (ready && !busy) void create()
          }}
        >
          <FieldGroup>
            <Field name="name">
              <FieldLabel htmlFor="fw-name" requirement="required">Brand name</FieldLabel>
              <FieldDescription>Used for the kit name and its stable identifier.</FieldDescription>
              <Input id="fw-name" autoFocus required placeholder="e.g. Acme" value={name} onChange={(e) => setName(e.target.value)} />
            {name.trim() && (
              <Text mono size="meta" tone="muted" as="p">
                id: {id}
              </Text>
            )}
            </Field>
            <Field name="urls">
              <FieldLabel htmlFor="fw-urls" requirement="required">Website or style guide links</FieldLabel>
              <FieldDescription>Use one or more links: a homepage, style guide, or brand page.</FieldDescription>
              <Textarea
                id="fw-urls"
                required
                rows={3}
                placeholder={'https://acme.example\nhttps://acme.example/styleguide'}
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
              />
            </Field>
            <Field name="agent">
              <FieldLabel htmlFor="fw-agent" requirement="required">Which agent drafts it?</FieldLabel>
              <FieldDescription>The selected agent reads the sources and authors the first draft.</FieldDescription>
              <AgentSelect
                id="fw-agent"
                value={agent}
                onValueChange={setAgent}
                agents={agentOptions}
                placeholder="Choose an agent..."
              />
            </Field>
            <Field name="notes">
              <FieldLabel htmlFor="fw-notes" requirement="optional">Anything else</FieldLabel>
              <FieldDescription>Call out phrases you love or hate, or anything the current site gets wrong.</FieldDescription>
              <Textarea id="fw-notes" rows={3} placeholder="Additional direction for the drafting agent…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </FieldGroup>
          {error ? (
            <Alert tone="danger">
              <AlertTitle>Brand draft could not be created</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <SubmitButton
              busyLabel={<><Spinner /> Creating draft…</>}
              disabled={!ready}
              data-from-website-create
            >
              Create draft
            </SubmitButton>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
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

/** Import: source → preview (zero writes) → import. */
export function ImportBrandDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (brandId: string) => void
}) {
  const [source, setSource] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPreview = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await pluginFetch('brands', 'import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: source.trim() }),
      })
      const body = (await res.json()) as { preview?: ImportPreview; error?: string }
      if (!res.ok || !body.preview) throw new Error(body.error ?? `preview failed: ${res.status}`)
      setPreview(body.preview)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [source])

  const doImport = useCallback(async () => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const res = await pluginFetch('brands', 'import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: source.trim(), overwrite: preview.exists }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `import failed: ${res.status}`)
      }
      toast(`Imported ${preview.name}`, 'success')
      const importedId = preview.id
      setSource('')
      setPreview(null)
      onOpenChange(false)
      onImported(importedId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [preview, source, onOpenChange, onImported])

  return (
    <Dialog open={open} busy={busy} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md" data-import-brand>
        <DialogHeader>
          <DialogTitle>Import a brand</DialogTitle>
          <DialogDescription>Preview first — nothing is written until you confirm the import.</DialogDescription>
        </DialogHeader>
        <Form
          aria-label="Import a brand"
          busy={busy}
          onSubmit={(event) => {
            event.preventDefault()
            if (preview) void doImport()
            else if (source.trim()) void fetchPreview()
          }}
        >
          <Field name="source">
            <FieldLabel htmlFor="import-source" requirement="required">Import source</FieldLabel>
            <FieldDescription>
              Use <span className="font-bakin-typography-family-mono">github:user/repo</span> or the full path to a folder containing <span className="font-bakin-typography-family-mono">brand.json</span>.
            </FieldDescription>
            <Input
              id="import-source"
              autoFocus
              required
              placeholder="github:user/repo"
              value={source}
              onChange={(e) => {
                setSource(e.target.value)
                setPreview(null)
              }}
            />
          </Field>
          {error ? (
            <Alert tone="danger">
              <AlertTitle>Import source could not be read</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {preview ? (
            <Card size="sm" data-import-preview>
              <CardHeader>
                <CardTitle>{preview.name}</CardTitle>
                <CardDescription className="font-bakin-typography-family-mono">{preview.id}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-bakin-3">
              {preview.palette.length > 0 && (
                <div className="flex flex-wrap gap-bakin-1" aria-label="Imported brand palette">
                  {preview.palette.slice(0, 8).map((c) => (
                    <span
                      key={c.name}
                      className="size-bakin-4 rounded-bakin-pill border border-bakin-border-subtle"
                      style={{ backgroundColor: c.hex }}
                    >
                      <span className="sr-only">{c.name} {c.hex}</span>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
                {preview.rules} rules · {preview.guidelines} guideline docs · {preview.lessons} lessons · {preview.assets} asset files
                {preview.commit ? ` · ${preview.commit.slice(0, 8)}` : ''}
              </p>
              {preview.exists && (
                <Alert tone="attention">
                  <AlertTitle>This brand already exists</AlertTitle>
                  <AlertDescription>Importing replaces the current kit and its local edits.</AlertDescription>
                </Alert>
              )}
              </CardContent>
            </Card>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <SubmitButton
              busyLabel={<><Spinner /> {preview ? 'Importing…' : 'Fetching…'}</>}
              disabled={!source.trim()}
              data-import-confirm={preview ? true : undefined}
              data-import-preview-btn={preview ? undefined : true}
            >
              {preview ? (preview.exists ? 'Replace and import' : 'Import') : 'Preview'}
            </SubmitButton>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
