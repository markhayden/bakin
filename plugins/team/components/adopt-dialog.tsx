'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { OperationProgress } from '@makinbakin/sdk/patterns'
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
import { usePackageOperation } from '../hooks/use-package-operation'

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
  const [error, setError] = useState<string | null>(null)
  // The adopt is an install operation (#895), followed live in the dialog.
  const install = usePackageOperation<{ ok: boolean; error?: string }>()
  const submitting = install.busy

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!source.trim()) {
      setError('Source is required (github:user/repo[@ref] or a local path)')
      return
    }
    setError(null)
    await install.start(() => fetch('/api/agent-packages/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: source.trim(),
        adopt: agentId,
      }),
    }))
  }

  const settled = install.result
  const resetInstall = install.reset
  useEffect(() => {
    if (!settled) return
    if (settled.httpStatus !== 200 || !settled.body?.ok) {
      setError(settled.body?.error ?? `HTTP ${settled.httpStatus}`)
      return
    }
    onAdopted?.()
    onOpenChange(false)
    setSource('')
    resetInstall()
  }, [settled, onAdopted, onOpenChange, resetInstall])

  const shownError = error ?? install.error

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

          {install.showProgress && install.operation ? (
            <OperationProgress
              operation={install.operation}
              phase={install.phase ?? undefined}
              onCancel={() => { void install.cancel() }}
            />
          ) : null}

          {shownError ? (
            <Alert tone="danger">
              <AlertTitle>Agent was not adopted</AlertTitle>
              <AlertDescription>{shownError}</AlertDescription>
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
