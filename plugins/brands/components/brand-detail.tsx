/**
 * Brand detail — the manage surface (#419, spec §9, T6.1a).
 *
 * Every editor round-trips through the manifest PUT (server owns identity +
 * timestamps); guideline/lesson docs edit through the doc routes. Completeness
 * hints (S1) tell the operator exactly what agents are missing; the lesson
 * editor carries the "always-rule?" nudge (absolute rules never depend on
 * retrieval).
 */
import { useCallback, useEffect, useState } from 'react'
import { MarkdownEditor } from '@makinbakin/sdk/components'
import type { BrandManifest, PaletteEntry } from '../types'

interface DocInfo {
  name: string
  description?: string
  bytes: number
}

interface DetailResponse {
  brand: BrandManifest
  guidelines: DocInfo[]
  lessons: DocInfo[]
  fingerprint: string | null
}

type ManifestPatch = Partial<Omit<BrandManifest, 'id' | 'createdAt' | 'updatedAt'>>

export function BrandDetail({ brandId, onBack }: { brandId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingDoc, setEditingDoc] = useState<{ kind: 'guidelines' | 'lessons'; name: string; content: string } | null>(null)
  const [newDocName, setNewDocName] = useState('')

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

  useEffect(() => {
    void refresh()
  }, [refresh])

  const putManifest = useCallback(
    async (patch: ManifestPatch) => {
      if (!detail) return
      setSaving(true)
      try {
        const { id: _id, createdAt: _c, updatedAt: _u, ...current } = detail.brand
        const res = await fetch(`/api/plugins/brands/${brandId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...current, ...patch }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `save failed: ${res.status}`)
        }
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSaving(false)
      }
    },
    [brandId, detail, refresh],
  )

  const openDoc = useCallback(
    async (kind: 'guidelines' | 'lessons', name: string) => {
      const res = await fetch(`/api/plugins/brands/${brandId}/docs/${kind}/${encodeURIComponent(name)}`)
      const body = (await res.json().catch(() => ({}))) as { content?: string }
      setEditingDoc({ kind, name, content: body.content ?? '' })
    },
    [brandId],
  )

  const saveDoc = useCallback(async () => {
    if (!editingDoc) return
    setSaving(true)
    try {
      const res = await fetch(
        `/api/plugins/brands/${brandId}/docs/${editingDoc.kind}/${encodeURIComponent(editingDoc.name)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editingDoc.content }),
        },
      )
      if (!res.ok) throw new Error(`doc save failed: ${res.status}`)
      setEditingDoc(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [brandId, editingDoc, refresh])

  if (error && !detail) {
    return (
      <div className="p-4">
        <button className="text-sm text-muted-foreground hover:underline" onClick={onBack}>← Brands</button>
        <p className="mt-2 text-sm text-destructive">{error}</p>
      </div>
    )
  }
  if (!detail) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>

  const b = detail.brand
  const hints: string[] = []
  if (!detail.guidelines.some((d) => d.name === 'voice.md')) hints.push('No voice.md — agents get only palette and rules, not how the brand talks.')
  if (b.palette.length === 0) hints.push('No palette — image generation has no brand colors to follow.')
  if (!b.rules?.length) hints.push('No rules — absolute do/don\'ts ride every dispatch; add the non-negotiables.')
  if (b.assetGroups.length === 0 && b.logos.length === 0) hints.push('No brand assets — agents will have no real logos/screenshots to reference.')

  return (
    <div className="flex flex-col gap-4 p-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <button className="text-sm text-muted-foreground hover:underline" onClick={onBack}>← Brands</button>
        <h2 className="text-lg font-medium">{b.name}</h2>
        <span className="text-xs text-muted-foreground">({b.id})</span>
        {b.draft && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">draft</span>}
        {saving && <span className="text-xs text-muted-foreground">saving…</span>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {hints.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs font-medium text-amber-400">This brand is still thin — agents only follow what exists:</p>
          {hints.map((h) => (
            <p key={h} className="text-xs text-muted-foreground">• {h}</p>
          ))}
        </div>
      )}

      {/* Identity */}
      <section className="rounded-lg border p-3 space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Name & description</label>
        <input
          className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          defaultValue={b.name}
          onBlur={(e) => { if (e.target.value.trim() && e.target.value !== b.name) void putManifest({ name: e.target.value.trim() }) }}
        />
        <input
          className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          placeholder="One-line description (rides the dispatch card + image prompts)"
          defaultValue={b.description ?? ''}
          onBlur={(e) => { if (e.target.value !== (b.description ?? '')) void putManifest({ description: e.target.value || undefined }) }}
        />
        {b.source && (
          <p className="text-xs text-muted-foreground">
            imported from {b.source.repo}
            {b.source.commit ? ` @ ${b.source.commit.slice(0, 8)}` : ''} — check drift: <code>bakin brands check {b.id}</code>
          </p>
        )}
      </section>

      {/* Palette */}
      <ListEditor
        title="Palette"
        hint="Structured colors — image tools consume these directly."
        items={b.palette}
        render={(c, update, remove) => (
          <div className="flex items-center gap-2">
            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex : '#000000'} onChange={(e) => update({ ...c, hex: e.target.value })} className="h-7 w-9 shrink-0 rounded border bg-transparent" />
            <input className="w-32 rounded-md border bg-background px-2 py-1 text-xs" placeholder="name" value={c.name} onChange={(e) => update({ ...c, name: e.target.value })} />
            <input className="w-24 rounded-md border bg-background px-2 py-1 text-xs font-mono" value={c.hex} onChange={(e) => update({ ...c, hex: e.target.value })} />
            <input className="flex-1 rounded-md border bg-background px-2 py-1 text-xs" placeholder="usage (e.g. primary text)" value={c.usage ?? ''} onChange={(e) => update({ ...c, usage: e.target.value || undefined })} />
            <button className="text-xs text-muted-foreground hover:text-destructive" onClick={remove}>✕</button>
          </div>
        )}
        blank={(): PaletteEntry => ({ name: '', hex: '#888888' })}
        valid={(c) => c.name.trim().length > 0 && /^#[0-9a-fA-F]{6}$/.test(c.hex)}
        onSave={(palette) => void putManifest({ palette })}
      />

      {/* Rules */}
      <ListEditor
        title="Rules (absolute)"
        hint="Short imperatives that ride EVERY branded dispatch inline — never retrieval-dependent."
        items={(b.rules ?? []).map((text) => ({ text }))}
        render={(r, update, remove) => (
          <div className="flex items-center gap-2">
            <input className="flex-1 rounded-md border bg-background px-2 py-1 text-xs" placeholder='e.g. "Never use emojis"' value={r.text} onChange={(e) => update({ text: e.target.value })} />
            <button className="text-xs text-muted-foreground hover:text-destructive" onClick={remove}>✕</button>
          </div>
        )}
        blank={() => ({ text: '' })}
        valid={(r) => r.text.trim().length > 0}
        onSave={(rules) => void putManifest({ rules: rules.map((r) => r.text.trim()) })}
      />

      {/* Terminology */}
      <ListEditor
        title="Terminology"
        hint='Do/don&apos;t term pairs, always inline (e.g. "the Acme app" — never "our tool").'
        items={b.terminology ?? []}
        render={(t, update, remove) => (
          <div className="flex items-center gap-2">
            <input className="w-56 rounded-md border bg-background px-2 py-1 text-xs" placeholder="term" value={t.term} onChange={(e) => update({ ...t, term: e.target.value })} />
            <input className="flex-1 rounded-md border bg-background px-2 py-1 text-xs" placeholder="rule" value={t.rule} onChange={(e) => update({ ...t, rule: e.target.value })} />
            <button className="text-xs text-muted-foreground hover:text-destructive" onClick={remove}>✕</button>
          </div>
        )}
        blank={() => ({ term: '', rule: '' })}
        valid={(t) => t.term.trim().length > 0 && t.rule.trim().length > 0}
        onSave={(terminology) => void putManifest({ terminology })}
      />

      {/* Docs */}
      {(['guidelines', 'lessons'] as const).map((kind) => (
        <section key={kind} className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground capitalize">{kind}</label>
            {kind === 'lessons' && (
              <span className="text-[11px] text-muted-foreground">Is it an always-rule? Put it in Rules above instead.</span>
            )}
          </div>
          {(kind === 'guidelines' ? detail.guidelines : detail.lessons).map((d) => (
            <div key={d.name} className="flex items-center gap-2 text-xs">
              <button className="font-mono hover:underline" onClick={() => void openDoc(kind, d.name)}>{d.name}</button>
              {d.description && <span className="text-muted-foreground">— {d.description}</span>}
              {kind === 'guidelines' && (
                <label className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground" title="Inline this doc into the dispatch card (budget permitting)">
                  <input
                    type="checkbox"
                    checked={(b.cardDocs ?? (detail.guidelines.some((g) => g.name === 'voice.md') ? ['voice.md'] : [])).includes(d.name)}
                    onChange={(e) => {
                      const current = b.cardDocs ?? (detail.guidelines.some((g) => g.name === 'voice.md') ? ['voice.md'] : [])
                      const next = e.target.checked ? [...current, d.name] : current.filter((n) => n !== d.name)
                      void putManifest({ cardDocs: next })
                    }}
                  />
                  inline in card
                </label>
              )}
            </div>
          ))}
          {editingDoc?.kind === kind && (
            <div className="space-y-2">
              <p className="text-xs font-mono text-muted-foreground">{editingDoc.name}</p>
              <MarkdownEditor
                content={editingDoc.content}
                editing
                onChange={(content: string) => setEditingDoc({ ...editingDoc, content })}
                minHeight="200px"
              />
              <div className="flex gap-2">
                <button className="rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => void saveDoc()}>Save</button>
                <button className="text-xs text-muted-foreground hover:underline" onClick={() => setEditingDoc(null)}>Cancel</button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              className="w-64 rounded-md border bg-background px-2 py-1 text-xs"
              placeholder={`new-${kind === 'guidelines' ? 'doc' : 'lesson'}.md`}
              value={newDocName}
              onChange={(e) => setNewDocName(e.target.value)}
            />
            <button
              className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
              disabled={!newDocName.trim().endsWith('.md')}
              onClick={() => {
                setEditingDoc({ kind, name: newDocName.trim(), content: '' })
                setNewDocName('')
              }}
            >
              New {kind === 'guidelines' ? 'doc' : 'lesson'}
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}

/** Generic add/edit/remove list editor with explicit Save (manifest PUT per save). */
function ListEditor<T>({
  title, hint, items, render, blank, valid, onSave,
}: {
  title: string
  hint: string
  items: readonly T[]
  render: (item: T, update: (next: T) => void, remove: () => void) => React.ReactNode
  blank: () => T
  valid: (item: T) => boolean
  onSave: (items: T[]) => void
}) {
  const [draft, setDraft] = useState<T[] | null>(null)
  const rows = draft ?? [...items]
  const dirty = draft !== null

  return (
    <section className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{title}</label>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      {rows.map((item, i) => (
        <div key={i}>
          {render(
            item,
            (next) => setDraft(rows.map((r, j) => (j === i ? next : r))),
            () => setDraft(rows.filter((_, j) => j !== i)),
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <button className="rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => setDraft([...rows, blank()])}>
          Add
        </button>
        {dirty && (
          <>
            <button
              className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
              disabled={!rows.every(valid)}
              onClick={() => { onSave(rows); setDraft(null) }}
            >
              Save {title.toLowerCase()}
            </button>
            <button className="text-xs text-muted-foreground hover:underline" onClick={() => setDraft(null)}>Discard</button>
          </>
        )}
      </div>
    </section>
  )
}
