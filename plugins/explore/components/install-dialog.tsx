import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CodeBlock } from '@makinbakin/sdk/content'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Form,
  FormActions,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Progress,
  ProgressLabel,
  ProgressValue,
  Spinner,
  SubmitButton,
  Text,
} from '@makinbakin/sdk/ui'
import { usePluginEvent } from '@makinbakin/sdk/hooks'
import { ConsentDialog, type ConsentRequest } from './consent-dialog'
import { sourceWithRef } from '../lib/package-source'
import type { ExploreCatalogEntry } from '../types'
import { describeRequestError } from '../lib/request-error'

/**
 * Kind-routed install dialog. Curated installs come in with a preset
 * entry (source + kind locked); the custom "Install from source…" mode
 * exposes source/kind/installAs/adopt/replace. All installs go through
 * the existing host REST endpoints — this dialog renders responses, it
 * never re-implements server-side validation or consent.
 */

type InstallKind = 'agent' | 'plugin' | 'skill-pack' | 'workflow-pack' | 'lesson-pack'

/**
 * Installs clone repos and can pull binaries, so the ceiling is generous —
 * but it is a ceiling: without one a wedged host route leaves the dialog
 * spinning forever with no way back. `AbortSignal.timeout` tears down the
 * whole exchange, body read included, not just the headers.
 */
const INSTALL_TIMEOUT_MS = 120_000
const SECRET_TIMEOUT_MS = 15_000
/** Async-job poll cadence — the SSE stream is primary, this is the net. */
const JOB_POLL_MS = 4_000

interface InstallProgressUpdate {
  jobId?: string
  stage?: string
  message?: string
  item?: string
  current?: number
  total?: number
  receivedBytes?: number
  totalBytes?: number | null
}

interface ActiveInstallJob {
  id: string
  startedAt: number
  /** Distinct completed stage messages, oldest first. */
  history: string[]
  current: InstallProgressUpdate | null
}

