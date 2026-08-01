'use client'

import { useState, type FormEvent } from 'react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Form,
  FormActions,
  Input,
  SubmitButton,
} from '@makinbakin/sdk/ui'

/**
 * Adopt-flow dialog — pre-targets a specific runtime agent. Used from
 * the team grid's "Adopt with package" button on unmanaged agents.
 * Equivalent to the explore plugin's install dialog with `adopt: true`
 * baked in but with friendlier copy.
 */

export interface AdoptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  onAdopted?: () => void
}

export function AdoptDialog({ open, onOpenChange, agentId, onAdopted }: AdoptDialogProps) {
  const [source, setSource] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!source.trim()) {
      setError('Source is required (github:user/repo[@ref] or a local path)')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/agent-packages/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: source.trim(),
          adopt: agentId,
        }),
      })
      const body = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      if (onAdopted) onAdopted()
      onOpenChange(false)
      setSource('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog busy={submitting} open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adopt {agentId} into a package</DialogTitle>
          <DialogDescription>
            Attach an agent-package to an existing runtime agent. Workspace files
            stay on disk untouched; Bakin only injects managed markers + projects
            assets and lessons.
          </DialogDescription>
        </DialogHeader>
        <Form busy={submitting} onSubmit={handleSubmit}>
          <FieldGroup>
            <Field name="source">
              <FieldLabel htmlFor="adopt-source" requirement="required">Package source</FieldLabel>
              <FieldDescription>A GitHub shorthand or a local package path.</FieldDescription>
              <FieldControl
                required
                render={(
                  <Input
                    id="adopt-source"
                    aria-label="Package source"
                    placeholder="github:user/repo@v0.1.0 or ./agents/pixel"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    autoFocus
                  />
                )}
              />
            </Field>
          </FieldGroup>

          <Alert tone="neutral">
            <AlertTitle>Adopt mode keeps your workspace files</AlertTitle>
            <AlertDescription>
              SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md as they are now —
              the package's templates won't overwrite them. Only the bakin:lesson
              markers + asset files + (optionally) skills get projected.
            </AlertDescription>
          </Alert>

          {error ? (
            <Alert tone="danger">
              <AlertTitle>Agent was not adopted</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <FormActions>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <SubmitButton size="sm" busyLabel="Adopting…">Adopt agent</SubmitButton>
          </FormActions>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
