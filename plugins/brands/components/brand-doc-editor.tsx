/**
 * Dedicated brand doc editor (UX cleanup spec §7e): full-width, deep-linkable
 * page for guideline/lesson markdown. Breadcrumb back to the brand, edit |
 * preview toggle, SaveBar dirty-state, honest not-found state. New docs arrive
 * via `?create=1` (first save creates the file).
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeft, FileText } from 'lucide-react'
import { MarkdownEditor, SaveBar, ErrorState, useUnsavedGuard } from '@makinbakin/sdk/components'
import { Button } from '@makinbakin/sdk/ui'
import { toast } from '@makinbakin/sdk/hooks'

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'ready'; serverContent: string }

const KIND_LABEL: Record<string, string> = { guidelines: 'Guidelines', lessons: 'Lessons' }

export function BrandDocEditorPage() {
  const { brandId, kind, name } = useParams({ strict: false }) as { brandId: string; kind: string; name: string }
  const search = useSearch({ strict: false }) as { create?: string }
  const isCreate = search.create === '1'
  const navigate = useNavigate()

  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [content, setContent] = useState('')
  const [brandName, setBrandName] = useState(brandId)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Once the first save lands, the doc exists — further saves are plain updates.
  const [created, setCreated] = useState(false)

  const dirty = state.status === 'ready' && content !== state.serverContent
  useUnsavedGuard(dirty)

  const docUrl = `/api/plugins/brands/${encodeURIComponent(brandId)}/docs/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/plugins/brands/${encodeURIComponent(brandId)}`)
        if (res.ok) setBrandName(((await res.json()) as { brand?: { name?: string } }).brand?.name ?? brandId)
      } catch { /* breadcrumb falls back to the id */ }
    })()
  }, [brandId])

  useEffect(() => {
    if (isCreate) {
      // Teach the shape: the frontmatter description becomes the doc-list row's
      // subtitle, and the body is what agents read.
      const template = `---\ndescription: One line on what this doc covers\n---\n\n# ${name.replace(/\.md$/, '').replace(/-/g, ' ')}\n\n`
      setState({ status: 'ready', serverContent: '' })
      setContent(template)
      return
    }
    void (async () => {
      try {
        const res = await fetch(docUrl)
        if (res.status === 404) {
          setState({ status: 'not-found' })
          return
        }
        if (!res.ok) throw new Error(`load failed: ${res.status}`)
        const body = (await res.json()) as { content?: string }
        setState({ status: 'ready', serverContent: body.content ?? '' })
        setContent(body.content ?? '')
      } catch {
        setState({ status: 'not-found' })
      }
    })()
  }, [docUrl, isCreate])

  const backToDocs = useCallback(
    () => void navigate({ to: '/brands/$brandId', params: { brandId }, search: { tab: kind } as never }),
    [navigate, brandId, kind],
  )

  const save = useCallback(async () => {
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
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [docUrl, content, name])

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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6" data-brand-doc-editor>
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={backToDocs}>
          <ArrowLeft className="size-3.5" /> {brandName}
        </Button>
        <span>/</span>
        <span>{KIND_LABEL[kind] ?? kind}</span>
        <span>/</span>
        <span className="flex items-center gap-1.5 font-mono text-foreground">
          <FileText className="size-3.5" /> {name}
          {isCreate && !created && <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px]">new</span>}
        </span>
      </nav>

      {state.status === 'loading' ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <MarkdownEditor
          content={content}
          editing
          onChange={setContent}
          minHeight="60vh"
        />
      )}

      <SaveBar
        dirty={dirty || (isCreate && !created)}
        saving={saving}
        error={saveError}
        saveLabel="Save doc"
        onSave={() => void save()}
        onDiscard={() => {
          if (isCreate && !created) backToDocs()
          else if (state.status === 'ready') setContent(state.serverContent)
        }}
      />
    </div>
  )
}
