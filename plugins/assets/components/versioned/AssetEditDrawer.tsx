'use client'

import { useEffect, useState } from 'react'
import { useKeyedState } from '@makinbakin/sdk/hooks'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Drawer,
  DrawerSection,
  Field,
  FieldControl,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Form,
  FormActions,
  SubmitButton,
  Textarea,
} from '@makinbakin/sdk/ui'
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
  // The form is seeded per opening of one asset with one set of initial
  // values (#966b): reopening, or opening for another asset, re-seeds in the
  // same render — the operator's edits survive re-renders of the same opening.
  const seed = `${open}\u0000${assetId}\u0000${initialDescription}\u0000${initialTags.join('\n')}`
  const [description, setDescription] = useKeyedState(seed, () => initialDescription)
  const [tags, setTags] = useKeyedState<string[]>(seed, () => initialTags)
  const [fetchedSuggestions, setFetchedSuggestions] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useKeyedState<string | null>(seed, () => null)

  useEffect(() => {
    if (!open || suggestions !== undefined || fetchedSuggestions !== null) return
    const controller = new AbortController()
    fetch(VERSIONED_API, { signal: controller.signal })
      .then(r => r.ok ? r.json() : { assets: [] })
      .then((d: { assets?: VersionedAssetSummary[] }) => {
        const all = new Set<string>()
        for (const a of d.assets ?? []) for (const t of a.tags ?? []) all.add(t)
        if (!controller.signal.aborted) setFetchedSuggestions([...all].sort())
      })
      .catch(() => { if (!controller.signal.aborted) setFetchedSuggestions([]) })
    return () => controller.abort()
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
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Edit asset"
      description={assetId}
      storageKey="asset-edit"
      defaultWidth={480}
      dirty={dirty}
      busy={saving}
    >
      <Form
        aria-label="Edit asset metadata"
        busy={saving}
        onFormSubmit={save}
        data-testid="asset-edit-drawer"
      >
        <DrawerSection title="Metadata">
          <FieldGroup>
            <Field name="description">
              <FieldLabel>Description</FieldLabel>
              <FieldControl
                render={(
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.currentTarget.value)}
                    maxLength={200}
                    rows={3}
                    placeholder="What is this asset?"
                    data-testid="asset-edit-description"
                  />
                )}
              />
              <FieldDescription className="flex items-start justify-between gap-bakin-3">
                <span>Describe what this asset contains or how it should be used.</span>
                <span className="shrink-0 tabular-nums">{description.length}/200</span>
              </FieldDescription>
            </Field>

            <Field name="tags">
              <FieldLabel>Tags</FieldLabel>
              <TagInput
                value={tags}
                onChange={setTags}
                suggestions={suggestions ?? fetchedSuggestions ?? []}
                ariaLabel="Tags"
              />
              <FieldDescription>
                Tags group assets into folders. Enter adds; type to reuse existing tags.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </DrawerSection>

        {error ? (
          <Alert tone="danger" data-testid="asset-edit-error">
            <AlertTitle>Asset was not saved</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <FormActions>
          <SubmitButton
            disabled={!dirty}
            busyLabel="Saving asset…"
            data-testid="asset-edit-save"
          >
            Save asset
          </SubmitButton>
        </FormActions>
      </Form>
    </Drawer>
  )
}
