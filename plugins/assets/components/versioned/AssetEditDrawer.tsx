'use client'

import { useEffect, useState } from 'react'
import { Button, Label, Textarea } from '@makinbakin/sdk/ui'
import { BakinDrawer } from '@makinbakin/sdk/components'
import { Loader2 } from 'lucide-react'
import { TagInput } from './TagInput'
import { VERSIONED_API } from './asset-urls'
import type { VersionedAssetSummary } from './types'

/**
 * Right-side drawer for editing user-facing asset metadata (description +
 * tags) via PATCH /versioned/:assetId/metadata. Description writes through to
 * the current version server-side; tags are the asset-level namespace.
 * Suggestions come from the caller's loaded summaries, or are fetched once
 * when not provided (detail page).
 */
export function AssetEditDrawer({ assetId, initialDescription, initialTags, suggestions, open, onOpenChange, onSaved }: {
  assetId: string
  initialDescription: string
  initialTags: string[]
  /** Existing tags across all assets; fetched from the list endpoint when omitted. */
  suggestions?: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}) {
  const [description, setDescription] = useState(initialDescription)
  const [tags, setTags] = useState<string[]>(initialTags)
  const [fetchedSuggestions, setFetchedSuggestions] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed form state each time the drawer opens (possibly for a new asset).
  useEffect(() => {
    if (open) {
      setDescription(initialDescription)
      setTags(initialTags)
      setError(null)
    }
  }, [open, assetId, initialDescription, initialTags])

  useEffect(() => {
    if (!open || suggestions !== undefined || fetchedSuggestions !== null) return
    fetch(VERSIONED_API)
      .then(r => r.ok ? r.json() : { assets: [] })
      .then((d: { assets?: VersionedAssetSummary[] }) => {
        const all = new Set<string>()
        for (const a of d.assets ?? []) for (const t of a.tags ?? []) all.add(t)
        setFetchedSuggestions([...all].sort())
      })
      .catch(() => setFetchedSuggestions([]))
  }, [open, suggestions, fetchedSuggestions])

  const dirty = description !== initialDescription || tags.join('\n') !== initialTags.join('\n')

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${VERSIONED_API}/${encodeURIComponent(assetId)}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, tags }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `Save failed (${res.status})`)
      }
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BakinDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Edit asset"
      description={assetId}
      storageKey="asset-edit"
      defaultWidth={480}
      dirty={dirty && !saving}
    >
      {/* Matches the AgentForm drawer conventions: BakinDrawer owns the
          padding (px-7 py-6); fields are space-y-1.5 Label+control+help;
          footer buttons live in the body, right-aligned. */}
      <div className="flex flex-col gap-5" data-testid="asset-edit-drawer">
        <div className="space-y-1.5">
          <Label htmlFor="asset-edit-description">Description</Label>
          <Textarea
            id="asset-edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            rows={3}
            placeholder="What is this asset?"
            data-testid="asset-edit-description"
          />
          <p className="text-xs text-muted-foreground text-right">{description.length}/200</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="asset-edit-tags">Tags</Label>
          <TagInput value={tags} onChange={setTags} suggestions={suggestions ?? fetchedSuggestions ?? []} />
          <p className="text-xs text-muted-foreground">
            Tags group assets into folders. Enter adds; type to reuse existing tags.
          </p>
        </div>

        {error && <p className="text-xs text-destructive" data-testid="asset-edit-error">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !dirty} data-testid="asset-edit-save">
            {saving && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </BakinDrawer>
  )
}
