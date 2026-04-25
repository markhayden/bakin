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
 * Generic install dialog — accepts a github:user/repo[@ref] spec or a
 * local path and POSTs to /api/agent-packages/install. Caller controls
 * the open/close state. On success, calls `onInstalled(result)` so the
 * parent can refresh its state badges + list.
 *
 * Mode selector toggles between fresh install and adopt — adopt requires
 * an OpenClaw agent at the named id to already exist (the installer
 * enforces this; the dialog just plumbs the flag).
 */

export interface InstallResult {
  packageId: string
  kind: string
  createdAgent: boolean
  adopted: boolean
}

export interface InstallDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInstalled?: (result: InstallResult) => void
  /** Pre-fill the source field (used by the curated browser to one-click install). */
  presetSource?: string
}

export function InstallDialog({
  open,
  onOpenChange,
  onInstalled,
  presetSource,
}: InstallDialogProps) {
  const [source, setSource] = useState(presetSource ?? '')
  const [adopt, setAdopt] = useState(false)
  const [installAs, setInstallAs] = useState('')
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
          adopt: adopt ? source.trim() : undefined,
          installAs: installAs.trim() || undefined,
        }),
      })
      const body = (await res.json()) as { ok: boolean; result?: InstallResult; error?: string }
      if (!res.ok || !body.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      if (body.result && onInstalled) onInstalled(body.result)
      onOpenChange(false)
      // Reset the form for the next open
      setSource('')
      setAdopt(false)
      setInstallAs('')
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
          <DialogTitle>Install agent package</DialogTitle>
          <DialogDescription>
            Fetch a package from a local path or GitHub repo and install it as a managed agent.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="install-source">Source</Label>
            <Input
              id="install-source"
              placeholder="github:user/repo@v0.1.0 or ./local/path"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Bare names aren't supported. Use the github: prefix or a local-path prefix (./, ../, /, ~/).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="install-as">Install as (optional)</Label>
            <Input
              id="install-as"
              placeholder="alt-pixel"
              value={installAs}
              onChange={(e) => setInstallAs(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Lockfile-key alias. Useful when two packages share an id.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={adopt}
              onChange={(e) => setAdopt(e.target.checked)}
              className="rounded"
            />
            Adopt existing agent (preserve workspace files; only inject markers)
          </label>
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
              Install
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
