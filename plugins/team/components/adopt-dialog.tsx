'use client'

import { useState, type FormEvent } from 'react'
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
} from '@bakin/sdk/ui'
import { Loader2 } from 'lucide-react'

/**
 * Adopt-flow dialog — pre-targets a specific OpenClaw agent. Used from
 * the team grid's "Adopt with package" button on unmanaged agents.
 * Equivalent to the install-dialog with `adopt: true` baked in but
 * with friendlier copy.
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adopt {agentId} into a package</DialogTitle>
          <DialogDescription>
            Attach an agent-package to an existing OpenClaw agent. Workspace files
            stay on disk untouched; Bakin only injects managed markers + projects
            assets and knowledge.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="adopt-source">Package source</Label>
            <Input
              id="adopt-source"
              placeholder="github:user/repo@v0.1.0 or ./agents/pixel"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              autoFocus
            />
          </div>
          <div className="rounded border border-blue-300/40 bg-blue-50/40 p-3 text-sm text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-200">
            <p className="font-medium">Adopt mode keeps your workspace files.</p>
            <p className="mt-1 text-xs">
              SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md as they are now —
              the package's templates won't overwrite them. Only the bakin:knowledge
              markers + asset files + (optionally) skills get projected.
            </p>
          </div>
          {error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Adopt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
