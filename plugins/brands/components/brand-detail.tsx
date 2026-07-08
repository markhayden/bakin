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

      {b.draft && (
        <div className="flex items-center justify-between rounded-md border border-fuchsia-500/30 bg-fuchsia-500/5 p-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-fuchsia-400">Draft</span> — invisible to task pickers, dispatch, and image tools until published.
            Review the sections below (delete <code>_intake.md</code> if you don't want it kept), then publish.
          </p>
          <button
            className="rounded-md border border-fuchsia-500/40 px-3 py-1 text-xs text-fuchsia-300 hover:bg-fuchsia-500/10"
            onClick={async () => {
              const res = await fetch(`/api/plugins/brands/${brandId}/publish`, { method: 'POST' })
              if (res.ok) await refresh()
              else setError(`publish failed: ${res.status}`)
            }}
          >
            Publish brand
          </button>
        </div>
      )}

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

      {/* Brand assets (T6.1b): logos + named groups, labeled by enrichment
          captions so you (and agents) know which screenshot is which (S7). */}
      <BrandAssetsSection brand={b} onSave={(patch) => void putManifest(patch)} />

      {/* Card size + integrity + deletion guard */}
      <BrandHealthSection brandId={b.id} onDeleted={onBack} />

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

interface AssetOption {
  assetId: string
  description: string
  type: string
}

/** Logos + asset groups, picked from the existing asset store (assets never move — brands only point). */
function BrandAssetsSection({ brand, onSave }: { brand: BrandManifest; onSave: (patch: ManifestPatch) => void }) {
  const [options, setOptions] = useState<AssetOption[]>([])
  const [groupDraft, setGroupDraft] = useState<{ name: string; description: string } | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/plugins/assets/versioned')
        if (!res.ok) return
        const body = (await res.json()) as { assets?: Array<{ assetId: string; description?: string; type?: string }> }
        setOptions((body.assets ?? []).map((a) => ({ assetId: a.assetId, description: a.description ?? '', type: a.type ?? 'other' })))
      } catch {
        // Picker degrades to manual entry when the assets plugin is unreachable.
      }
    })()
  }, [])

  const label = (assetId: string) => {
    const opt = options.find((o) => o.assetId === assetId)
    return opt?.description ? `${assetId} — ${opt.description.slice(0, 60)}` : assetId
  }

  const assetSelect = (onPick: (assetId: string) => void) => (
    <select
      className="rounded-md border bg-background px-2 py-1 text-xs max-w-72"
      value=""
      onChange={(e) => { if (e.target.value) onPick(e.target.value) }}
    >
      <option value="">Add asset…</option>
      {options.map((o) => (
        <option key={o.assetId} value={o.assetId}>
          {o.assetId}{o.description ? ` — ${o.description.slice(0, 50)}` : ''} ({o.type})
        </option>
      ))}
    </select>
  )

  return (
    <section className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Brand assets</label>
        <span className="text-[11px] text-muted-foreground">Real logos + screenshots agents reference — assets stay in the asset store.</span>
      </div>

      {/* Logos */}
      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">Logos</p>
        {brand.logos.map((logo, i) => (
          <div key={`${logo.assetId}-${i}`} className="flex items-center gap-2 text-xs">
            <span className="font-mono">{label(logo.assetId)}</span>
            <input
              className="w-24 rounded-md border bg-background px-2 py-0.5 text-xs"
              value={logo.variant}
              onChange={(e) => onSave({ logos: brand.logos.map((l, j) => (j === i ? { ...l, variant: e.target.value } : l)) })}
            />
            <button className="text-muted-foreground hover:text-destructive" onClick={() => onSave({ logos: brand.logos.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        {assetSelect((assetId) => onSave({ logos: [...brand.logos, { assetId, variant: 'default' }] }))}
      </div>

      {/* Groups */}
      <div className="space-y-2">
        <p className="text-[11px] font-medium text-muted-foreground">Asset groups</p>
        {brand.assetGroups.map((group, gi) => (
          <div key={group.name} className="rounded-md border p-2 space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium">{group.name}</span>
              {group.description && <span className="text-muted-foreground">— {group.description}</span>}
              <button
                className="ml-auto text-muted-foreground hover:text-destructive"
                onClick={() => onSave({ assetGroups: brand.assetGroups.filter((_, j) => j !== gi) })}
              >
                remove group
              </button>
            </div>
            {group.assetIds.map((assetId) => (
              <div key={assetId} className="flex items-center gap-2 pl-2 text-xs text-muted-foreground">
                <span className="font-mono">{label(assetId)}</span>
                <button
                  className="hover:text-destructive"
                  onClick={() => onSave({
                    assetGroups: brand.assetGroups.map((g, j) => (j === gi ? { ...g, assetIds: g.assetIds.filter((id) => id !== assetId) } : g)),
                  })}
                >
                  ✕
                </button>
              </div>
            ))}
            {assetSelect((assetId) => onSave({
              assetGroups: brand.assetGroups.map((g, j) => (j === gi && !g.assetIds.includes(assetId) ? { ...g, assetIds: [...g.assetIds, assetId] } : g)),
            }))}
          </div>
        ))}
        {groupDraft ? (
          <div className="flex items-center gap-2">
            <input className="w-40 rounded-md border bg-background px-2 py-1 text-xs" placeholder="group name" value={groupDraft.name} onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })} />
            <input className="flex-1 rounded-md border bg-background px-2 py-1 text-xs" placeholder="usage note, e.g. real product UI — use for any product visual" value={groupDraft.description} onChange={(e) => setGroupDraft({ ...groupDraft, description: e.target.value })} />
            <button
              className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
              disabled={!groupDraft.name.trim()}
              onClick={() => {
                onSave({ assetGroups: [...brand.assetGroups, { name: groupDraft.name.trim(), description: groupDraft.description.trim() || undefined, assetIds: [] }] })
                setGroupDraft(null)
              }}
            >
              Add group
            </button>
            <button className="text-xs text-muted-foreground hover:underline" onClick={() => setGroupDraft(null)}>Cancel</button>
          </div>
        ) : (
          <button className="rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => setGroupDraft({ name: '', description: '' })}>
            New group
          </button>
        )}
      </div>

      {/* Default image references */}
      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground" title="Auto-attached to brand-conditioned image generation when the agent passes no references (max 4)">
          Default image references (≤4)
        </p>
        {(brand.defaultImageReferences ?? []).map((assetId) => (
          <div key={assetId} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{label(assetId)}</span>
            <button className="hover:text-destructive" onClick={() => onSave({ defaultImageReferences: (brand.defaultImageReferences ?? []).filter((id) => id !== assetId) })}>✕</button>
          </div>
        ))}
        {(brand.defaultImageReferences ?? []).length < 4 &&
          assetSelect((assetId) => {
            const current = brand.defaultImageReferences ?? []
            if (!current.includes(assetId)) onSave({ defaultImageReferences: [...current, assetId] })
          })}
      </div>
    </section>
  )
}

/** Card-size preview (S9), integrity warnings, and the guarded delete (S10). */
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
    <section className="rounded-lg border p-3 space-y-2">
      <label className="text-xs font-medium text-muted-foreground">Dispatch footprint & health</label>
      {cardInfo && (
        <p className="text-xs text-muted-foreground">
          This brand's card adds ~{(cardInfo.cardBytes / 1024).toFixed(1)} KB of the {(cardInfo.maxBytes / 1024).toFixed(0)} KB budget to every branded dispatch
          {cardInfo.omitted > 0
            ? ` — ${cardInfo.omitted} item(s) currently omitted for size (agents fetch them via tools).`
            : ' — nothing currently omitted.'}
        </p>
      )}
      {dangling.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
          {dangling.map((d) => (
            <p key={d.assetId} className="text-xs text-amber-400">⚠ asset {d.assetId} missing ({d.where})</p>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {deleteState === null ? (
        <button
          className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
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
          Delete brand…
        </button>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-destructive">
            {deleteState.linked > 0
              ? `${deleteState.linked} pending task(s) link to this brand — they will NOT dispatch until it exists again.`
              : 'No pending tasks link to this brand.'}
            {' '}Guidelines and lessons are deleted; assets stay in the asset store.
          </p>
          <div className="flex gap-2">
            <button
              className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
              onClick={async () => {
                try {
                  const res = await fetch(`/api/plugins/brands/${brandId}`, { method: 'DELETE' })
                  if (!res.ok) throw new Error(`delete failed: ${res.status}`)
                  onDeleted()
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err))
                }
              }}
            >
              Delete permanently
            </button>
            <button className="text-xs text-muted-foreground hover:underline" onClick={() => setDeleteState(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
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
