import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
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
} from '@makinbakin/sdk/ui'
import { ConsentDialog, type ConsentRequest } from './consent-dialog'
import type { ExploreCatalogEntry } from '../types'

/**
 * Kind-routed install dialog. Curated installs come in with a preset
 * entry (source + kind locked); the custom "Install from source…" mode
 * exposes source/kind/installAs/adopt/replace. All installs go through
 * the existing host REST endpoints — this dialog renders responses, it
 * never re-implements server-side validation or consent.
 */

type InstallKind = 'agent' | 'plugin' | 'skill-pack' | 'workflow-pack' | 'lesson-pack'

const KIND_OPTIONS: Array<{ value: InstallKind; label: string }> = [
  { value: 'agent', label: 'Agent' },
  { value: 'plugin', label: 'Plugin' },
  { value: 'skill-pack', label: 'Skill pack' },
  { value: 'workflow-pack', label: 'Workflow pack' },
  { value: 'lesson-pack', label: 'Lesson pack' },
]

/** github: prefix or bare owner/repo → github; ./, ../, /, ~ paths → local. */
export function inferSourceType(source: string): 'github' | 'local' {
  return source.startsWith('github:') || (source.includes('/') && !source.startsWith('.') && !source.startsWith('/') && !source.startsWith('~'))
    ? 'github'
    : 'local'
}

function endpointFor(kind: InstallKind): string {
  if (kind === 'agent') return '/api/agent-packages/install'
  if (kind === 'plugin') return '/api/plugins/install'
  return '/api/packages/install'
}

export function InstallDialog({
  open,
  onOpenChange,
  entry,
  onInstalled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Curated preset — locks source + kind. Null = custom source mode. */
  entry: ExploreCatalogEntry | null
  onInstalled: () => void
}) {
  const preset = entry !== null
  const [customSource, setCustomSource] = useState('')
  const [customKind, setCustomKind] = useState<InstallKind>('agent')
  const [installAs, setInstallAs] = useState('')
  const [adopt, setAdopt] = useState(false)
  const [replace, setReplace] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState<ConsentRequest | null>(null)

  const source = preset ? (entry.source ?? '') : customSource
  const kind: InstallKind = preset ? (entry.kind as InstallKind) : customKind

  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      setError(null)
      setConsent(null)
      setSubmitting(false)
    }
    onOpenChange(nextOpen)
  }

  const finishSuccess = () => {
    setConsent(null)
    setCustomSource('')
    setInstallAs('')
    setAdopt(false)
    setReplace(false)
    onInstalled()
    close(false)
  }

  const installBody = (): Record<string, unknown> => {
    const trimmed = source.trim()
    if (kind === 'plugin') {
      return { source: trimmed, type: inferSourceType(trimmed), accepted: false }
    }
    const base: Record<string, unknown> = {
      source: trimmed,
      installAs: installAs.trim() || undefined,
      replace: replace || undefined,
    }
    if (kind === 'agent' && adopt) {
      base.adopt = installAs.trim() || entry?.id || trimmed
    }
    return base
  }

  const postInstall = async (body: Record<string, unknown>) => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(endpointFor(kind), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const responseBody = (await res.json()) as {
        ok?: boolean
        error?: string
        awaitingConsent?: boolean
        manifestChanged?: boolean
        id?: string
        version?: string
        permissions?: string[]
        consentToken?: string
      }
      if (responseBody.awaitingConsent && responseBody.consentToken) {
        setConsent({
          id: responseBody.id ?? source,
          version: responseBody.version ?? '?',
          permissions: responseBody.permissions ?? [],
          consentToken: responseBody.consentToken,
          manifestChanged: responseBody.manifestChanged === true,
        })
        return
      }
      if (!res.ok || responseBody.ok === false) {
        setError(responseBody.error ?? `HTTP ${res.status}`)
        return
      }
      finishSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!source.trim()) {
      setError('Source is required (github:user/repo[@ref] or a local path)')
      return
    }
    await postInstall(installBody())
  }

  const handleConsentAccept = async (accepted: ConsentRequest) => {
    const trimmed = source.trim()
    await postInstall({
      source: trimmed,
      type: inferSourceType(trimmed),
      accepted: true,
      consentToken: accepted.consentToken,
    })
  }

  return (
    <>
      <Dialog open={open && consent === null} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{preset ? `Install ${entry.name}` : 'Install from source'}</DialogTitle>
            <DialogDescription>
              {preset
                ? `Official ${kind.replace('-', ' ')} from the curated catalog.`
                : 'Fetch a package or plugin from a GitHub repo or local path.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {preset ? (
              <div className="flex flex-col gap-1">
                <Label>Source</Label>
                <code className="break-all rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                  {source}
                </code>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="explore-install-source">Source</Label>
                  <Input
                    id="explore-install-source"
                    placeholder="github:user/repo@v0.1.0 or ./local/path"
                    value={customSource}
                    onChange={(e) => setCustomSource(e.target.value)}
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    Bare names aren't supported. Use the github: prefix or a local-path prefix (./, ../, /, ~/).
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="explore-install-kind">Kind</Label>
                  <select
                    id="explore-install-kind"
                    value={customKind}
                    onChange={(e) => setCustomKind(e.target.value as InstallKind)}
                    className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                  >
                    {KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {kind !== 'plugin' && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="explore-install-as">Install as (optional)</Label>
                <Input
                  id="explore-install-as"
                  placeholder="alt-pixel"
                  value={installAs}
                  onChange={(e) => setInstallAs(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Lockfile-key alias. Useful when two packages share an id.
                </p>
              </div>
            )}

            {kind === 'agent' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={adopt} onChange={(e) => setAdopt(e.target.checked)} className="rounded" />
                Adopt existing agent (preserve workspace files; only inject markers)
              </label>
            )}

            {kind !== 'plugin' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="rounded" />
                Replace on collision (overwrite an existing lockfile entry with the same id)
              </label>
            )}

            {error && (
              <div role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} data-testid="install-submit">
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Install
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConsentDialog
        consent={consent}
        busy={submitting}
        onAccept={handleConsentAccept}
        onDecline={() => setConsent(null)}
      />
    </>
  )
}
