/**
 * Dedicated brand doc editor (UX cleanup spec §7e): full-width, deep-linkable
 * page for guideline/lesson markdown. Breadcrumb back to the brand, edit |
 * preview toggle, SaveBar dirty-state, honest not-found state. New docs arrive
 * via `?create=1` (first save creates the file).
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeft, FileText, Sparkles } from 'lucide-react'
import { MarkdownEditor, SaveBar, ErrorState, SegmentedControl, useUnsavedChangesGuard } from '@makinbakin/sdk/components'
import { Button } from '@makinbakin/sdk/ui'
import { toast } from '@makinbakin/sdk/hooks'
import { DocBrainstormPanel } from './brand-doc-brainstorm'

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; serverContent: string }

const KIND_LABEL: Record<string, string> = { guidelines: 'Guidelines', lessons: 'Lessons' }

export function BrandDocEditorPage() {
  const { brandId, kind, name } = useParams({ strict: false }) as { brandId: string; kind: string; name: string }
  // key: same-route param navigation (doc A → doc B via history) reuses the
  // mounted component — without a remount, doc A's content/dirty/created
  // state survives under doc B's URL and Save would cross-write files.
  return <BrandDocEditorInner key={`${brandId}/${kind}/${name}`} brandId={brandId} kind={kind} name={name} />
}

function BrandDocEditorInner({ brandId, kind, name }: { brandId: string; kind: string; name: string }) {
  // The host router keeps search values as plain strings (PR3 3.1), so
  // `?create=1` arrives as '1'; String() also tolerates older number-coerced
  // history entries from before that change.
  const search = useSearch({ strict: false }) as { create?: string | number }
  const isCreate = String(search.create ?? '') === '1'
  const navigate = useNavigate()

  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [content, setContent] = useState('')
  const [brandName, setBrandName] = useState(brandId)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [brainstormOpen, setBrainstormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Once the first save lands, the doc exists — further saves are plain updates.
  const [created, setCreated] = useState(false)

  const dirty = state.status === 'ready' && content !== state.serverContent

  const docUrl = `/api/plugins/brands/${encodeURIComponent(brandId)}/docs/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/plugins/brands/${encodeURIComponent(brandId)}`)
        if (res.ok) setBrandName(((await res.json()) as { brand?: { name?: string } }).brand?.name ?? brandId)
      } catch { /* breadcrumb falls back to the id */ }
    })()
  }, [brandId])

  // ALWAYS fetch first — even in create mode. `?create=1` sticks to the URL
  // (reloads, history, name collisions), and seeding a blank template over an
  // existing doc would let Save destroy real content. The param only decides
  // what a 404 means: fresh template (create) vs honest not-found (edit).
  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const res = await fetch(docUrl)
      if (res.status === 404) {
        if (isCreate) {
          // Teach the shape: the frontmatter description becomes the doc-list
          // row's subtitle, and the body is what agents read.
          const template = `---\ndescription: One line on what this doc covers\n---\n\n# ${name.replace(/\.md$/, '').replace(/-/g, ' ')}\n\n`
          setState({ status: 'ready', serverContent: '' })
          setContent(template)
        } else {
          setState({ status: 'not-found' })
        }
        return
      }
      if (!res.ok) throw new Error(`load failed: ${res.status}`)
      const body = (await res.json()) as { content?: string }
      setState({ status: 'ready', serverContent: body.content ?? '' })
      setContent(body.content ?? '')
      setCreated(true) // it exists — further saves are plain updates
    } catch {
      // Transient failure is NOT "deleted" — offer a real retry, never bait a
      // user into recreating (and overwriting) an intact doc.
      setState({ status: 'error' })
    }
  }, [docUrl, isCreate, name])

  useEffect(() => {
    void load()
  }, [load])

  const backToDocs = useCallback(
    () => void navigate({ to: '/brands/$brandId', params: { brandId }, search: { tab: kind } as never }),
    [navigate, brandId, kind],
  )

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(docUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `save failed: ${res.status}`)
      }
      setState({ status: 'ready', serverContent: content })
      setCreated(true)
      toast(`Saved ${name}`, 'success')
      return true
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSaving(false)
    }
  }, [docUrl, content, name])

  // In-app navigation guard — a dirty doc must never be silently dropped by a
  // route change (breadcrumb, sidebar, ⌘K).
  const unsavedGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: dirty || (isCreate && !created),
    saving,
    title: 'Unsaved doc changes',
    description: `${name} has unsaved changes. Save before leaving, discard them, or stay here.`,
    saveLabel: 'Save doc',
    onCancel: backToDocs,
    onSaveAndExit: save,
    onDiscardAndExit: () => {
      if (state.status === 'ready') setContent(state.serverContent)
      setCreated(true) // an abandoned new doc is not unsaved work
    },
  })

  if (state.status === 'error') {
    return (
      <div className="p-6">
        <ErrorState
          title="Couldn't load this doc"
          message="The server didn't respond — the doc is probably fine. Retry, or go back to the brand."
          retry={() => void load()}
        />
        <Button variant="ghost" size="sm" className="mt-3" onClick={backToDocs}>
          <ArrowLeft className="size-3.5" /> Back to the brand
        </Button>
      </div>
    )
  }

  if (state.status === 'not-found') {
    return (
      <div className="p-6">
        <ErrorState
          title="This doc doesn't exist"
          message={`${name} isn't in this brand's ${KIND_LABEL[kind]?.toLowerCase() ?? kind} — it may have been deleted.`}
          retry={backToDocs}
        />
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-4 p-4 sm:p-6" data-brand-doc-editor>
      {/* One header row: breadcrumb left, mode toggle + brainstorm right. */}
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={backToDocs}>
            <ArrowLeft className="size-3.5" /> {brandName}
          </Button>
          <span>/</span>
          <span>{KIND_LABEL[kind] ?? kind}</span>
          <span>/</span>
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-foreground">
            <FileText className="size-3.5 shrink-0" /> <span className="truncate">{name}</span>
            {isCreate && !created && <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px]">new</span>}
          </span>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <SegmentedControl
            ariaLabel="Editor mode"
            options={[
              { value: 'edit', label: 'edit' },
              { value: 'preview', label: 'preview' },
            ]}
            value={mode}
            onValueChange={setMode}
          />
          <Button
            variant={brainstormOpen ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setBrainstormOpen((v) => !v)}
            data-brainstorm-toggle
          >
            <Sparkles className="size-3.5" /> Brainstorm
          </Button>
        </div>
      </div>

      {state.status === 'loading' ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex min-h-0 items-stretch gap-4">
          <div className="min-w-0 flex-1">
            <MarkdownEditor
              content={content}
              editing={mode === 'edit'}
              onChange={setContent}
              minHeight="70vh"
            />
          </div>
          {brainstormOpen && (
            <aside className="flex h-[75vh] w-[26rem] shrink-0 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10" data-brainstorm-panel>
              <DocBrainstormPanel brandId={brandId} kind={kind} name={name} getDocContent={() => content} />
            </aside>
          )}
        </div>
      )}

      <SaveBar
        dirty={dirty || (isCreate && !created)}
        saving={saving}
        error={saveError}
        saveLabel="Save doc"
        onSave={() => void save()}
        onDiscard={() => {
          // A brand-new unsaved doc has nothing to reset to — discarding means
          // leaving, which routes through the guard's one exit dialog.
          if (isCreate && !created) unsavedGuard.requestExit()
          else if (state.status === 'ready') setContent(state.serverContent)
        }}
      />
      {unsavedGuard.dialog}
    </div>
  )
}
