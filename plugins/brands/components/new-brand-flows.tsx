/**
 * The three ways a brand comes to exist (UX cleanup spec §6): Build my brand
 * (questionnaire wizard → agent), From a website (URL-led, agent mines the
 * sources), and Import (portable repo/dir). One chooser, plain language, and
 * every path ends with the user looking at the brand they made.
 */
import { useCallback, useState } from 'react'
import { Globe, FolderDown, Wand2, Loader2 } from 'lucide-react'
import { AgentSelect } from '@makinbakin/sdk/components'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@makinbakin/sdk/ui'
import { toast } from '@makinbakin/sdk/hooks'
import { pluginFetch } from '@makinbakin/sdk/utils'

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
    <div className={size === 'tile' ? 'grid gap-3 sm:grid-cols-3' : 'flex flex-col gap-2'} data-create-paths>
      {CREATE_PATHS.map((p) => (
        <button
          key={p.id}
          className={`flex gap-3 rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-shadow hover:ring-foreground/25 ${
            size === 'tile' ? 'flex-col items-start' : 'items-start'
          }`}
          onClick={() => onPick(p.id)}
          data-create-path={p.id}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/5">
            <p.icon className="size-4.5 text-muted-foreground" />
          </span>
          <span className="min-w-0">
            <span className="block font-medium">{p.title}</span>
            <span className="mt-0.5 block text-sm text-muted-foreground">{p.description}</span>
          </span>
        </button>
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
      <DialogContent className="bg-card border-border sm:max-w-xl">
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
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="bg-card border-border sm:max-w-md" data-from-website>
        <DialogHeader>
          <DialogTitle>New brand from a website</DialogTitle>
          <DialogDescription>
            The agent reads your links, extracts colors, voice, and terminology, and drafts the kit for you to review.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fw-name">Brand name</Label>
            <Input id="fw-name" autoFocus placeholder="e.g. Acme" value={name} onChange={(e) => setName(e.target.value)} />
            {name.trim() && (
              <p className="text-[11px] text-muted-foreground">
                id: <span className="font-mono">{id}</span>
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fw-urls">Website or style guide links</Label>
            <Textarea
              id="fw-urls"
              rows={2}
              placeholder={'https://acme.example\nhttps://acme.example/styleguide'}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">One or more links — homepage, style guide, brand page.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fw-agent">Which agent drafts it?</Label>
            <AgentSelect id="fw-agent" value={agent} onValueChange={setAgent} placeholder="Choose an agent..." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fw-notes">Anything else (optional)</Label>
            <Textarea id="fw-notes" rows={2} placeholder="Phrases you love or hate, things the site gets wrong..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={!ready || busy} data-from-website-create>
            {busy ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" /> Creating draft...
              </>
            ) : (
              'Create draft'
            )}
          </Button>
        </DialogFooter>
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
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="bg-card border-border sm:max-w-md" data-import-brand>
        <DialogHeader>
          <DialogTitle>Import a brand</DialogTitle>
          <DialogDescription>Preview first — nothing is written until you confirm the import.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="import-source">Where from?</Label>
            <Input
              id="import-source"
              autoFocus
              placeholder="github:user/repo"
              value={source}
              onChange={(e) => {
                setSource(e.target.value)
                setPreview(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && source.trim() && !busy) void fetchPreview()
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              GitHub is easiest: <span className="font-mono">github:user/repo</span>. For a local kit, paste the
              folder's full path (e.g. <span className="font-mono">/Users/you/acme-brand</span>) — the folder must
              contain a <span className="font-mono">brand.json</span>. Same as{' '}
              <span className="font-mono">bakin brands import</span> in the terminal.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {preview && (
            <div className="space-y-2 rounded-lg bg-foreground/5 p-3" data-import-preview>
              <div className="flex items-center gap-2">
                <span className="font-medium">{preview.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{preview.id}</span>
              </div>
              {preview.palette.length > 0 && (
                <div className="flex gap-1">
                  {preview.palette.slice(0, 8).map((c) => (
                    <span key={c.name} title={`${c.name} ${c.hex}`} className="size-4 rounded-full ring-1 ring-foreground/10" style={{ backgroundColor: c.hex }} />
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {preview.rules} rules · {preview.guidelines} guideline docs · {preview.lessons} lessons · {preview.assets} asset files
                {preview.commit ? ` · ${preview.commit.slice(0, 8)}` : ''}
              </p>
              {preview.exists && (
                <p className="text-xs font-medium text-warning">
                  A brand with this id already exists — importing replaces it (your local edits are lost).
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {preview ? (
            <Button onClick={() => void doImport()} disabled={busy} data-import-confirm>
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" /> Importing...
                </>
              ) : preview.exists ? (
                'Replace + import'
              ) : (
                'Import'
              )}
            </Button>
          ) : (
            <Button onClick={() => void fetchPreview()} disabled={busy || !source.trim()} data-import-preview-btn>
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" /> Fetching...
                </>
              ) : (
                'Preview'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
