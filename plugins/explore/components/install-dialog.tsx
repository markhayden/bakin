import { useState, type FormEvent } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
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
import { sourceWithRef } from '../../../src/lib/package-source'
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

/** Missing, store-backable secrets from a capability-pack install response. */
interface CapabilityKeyStep {
  packName: string
  capability: string
  secrets: Array<{ name: string; secretSlot: string; help?: string }>
}

function keyStepFrom(responseBody: {
  capability?: {
    name?: string
    capability?: string
    secrets?: Array<{ name: string; secretSlot?: string; help?: string; status?: string }>
  }
}): CapabilityKeyStep | null {
  const cap = responseBody.capability
  if (!cap?.capability) return null
  const missing = (cap.secrets ?? [])
    .filter((s): s is { name: string; secretSlot: string; help?: string; status?: string } =>
      s.status === 'missing' && typeof s.secretSlot === 'string')
    .map(({ name, secretSlot, help }) => ({ name, secretSlot, help }))
  if (missing.length === 0) return null
  return { packName: cap.name ?? cap.capability, capability: cap.capability, secrets: missing }
}

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
  const [keyStep, setKeyStep] = useState<CapabilityKeyStep | null>(null)
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})

  // Curated entries carry a ref pin — honor it exactly like onboarding does
  // (agent/pack specs embed @ref into the source; plugin installs send ref).
  const source = preset ? sourceWithRef(entry.source ?? '', entry.ref) : customSource
  const presetRef = preset ? entry.ref : null
  const kind: InstallKind = preset ? (entry.kind as InstallKind) : customKind

  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      setError(null)
      setConsent(null)
      setSubmitting(false)
      setKeyStep(null)
      setKeyDrafts({})
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
      return {
        source: trimmed,
        type: inferSourceType(trimmed),
        ref: presetRef ?? undefined,
        accepted: false,
      }
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
        capability?: Parameters<typeof keyStepFrom>[0]['capability']
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
      // Capability packs with missing store-backable keys get the guided
      // key step (story 2) — the install itself already succeeded.
      const needs = keyStepFrom(responseBody)
      if (needs) {
        onInstalled()
        setKeyStep(needs)
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
    // Must mirror the preflight body exactly — the consent token is bound to
    // the (source, ref) identity server-side.
    const trimmed = source.trim()
    await postInstall({
      source: trimmed,
      type: inferSourceType(trimmed),
      ref: presetRef ?? undefined,
      accepted: true,
      consentToken: accepted.consentToken,
    })
  }

  const saveKeys = async () => {
    if (!keyStep) return
    setSubmitting(true)
    setError(null)
    try {
      for (const secret of keyStep.secrets) {
        const value = (keyDrafts[secret.name] ?? '').trim()
        if (!value) continue
        // Split on the FIRST dot only — skill slots are
        // `skills.<packageId>.<ENV_VAR>`, so split('.', 2) would truncate the
        // name and store the key where nothing can read it.
        const dot = secret.secretSlot.indexOf('.')
        const provider = secret.secretSlot.slice(0, dot)
        const name = secret.secretSlot.slice(dot + 1)
        const res = await fetch('/api/secrets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, name, value }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null) as { error?: string } | null
          setError(body?.error ?? `Failed to store ${secret.name}`)
          return
        }
      }
      finishSuccess()
    } finally {
      setSubmitting(false)
    }
  }

  if (keyStep) {
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{keyStep.packName} is installed — one more step</DialogTitle>
            <DialogDescription>
              This capability needs a key to work. Paste it here (stored masked in Bakin,
              never displayed again) or skip and add it later in Settings → Integrations &amp; Keys.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4" data-testid="capability-key-step">
            {keyStep.secrets.map((secret) => (
              <div key={secret.name} className="flex flex-col gap-2">
                <Label htmlFor={`cap-key-${secret.name}`}>{secret.name}</Label>
                <Input
                  id={`cap-key-${secret.name}`}
                  type="password"
                  placeholder="Paste key…"
                  value={keyDrafts[secret.name] ?? ''}
                  onChange={(e) => setKeyDrafts((d) => ({ ...d, [secret.name]: e.target.value }))}
                />
                {secret.help && (
                  <p className="text-xs text-muted-foreground">
                    Get one at <a className="underline" href={secret.help} target="_blank" rel="noreferrer">{secret.help}</a>
                  </p>
                )}
              </div>
            ))}
            {error && (
              <div role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => finishSuccess()}>
              Skip for now
            </Button>
            <Button
              type="button"
              disabled={submitting || keyStep.secrets.every((s) => !(keyDrafts[s.name] ?? '').trim())}
              onClick={() => void saveKeys()}
              data-testid="capability-key-save"
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <>
      <Dialog open={open && consent === null} onOpenChange={close}>
        <DialogContent className="sm:max-w-3xl">
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
                  <div className="relative">
                    <select
                      id="explore-install-kind"
                      value={customKind}
                      onChange={(e) => setCustomKind(e.target.value as InstallKind)}
                      className="h-9 w-full appearance-none rounded-md border border-border bg-background pl-3 pr-9 text-sm"
                    >
                      {KIND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
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
                  Lockfile-key alias. Useful when two packages share an id. You'll see this
                  name in package listings and CLI commands — it does not change the
                  {kind === 'agent' ? " agent's name or how it appears in the app" : ' installed content itself'}.
                </p>
              </div>
            )}

            {kind === 'agent' && (
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" checked={adopt} onChange={(e) => setAdopt(e.target.checked)} className="mt-1 rounded" />
                <span className="flex flex-col gap-0.5">
                  <span>Adopt existing agent</span>
                  <span className="text-xs text-muted-foreground">
                    Already have an agent with this name? Adopting brings it under package
                    management without erasing anything — it keeps its memory, files, and
                    personality, and just starts receiving updates from this package.
                  </span>
                </span>
              </label>
            )}

            {kind !== 'plugin' && (
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-1 rounded" />
                <span className="flex flex-col gap-0.5">
                  <span>Replace on collision</span>
                  <span className="text-xs text-muted-foreground">
                    If something with this name is already installed, replace it with this
                    one. Leave this off and Bakin will stop and warn you instead of
                    overwriting — the safe default.
                  </span>
                </span>
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
