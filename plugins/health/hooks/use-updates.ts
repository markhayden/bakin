'use client'

/**
 * The updates engine, as the Health plugin reads it (#1007 D7.7/D7.14).
 *
 * ONE resource (`useUpdatesResource`) is mounted by the Health page and
 * threaded to every tab that renders engine records — the Updates tab, the
 * System row, the Overview incident link — so the page polls `/api/updates`
 * once and re-reads it on every `updates.changed`. The actions (check, skip,
 * apply) post to the engine's routes; apply follows the started operation
 * and, for the Bakin binary, hands off to the explicit self-update
 * verification (D7.11). Nothing here re-derives an update: the engine's
 * record is the only source.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  isUpdateSkipped,
  type OperationPhase,
  type OperationStartResponse,
  type OperationView,
  type UpdateRecord,
  type UpdateSkipTarget,
  type UpdateSubjectKind,
} from '@makinbakin/sdk/types'
import {
  startOperation,
  useOperation,
  usePluginEvent,
  useSelfUpdateVerification,
  type SelfUpdateHandoff,
  type SelfUpdateVerificationState,
} from '@makinbakin/sdk/hooks'
import { OPERATOR_DECLARATION_HEADERS } from '@makinbakin/sdk/utils'
import { useHealthResource, type HealthResourceRequestContext, type UseHealthResourceResult } from './use-health-resource'
import { interpretPluginUpgrade, SystemMutationOutcomeUnknownError, type PluginUpgradeResult } from '../lib/plugin-upgrade-result'
import {
  applyPreviewClientSchema,
  updatesCheckClientSchema,
  updatesClientSchema,
  type ApplyPreviewData,
  type UpdatesData,
} from '../lib/updates-route-schema'

export const UPDATES_URL = '/api/updates'
export const UPDATES_REFRESH_MS = 60_000
export const UPDATES_REQUEST_TIMEOUT_MS = 15_000
/** A `wait=1` check pass runs every due subject (20 s each, two at a time); give it room. */
export const UPDATES_CHECK_TIMEOUT_MS = 120_000

const JSON_HEADERS = { 'Content-Type': 'application/json', ...OPERATOR_DECLARATION_HEADERS }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body: unknown = await response.json().catch(() => null)
  const message = isRecord(body) && typeof body.message === 'string' && body.message.length > 0
    ? body.message
    : isRecord(body) && typeof body.error === 'string' && body.error.length > 0
      ? body.error
      : `${fallback} (${response.status})`
  return new Error(message)
}

export async function requestUpdates(url: string, context: HealthResourceRequestContext): Promise<UpdatesData> {
  const response = await fetch(url, { signal: context.signal })
  if (!response.ok) throw await responseError(response, 'Updates are unavailable')
  const parsed = updatesClientSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new Error('Updates returned an invalid response')
  return parsed.data
}

export function updateRouteFor(id: string, verb: 'skip' | 'apply-preview' | 'apply'): string {
  return `${UPDATES_URL}/${encodeURIComponent(id)}/${verb}`
}

/** Run a check pass now and wait for it: every subject, or one kind. */
export async function checkUpdates(kind?: UpdateSubjectKind, signal?: AbortSignal): Promise<UpdateRecord[]> {
  const query = new URLSearchParams({ wait: '1', ...(kind ? { source: kind } : {}) })
  const response = await fetch(`${UPDATES_URL}/check?${query}`, { method: 'POST', headers: OPERATOR_DECLARATION_HEADERS, signal })
  if (!response.ok) throw await responseError(response, 'The update check failed')
  const parsed = updatesCheckClientSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new Error('The update check returned an invalid response')
  return parsed.data.records ?? []
}

/** Hide this available identity; the row returns when a newer one appears (C9). */
export async function skipUpdate(id: string): Promise<UpdateRecord> {
  const response = await fetch(updateRouteFor(id, 'skip'), { method: 'POST', headers: OPERATOR_DECLARATION_HEADERS })
  if (!response.ok) throw await responseError(response, 'The update could not be skipped')
  const body: unknown = await response.json().catch(() => null)
  const parsed = updatesClientSchema.shape.records.element.safeParse(isRecord(body) ? body.record : null)
  if (!parsed.success) throw new Error('Skip returned an invalid record')
  return parsed.data
}

