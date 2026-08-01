/**
 * Dedicated brand doc editor (UX cleanup spec §7e): full-width, deep-linkable
 * page for guideline/lesson markdown. Breadcrumb back to the brand, edit |
 * preview toggle, SaveBar dirty-state, honest not-found state. New docs arrive
 * via `?create=1` (first save creates the file).
 */
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { MarkdownEditor, type MarkdownEditorMode } from '@makinbakin/sdk/content'
import { toast } from '@makinbakin/sdk/hooks'
import {
  useParams,
  useRouter,
  useSearchParams,
  useUnsavedChangesGuard,
} from '@makinbakin/sdk/navigation'
import {
  Page,
  PageAside,
  PageBody,
  PageHeader,
  SaveBar,
  SegmentedControl,
  StatusBadge,
} from '@makinbakin/sdk/patterns'
import { Button, SystemState } from '@makinbakin/sdk/ui'
import { DocBrainstormPanel } from './brand-doc-brainstorm'

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; serverContent: string }

const KIND_LABEL: Record<string, string> = { guidelines: 'Guidelines', lessons: 'Lessons' }

export function BrandDocEditorPage() {
  const { brandId, kind, name } = useParams<{ brandId: string; kind: string; name: string }>()
  // key: same-route param navigation (doc A → doc B via history) reuses the
  // mounted component — without a remount, doc A's content/dirty/created
  // state survives under doc B's URL and Save would cross-write files.
  return <BrandDocEditorInner key={`${brandId}/${kind}/${name}`} brandId={brandId} kind={kind} name={name} />
}

function BrandDocEditorInner({ brandId, kind, name }: { brandId: string; kind: string; name: string }) {
  // The host router keeps search values as plain strings (PR3 3.1), so
  // `?create=1` arrives as '1'; String() also tolerates older number-coerced
  // history entries from before that change.
  const search = useSearchParams()
  const isCreate = search.get('create') === '1'
  const router = useRouter()

  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [content, setContent] = useState('')
  const [brandName, setBrandName] = useState(brandId)
  const [mode, setMode] = useState<MarkdownEditorMode>('edit')
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
    () => router.push(`/brands/${encodeURIComponent(brandId)}?tab=${encodeURIComponent(kind)}`),
    [router, brandId, kind],
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
    hasUnsavedChanges: state.status === 'ready' && (dirty || (isCreate && !created)),
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

  const editorState = state.status === 'loading'
    ? (
        <SystemState
          kind="loading"
          scope="section"
          title="Loading brand document"
          description="The latest saved content will appear here."
        />
      )
    : state.status === 'error'
      ? (
          <SystemState
            kind="error"
            recovery="available"
            scope="section"
            title="Couldn't load this document"
            description="The server did not respond. The saved document is probably still intact."
            action={(
              <>
                <Button onClick={() => void load()}>Retry</Button>
                <Button variant="outline" onClick={backToDocs}>Back to brand</Button>
              </>
            )}
          />
        )
      : state.status === 'not-found'
        ? (
            <SystemState
              kind="error"
              recovery="available"
              scope="section"
              title="This document doesn't exist"
              description={`${name} is not in this brand's ${KIND_LABEL[kind]?.toLowerCase() ?? kind}. It may have been deleted.`}
              action={<Button onClick={backToDocs}>Back to brand</Button>}
            />
          )
        : undefined

  return (
    <Page data-brand-doc-editor>
      <PageHeader
        measure="wide"
        navigation={(
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Back to ${brandName}`}
            onClick={backToDocs}
          >
            <ArrowLeft />
          </Button>
        )}
        eyebrow={`Branding / ${KIND_LABEL[kind] ?? kind}`}
        title={name}
        meta={(
          <>
            <span>{brandName}</span>
            {isCreate && !created ? <StatusBadge size="xs" tone="accent">New</StatusBadge> : null}
          </>
        )}
        controls={(
          <SegmentedControl
            ariaLabel="Editor mode"
            options={[
              { value: 'edit', label: 'Edit' },
              { value: 'preview', label: 'Preview' },
            ]}
            value={mode}
            onValueChange={setMode}
          />
        )}
        actions={(
          <Button
            variant={brainstormOpen ? 'secondary' : 'outline'}
            onClick={() => setBrainstormOpen((v) => !v)}
            data-brainstorm-toggle
          >
            <Sparkles /> Brainstorm
          </Button>
        )}
      />

      <PageBody
        layout={brainstormOpen ? 'aside' : 'single'}
        state={editorState}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-bakin-6">
          {state.status === 'ready' ? (
            <MarkdownEditor
              label={`${brandName} ${KIND_LABEL[kind]?.toLowerCase() ?? kind} content`}
              content={content}
              mode={mode}
              onChange={setContent}
              height="viewport"
            />
          ) : null}
        </div>
        {brainstormOpen && state.status === 'ready' ? (
          <PageAside label="Brand document brainstorm" data-brainstorm-panel>
              <DocBrainstormPanel brandId={brandId} kind={kind} name={name} getDocContent={() => content} />
          </PageAside>
        ) : null}
      </PageBody>

      {state.status === 'ready' ? (
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
            else setContent(state.serverContent)
          }}
        />
      ) : null}
      {unsavedGuard.dialog}
    </Page>
  )
}