function applyUpdate(prev: ActiveInstallJob, update: InstallProgressUpdate): ActiveInstallJob {
  const history = update.message && prev.current?.message && update.message !== prev.current.message
    ? [...prev.history.filter((line) => line !== prev.current?.message), prev.current.message].slice(-4)
    : prev.history
  return { ...prev, history, current: update }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`
  return `${Math.max(1, Math.round(bytes / 1_000))} KB`
}

/** Deadline rejections arrive as DOMExceptions — surface them as a real error. */

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

/**
 * Live install progress (#895): staged lines + a byte-level bar for the
 * active download, driven by packages.install_* SSE with a status poll as
 * the net. Composes Feedback/Progress (CanonicalUsage) — a busy button
 * alone is banned for anything that can outlive a few seconds.
 */
function InstallProgressPanel({ job }: { job: ActiveInstallJob }) {
  const current = job.current
  const elapsedS = Math.max(0, Math.round((Date.now() - job.startedAt) / 1000))
  const elapsed = elapsedS >= 60 ? `${Math.floor(elapsedS / 60)}m ${elapsedS % 60}s` : `${elapsedS}s`
  const bytes = current?.receivedBytes !== undefined
  const pct = bytes && current?.totalBytes
    ? Math.min(100, Math.round((current.receivedBytes! / current.totalBytes) * 100))
    : undefined

  return (
    <div
      role="status"
      aria-live="polite"
      className="grid gap-bakin-2 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-3"
    >
      {job.history.map((line) => (
        <Text key={line} size="meta" tone="muted">✓ {line}</Text>
      ))}
      <span className="inline-flex items-center gap-bakin-2">
        <Spinner size="sm" />
        <Text size="body">{current?.message ?? 'Starting install…'}</Text>
      </span>
      {bytes ? (
        <Progress value={pct ?? null}>
          <ProgressLabel>{current?.item ?? 'Downloading'}</ProgressLabel>
          <ProgressValue>
            {() => `${formatBytes(current!.receivedBytes!)}${current?.totalBytes ? ` of ${formatBytes(current.totalBytes)}` : ''}`}
          </ProgressValue>
        </Progress>
      ) : null}
      <Text size="meta" tone="muted">Elapsed {elapsed} — installs keep running on the server if you close this dialog.</Text>
    </div>
  )
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
  const [job, setJob] = useState<ActiveInstallJob | null>(null)
  // A job settles exactly once, whether SSE or the poll gets there first.
  const settledJobRef = useRef<string | null>(null)

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
      setJob(null)
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

  type InstallResponseBody = {
    ok?: boolean
    error?: string
    awaitingConsent?: boolean
    manifestChanged?: boolean
    id?: string
    version?: string
    permissions?: string[]
    bins?: ConsentRequest['bins']
    consentToken?: string
    capability?: Parameters<typeof keyStepFrom>[0]['capability']
  }

  /** Shared terminal handling for sync responses AND finished async jobs. */
  const handleInstallOutcome = (responseBody: InstallResponseBody, httpOk: boolean, status: number) => {
    if (responseBody.awaitingConsent && responseBody.consentToken) {
      setConsent({
        id: responseBody.id ?? source,
        version: responseBody.version ?? '?',
        permissions: responseBody.permissions ?? [],
        bins: responseBody.bins ?? [],
        consentToken: responseBody.consentToken,
        manifestChanged: responseBody.manifestChanged === true,
      })
      return
    }
    if (!httpOk || responseBody.ok === false) {
      setError(responseBody.error ?? `HTTP ${status}`)
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
  }

  const settleJob = (jobId: string, apply: () => void) => {
    if (settledJobRef.current === jobId) return
    settledJobRef.current = jobId
    setJob(null)
    setSubmitting(false)
    apply()
  }

  const postInstall = async (body: Record<string, unknown>) => {
    setSubmitting(true)
    setError(null)

    // Packages/agents run as install JOBS (#895): the POST returns a job
    // handle immediately, staged progress rides the SSE bus (poll as the
    // net), and the terminal body comes from the status endpoint. Plugins
    // keep the blocking path — their consent flow is a two-phase POST.
    if (kind !== 'plugin') {
      try {
        const res = await fetch(`${endpointFor(kind)}?async=1`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(SECRET_TIMEOUT_MS),
        })
        const started = (await res.json()) as { ok?: boolean; jobId?: string; error?: string }
        if (res.status === 202 && started.jobId) {
          settledJobRef.current = null
          setJob({ id: started.jobId, startedAt: Date.now(), history: [], current: null })
          // Immediate status check: fast installs settle in one round trip
          // instead of waiting for the first SSE event or poll tick.
          void resolveJob(started.jobId)
          return // submitting stays true until the job settles
        }
        setError(started.error ?? `HTTP ${res.status}`)
        setSubmitting(false)
        return
      } catch (err) {
        setError(describeRequestError(err))
        setSubmitting(false)
        return
      }
    }

    try {
      const res = await fetch(endpointFor(kind), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
      })
      const responseBody = (await res.json()) as InstallResponseBody
      handleInstallOutcome(responseBody, res.ok, res.status)
    } catch (err) {
      setError(describeRequestError(err))
    } finally {
      if (kind === 'plugin') setSubmitting(false)
    }
  }

  /** Resolve a finished job through the status endpoint (single source of truth). */
  const resolveJob = async (jobId: string) => {
    try {
      const res = await fetch(`/api/install-jobs/${jobId}`, { signal: AbortSignal.timeout(SECRET_TIMEOUT_MS) })
      const data = (await res.json()) as { ok?: boolean; error?: string; job?: { status: string; error?: string; result?: InstallResponseBody; resultStatus?: number; lastUpdate?: InstallProgressUpdate } }
      if (!res.ok || !data.job) {
        settleJob(jobId, () => setError(data.error ?? 'Install outcome unknown — the server may have restarted. Refresh and check the installed list.'))
        return
      }
      const remote = data.job
      if (remote.status === 'done') {
        const status = remote.resultStatus ?? 200
        settleJob(jobId, () => handleInstallOutcome(remote.result ?? {}, status < 400, status))
      } else if (remote.status === 'failed') {
        settleJob(jobId, () => setError(remote.error ?? 'Install failed'))
      } else {
        const update = remote.lastUpdate
        setJob((prev) => {
          if (!prev || prev.id !== jobId) return prev
          return update ? applyUpdate(prev, update) : { ...prev }
        })
      }
    } catch {
      // Poll miss — the next tick or an SSE event will catch up.
    }
  }

  // Live progress via the shared SSE bus.
  usePluginEvent('packages.install_progress', (payload) => {
    const update = payload as InstallProgressUpdate
    setJob((prev) => (prev && update.jobId === prev.id ? applyUpdate(prev, update) : prev))
  })
  usePluginEvent('packages.install_done', (payload) => {
    const { jobId } = payload as { jobId?: string }
    if (jobId && job?.id === jobId) void resolveJob(jobId)
  })
  usePluginEvent('packages.install_failed', (payload) => {
    const { jobId, error: jobError } = payload as { jobId?: string; error?: string }
    if (jobId && job?.id === jobId) settleJob(jobId, () => setError(jobError ?? 'Install failed'))
  })

  // Poll net while a job is active — it also refreshes the elapsed display
  // during silent stages (no 1s ticker: renders ride events and polls).
  useEffect(() => {
    if (!job) return
    const poll = setInterval(() => { void resolveJob(job.id) }, JOB_POLL_MS)
    return () => clearInterval(poll)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveJob identity is render-scoped by design
  }, [job?.id])

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
          signal: AbortSignal.timeout(SECRET_TIMEOUT_MS),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null) as { error?: string } | null
          setError(body?.error ?? `Failed to store ${secret.name}`)
          return
        }
      }
      finishSuccess()
    } catch (err) {
      // Without this the caller's `void saveKeys()` turned a network throw
      // into an unhandled rejection: the dialog cleared its busy state and
      // then sat there having silently saved nothing.
      setError(describeRequestError(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (keyStep) {
    return (
      <Dialog busy={submitting} open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{keyStep.packName} is installed — one more step</DialogTitle>
            <DialogDescription>
              This capability needs a key to work. Paste it here (stored masked in Bakin,
              never displayed again) or skip and add it later in Settings → Integrations &amp; Keys.
            </DialogDescription>
          </DialogHeader>
          <Form
            busy={submitting}
            data-testid="capability-key-step"
            onSubmit={(event) => {
              event.preventDefault()
              void saveKeys()
            }}
          >
            <FieldGroup>
              {keyStep.secrets.map((secret) => (
                <Field key={secret.name} name={secret.name}>
                  <FieldLabel htmlFor={`cap-key-${secret.name}`} requirement="optional">{secret.name}</FieldLabel>
                  <Input
                    id={`cap-key-${secret.name}`}
                    type="password"
                    placeholder="Paste key…"
                    value={keyDrafts[secret.name] ?? ''}
                    onChange={(event) => setKeyDrafts((drafts) => ({
                      ...drafts,
                      [secret.name]: event.target.value,
                    }))}
                  />
                  {secret.help ? (
                    <FieldDescription>
                      Get one at <a href={secret.help} target="_blank" rel="noreferrer">{secret.help}</a>
                    </FieldDescription>
                  ) : null}
                </Field>
              ))}
            </FieldGroup>
            {error ? (
              <Alert tone="danger">
                <AlertTitle>The key was not saved</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <FormActions>
              <Button type="button" variant="outline" disabled={submitting} onClick={finishSuccess}>
                Skip for now
              </Button>
              <SubmitButton
                disabled={keyStep.secrets.every((secret) => !(keyDrafts[secret.name] ?? '').trim())}
                busyLabel="Saving key…"
                data-testid="capability-key-save"
              >
                Save key
              </SubmitButton>
            </FormActions>
          </Form>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <>
      <Dialog busy={submitting} open={open && consent === null} onOpenChange={close}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preset ? `Install ${entry.name}` : 'Install from source'}</DialogTitle>
            <DialogDescription>
              {preset
                ? `Official ${kind.replace('-', ' ')} from the curated catalog.`
                : 'Fetch a package or plugin from a GitHub repo or local path.'}
            </DialogDescription>
          </DialogHeader>
          <Form busy={submitting} onSubmit={handleSubmit}>
            <FieldGroup>
              {preset ? (
                <Field name="source">
                  <FieldLabel>Source</FieldLabel>
                  <CodeBlock code={source} label="Source" copyable wrap />
                </Field>
              ) : (
                <>
                  <Field name="source">
                    <FieldLabel requirement="required">Source</FieldLabel>
                    <FieldDescription>
                      Use the github: prefix or a local-path prefix (./, ../, /, ~/). Bare names are not supported.
                    </FieldDescription>
                    <Input
                      id="explore-install-source"
                      placeholder="github:user/repo@v0.1.0 or ./local/path"
                      value={customSource}
                      onChange={(event) => setCustomSource(event.target.value)}
                      autoFocus
                      required
                    />
                  </Field>
                  <Field name="kind">
                    <FieldLabel>Kind</FieldLabel>
                    <Select
                      value={customKind}
                      onValueChange={(value) => setCustomKind((value ?? 'agent') as InstallKind)}
                    >
                      <SelectTrigger id="explore-install-kind" aria-label="Kind" className="w-full">
                        <SelectValue>
                          {KIND_OPTIONS.find((option) => option.value === customKind)?.label}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {KIND_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </>
              )}

              {kind !== 'plugin' ? (
                <Field name="installAs">
                  <FieldLabel requirement="optional">Install as</FieldLabel>
                  <FieldDescription>
                    Lockfile-key alias for packages that share an id. It changes package listings and CLI commands,
                    not the {kind === 'agent' ? "agent's visible name" : 'installed content'}.
                  </FieldDescription>
                  <Input
                    id="explore-install-as"
                    placeholder="alt-pixel"
                    value={installAs}
                    onChange={(event) => setInstallAs(event.target.value)}
                  />
                </Field>
              ) : null}

              {kind === 'agent' ? (
                <Field orientation="horizontal" name="adopt">
                  <Checkbox
                    aria-label="Adopt existing agent"
                    checked={adopt}
                    onCheckedChange={(checked) => setAdopt(checked === true)}
                  />
                  <FieldLabel>Adopt existing agent</FieldLabel>
                  <FieldDescription>
                    Already have an agent with this name? Adopting brings it under package
                    management without erasing anything — it keeps its memory, files, and
                    personality, and just starts receiving updates from this package.
                  </FieldDescription>
                </Field>
              ) : null}

              {kind !== 'plugin' ? (
                <Field orientation="horizontal" name="replace">
                  <Checkbox
                    aria-label="Replace on collision"
                    checked={replace}
                    onCheckedChange={(checked) => setReplace(checked === true)}
                  />
                  <FieldLabel>Replace on collision</FieldLabel>
                  <FieldDescription>
                    If something with this name is already installed, replace it with this
                    one. Leave this off and Bakin will stop and warn you instead of
                    overwriting — the safe default.
                  </FieldDescription>
                </Field>
              ) : null}
            </FieldGroup>

            {error ? (
              <Alert tone="danger">
                <AlertTitle>Installation failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {job ? <InstallProgressPanel job={job} /> : null}

            <FormActions>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={submitting}>
                Cancel
              </Button>
              <SubmitButton busyLabel="Installing…" data-testid="install-submit">
                Install
              </SubmitButton>
            </FormActions>
          </Form>
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