/** What applying would do: the action's impact and, when one covers it, the pending approval's FULL scope. */
export async function previewUpdateApply(id: string): Promise<ApplyPreviewData> {
  const response = await fetch(updateRouteFor(id, 'apply-preview'))
  if (!response.ok) throw await responseError(response, 'The update could not be previewed')
  const parsed = applyPreviewClientSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new Error('The update preview was invalid')
  return parsed.data.preview
}

export interface StartUpdateApplyBody {
  /** The available identity the operator reviewed; the server refuses anything else. */
  target?: UpdateSkipTarget
  approvalId?: string
  scopeHash?: string
  consentToken?: string
}

export async function startUpdateApply(id: string, body: StartUpdateApplyBody): Promise<OperationStartResponse> {
  return await startOperation(() => fetch(updateRouteFor(id, 'apply'), { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }))
}

/** The comparable part of what the operator saw — what the apply must install. */
export function reviewedTarget(record: Pick<UpdateRecord, 'available'>): UpdateSkipTarget | undefined {
  const available = record.available
  if (!available) return undefined
  return { ...(available.version ? { version: available.version } : {}), ...(available.sha ? { sha: available.sha } : {}), ...(available.digest ? { digest: available.digest } : {}) }
}

/** The engine's records, read once per page and re-read on every `updates.changed`. */
export function useUpdatesResource(): UseHealthResourceResult<UpdatesData> {
  const resource = useHealthResource<UpdatesData>(UPDATES_URL, {
    intervalMs: UPDATES_REFRESH_MS,
    timeoutMs: UPDATES_REQUEST_TIMEOUT_MS,
    request: requestUpdates,
  })
  const refresh = resource.refresh
  usePluginEvent('updates.changed', () => { void refresh('background') })
  return resource
}

export function findUpdateRecord(updates: UpdatesData | null, id: string): UpdateRecord | null {
  return updates?.records.find((record) => record.id === id) ?? null
}

/** Actionable now: newer, not skipped, and applied through an operation (never a manual pointer). */
export function isApplicableUpdate(record: UpdateRecord): boolean {
  return record.outcome === 'update-available' && !isUpdateSkipped(record) && record.action?.kind === 'operation'
}

// ---------------------------------------------------------------------------
// Apply: the whole flow lives in one dialog (preview → confirm → follow →
// consent/restart → settle); the page shows only the settled message.
// ---------------------------------------------------------------------------

export type UpdateApplyState =
  | { status: 'idle' }
  | { status: 'previewing'; record: UpdateRecord }
  | { status: 'ready'; record: UpdateRecord; preview: ApplyPreviewData }
  | { status: 'starting'; record: UpdateRecord; preview: ApplyPreviewData }
  /** `viaApproval`: the apply resolved a covering Health approval — the operation is that repair, not the subject's own flow. */
  | { status: 'running'; record: UpdateRecord; preview: ApplyPreviewData; start: OperationStartResponse; viaApproval: boolean }
  /** A plugin upgrade's preview widened permissions or binaries: commit only with its token. */
  | { status: 'consent'; record: UpdateRecord; preview: ApplyPreviewData; consent: PluginUpgradeResult & { consentToken: string } }
  /** The Bakin binary was swapped; the server is coming back — verification is explicit (D7.11). */
  | { status: 'restarting'; record: UpdateRecord; preview: ApplyPreviewData; handoff: SelfUpdateHandoff }
  | { status: 'failed'; record: UpdateRecord; preview?: ApplyPreviewData; error: string }
  | { status: 'outcome-unknown'; record: UpdateRecord; message: string }
  | { status: 'done'; record: UpdateRecord; message: string }

/** Statuses that keep the dialog open. */
export const UPDATE_APPLY_DIALOG_STATUSES: ReadonlySet<UpdateApplyState['status']> = new Set(['previewing', 'ready', 'starting', 'running', 'consent', 'restarting', 'failed'])

export interface UseUpdateApplyResult {
  state: UpdateApplyState
  operation: OperationView | null
  phase: OperationPhase
  verification: SelfUpdateVerificationState
  /** Preview and open the dialog for a record. */
  open: (record: UpdateRecord) => Promise<void>
  /** Start the operation (from `ready`, `consent` or a `failed` retry with its preview). */
  confirm: () => Promise<void>
  /** Close the dialog; a running operation keeps running (the operations tray follows it). */
  close: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function settledMessage(record: UpdateRecord, view: OperationView): string {
  const target = record.available?.display ? `${record.subject.label} ${record.available.display}` : record.subject.label
  if (record.subject.kind === 'search-engine') return `${target} was installed and the search indexes were rebuilt.`
  if (record.subject.kind === 'search-models') return `${target} were installed.`
  return view.outcome?.message ?? `${target} was applied.`
}

function restartingStageActive(view: OperationView | null): boolean {
  return view?.stages.some((stage) => stage.id === 'restarting' && stage.status === 'active') ?? false
}

/**
 * The apply state machine. `onSettled` fires once the records should be
 * re-read (done, failed after a start, outcome unknown).
 */
export function useUpdateApply(onSettled?: () => void): UseUpdateApplyResult {
  const [state, setState] = useState<UpdateApplyState>({ status: 'idle' })
  const start = state.status === 'running' ? state.start : null

  const startWith = useCallback(async (record: UpdateRecord, preview: ApplyPreviewData, body: StartUpdateApplyBody) => {
    setState({ status: 'starting', record, preview })
    try {
      // The preview's record is what the operator read in the dialog.
      const started = await startUpdateApply(record.id, { ...body, target: reviewedTarget(preview.record) })
      setState({ status: 'running', record, preview, start: started, viaApproval: body.approvalId !== undefined })
    } catch (error) {
      setState({ status: 'failed', record, preview, error: errorMessage(error) })
    }
  }, [])

  const followed = useOperation(start?.operationId ?? null, {
    bootId: start?.bootId,
    onSettle: (view, phase) => {
      if (state.status !== 'running') return
      const { record, preview } = state
      if (phase === 'restarted' || phase === 'expired') {
        // The preview's record is what was applied (and what the body named).
        const expectedVersion = preview.record.available?.version
        if (record.subject.kind === 'bakin' && expectedVersion) {
          setState({ status: 'restarting', record, preview, handoff: { expectedVersion, oldBootId: state.start.bootId } })
          return
        }
        setState({ status: 'outcome-unknown', record, message: `Bakin restarted or lost track of the ${record.subject.label} update. Check for updates to confirm the result.` })
        onSettled?.()
        return
      }
      if (!view) return
      if (view.status === 'cancelled') {
        setState({ status: 'failed', record, preview, error: `The ${record.subject.label} update was cancelled before anything changed.` })
        return
      }
      // A plugin's OWN flow answers like the upgrade route (consent, ready,
      // noop); a covering repair answers as a repair report — only the
      // operation's status says what happened.
      if (record.subject.kind === 'plugin' && !state.viaApproval) {
        let result: PluginUpgradeResult
        try {
          result = interpretPluginUpgrade(record.subject.id, view.result)
        } catch (error) {
          if (error instanceof SystemMutationOutcomeUnknownError) {
            setState({ status: 'outcome-unknown', record, message: error.message })
            onSettled?.()
          } else {
            setState({ status: 'failed', record, preview, error: errorMessage(error) })
          }
          return
        }
        if (result.ready && result.consentToken) {
          void startWith(record, preview, { consentToken: result.consentToken })
          return
        }
        if (result.awaitingConsent && result.consentToken) {
          setState({ status: 'consent', record, preview, consent: { ...result, consentToken: result.consentToken } })
          return
        }
        setState({ status: 'done', record, message: result.message })
        onSettled?.()
        return
      }
      if (view.status === 'failed') {
        setState({ status: 'failed', record, preview, error: view.outcome?.message ?? `The ${record.subject.label} update failed.` })
        onSettled?.()
        return
      }
      setState({ status: 'done', record, message: state.viaApproval && preview.approval ? `Applied the Health repair “${preview.approval.title}”.` : settledMessage(record, view) })
      onSettled?.()
    },
  })

  // The self-update's old process never reports `finished`: its `restarting`
  // stage is the handoff, exactly as the header banner treats it.
  if (state.status === 'running' && state.record.subject.kind === 'bakin' && state.preview.record.available?.version && restartingStageActive(followed.operation)) {
    setState({ status: 'restarting', record: state.record, preview: state.preview, handoff: { expectedVersion: state.preview.record.available.version, oldBootId: state.start.bootId } })
  }

  const verification = useSelfUpdateVerification(state.status === 'restarting' ? state.handoff : null)
  // The verification settles the apply after commit (it refreshes the
  // page-owned records through `onSettled`, which must never run during a
  // render); keyed on the verification outcome, once per handoff.
  const restartingRecord = state.status === 'restarting' ? state.record : null
  const restartingPreview = state.status === 'restarting' ? state.preview : null
  useEffect(() => {
    if (!restartingRecord || !restartingPreview) return
    if (verification.status === 'idle' || verification.status === 'verifying') return
    if (verification.status === 'verified') {
      setState({ status: 'done', record: restartingRecord, message: `Bakin was updated to v${verification.version} and verified. Reload to use the new version.` })
      onSettled?.()
    } else {
      setState({ status: 'failed', record: restartingRecord, preview: restartingPreview, error: `The restart could not be verified: ${verification.summary}.` })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settles once per verification outcome; onSettled is the page's stable refresh
  }, [verification, restartingRecord, restartingPreview])

  const open = useCallback(async (record: UpdateRecord) => {
    setState({ status: 'previewing', record })
    try {
      const preview = await previewUpdateApply(record.id)
      setState({ status: 'ready', record, preview })
    } catch (error) {
      setState({ status: 'failed', record, error: errorMessage(error) })
    }
  }, [])

  const confirm = useCallback(async () => {
    if (state.status === 'ready' || (state.status === 'failed' && state.preview)) {
      const preview = state.preview!
      const approval = preview.approval
      await startWith(state.record, preview, approval ? { approvalId: approval.approvalId, scopeHash: approval.scopeHash } : {})
      return
    }
    if (state.status === 'consent') {
      await startWith(state.record, state.preview, { consentToken: state.consent.consentToken })
    }
  }, [startWith, state])

  const close = useCallback(() => setState({ status: 'idle' }), [])

  return { state, operation: followed.operation, phase: followed.phase, verification, open, confirm, close }
}

// ---------------------------------------------------------------------------
// Check + skip, with the one feedback line the tab shows above its lists.
// ---------------------------------------------------------------------------

export interface UpdatesFeedback {
  tone: 'success' | 'danger' | 'attention'
  message: string
}

export interface UseUpdatesActionsResult {
  feedback: UpdatesFeedback | null
  dismissFeedback: () => void
  checking: boolean
  check: (kind?: UpdateSubjectKind) => Promise<void>
  skip: (record: UpdateRecord) => Promise<void>
  apply: UseUpdateApplyResult
}

export function useUpdatesActions(updates: UseHealthResourceResult<UpdatesData>): UseUpdatesActionsResult {
  const [feedback, setFeedback] = useState<UpdatesFeedback | null>(null)
  const [checking, setChecking] = useState(false)
  const refresh = updates.refresh

  const check = useCallback(async (kind?: UpdateSubjectKind) => {
    setChecking(true)
    setFeedback(null)
    try {
      await checkUpdates(kind)
      await refresh('background')
    } catch (error) {
      setFeedback({ tone: 'danger', message: `Could not check for updates: ${errorMessage(error)}` })
    } finally {
      setChecking(false)
    }
  }, [refresh])

  const skip = useCallback(async (record: UpdateRecord) => {
    setFeedback(null)
    try {
      const skipped = await skipUpdate(record.id)
      await refresh('background')
      setFeedback({ tone: 'success', message: `${skipped.subject.label} ${skipped.available?.display ?? ''} stays hidden until something newer appears.`.replace(/\s+/g, ' ') })
    } catch (error) {
      setFeedback({ tone: 'danger', message: `Could not skip ${record.subject.label}: ${errorMessage(error)}` })
    }
  }, [refresh])

  const apply = useUpdateApply(() => { void refresh('background') })
  const applied = apply.state
  const [announced, setAnnounced] = useState<UpdateApplyState | null>(null)
  // A settled apply is announced once, as page feedback, when its dialog closes.
  if (applied !== announced && (applied.status === 'done' || applied.status === 'outcome-unknown')) {
    setAnnounced(applied)
    setFeedback(applied.status === 'done' ? { tone: 'success', message: applied.message } : { tone: 'attention', message: applied.message })
  }

  return { feedback, dismissFeedback: () => setFeedback(null), checking: checking || Boolean(updates.data?.running), check, skip, apply }
}
