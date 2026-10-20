'use client'

import { useEffect, useMemo, useRef } from 'react'
import { isUpdateSkipped, type UpdateRecord, type UpdateSubjectKind } from '@makinbakin/sdk/types'
import { useNow, useQueryState } from '@makinbakin/sdk/hooks'
import { formatRelativeTime } from '@makinbakin/sdk/conversation'
import { Inline, Stack } from '@makinbakin/sdk/layout'
import {
  ConfirmDialog,
  ListRow,
  ListRowActions,
  ListRowGroup,
  ListRows,
  OperationProgress,
  StatusBadge,
  type StatusTone,
} from '@makinbakin/sdk/patterns'
import { Alert, AlertDescription, Button, Overline, SystemState, Text, buttonVariants } from '@makinbakin/sdk/ui'
import { RefreshCw } from 'lucide-react'
import { HealthTabIntro } from './health-tab-intro'
import { focusSystemElement } from './system-navigation'
import type { UseHealthResourceResult } from '../hooks/use-health-resource'
import { isApplicableUpdate, UPDATE_APPLY_DIALOG_STATUSES, useUpdatesActions, type UpdateApplyState, type UseUpdatesActionsResult } from '../hooks/use-updates'
import type { ApplyPreviewData, UpdatesData } from '../lib/updates-route-schema'

/** Content + trailing actions share one template across the rows (the kit's `columns` contract), stacking below `lg`. */
const UPDATE_ROW_COLUMNS = 'minmax(0,1fr) auto'

const KIND_LABEL: Record<UpdateSubjectKind, string> = {
  bakin: 'Bakin',
  plugin: 'Plugin',
  package: 'Agent package',
  'hub-skill': 'Hub skill',
  'search-engine': 'Search engine',
  'search-models': 'Search models',
  gateway: 'Runtime gateway',
}

const REASON_COPY: Record<NonNullable<UpdateRecord['reason']>, string> = {
  'newer-version': 'A newer version is published.',
  'newer-commit': 'The source moved past the installed commit.',
  'compatible-rebuild': 'The installed build no longer runs on this Bakin; a compatible rebuild is published.',
  'pin-mismatch': 'The installed version differs from the one this Bakin pins.',
  'below-floor': 'The installed version is below the minimum this Bakin requires.',
}

const IMPACT_COPY = {
  'server-restart': 'Bakin restarts; open pages reload once the new version answers.',
  'search-interruption': 'Search is unavailable while the engine is replaced.',
  reindex: 'Search indexes are rebuilt afterwards; results may be partial until that converges.',
  download: 'Downloads an artifact from its pinned source and verifies it.',
} as const

interface RowPresentation {
  label: string
  tone: StatusTone
  detail: string
}

/** What the badge says — the copy carries the state; color only echoes it. */
export function presentUpdateRecord(record: UpdateRecord): RowPresentation {
  if (record.outcome === 'update-available' && isUpdateSkipped(record)) {
    return { label: 'Skipped', tone: 'neutral', detail: `${record.available?.display ?? 'This update'} stays hidden until something newer appears.` }
  }
  switch (record.outcome) {
    case 'update-available':
      return {
        label: record.group === 'required' ? 'Required' : 'Available',
        tone: record.group === 'required' ? 'danger' : 'accent',
        detail: record.reason ? REASON_COPY[record.reason] : 'An update is available.',
      }
    case 'blocked':
      return { label: 'Blocked', tone: 'attention', detail: record.blockedReason ?? 'This update cannot be applied here.' }
    case 'unsupported':
      return { label: 'Not supported here', tone: 'neutral', detail: record.blockedReason ?? 'Updates are not supported on this installation.' }
    case 'unknown':
      return { label: 'Could not check', tone: 'neutral', detail: record.attempt?.error ? `The last check failed: ${record.attempt.error}` : 'No check has succeeded yet.' }
    case 'current':
      return laterFailedAttempt(record)
        ? { label: 'Current', tone: 'success', detail: 'Nothing newer was published as of the last successful check; the latest check failed.' }
        : { label: 'Current', tone: 'success', detail: 'Nothing newer is published.' }
  }
}

/** An observation stands until a newer one lands — but a failed attempt AFTER it is a fact the tab must not hide (review r7 #4). */
export function laterFailedAttempt(record: Pick<UpdateRecord, 'observedAt' | 'attempt'>): boolean {
  return Boolean(record.observedAt && record.attempt?.error && Date.parse(record.attempt.at) > Date.parse(record.observedAt))
}

function checkedCopy(record: UpdateRecord, now: number): string | null {
  const at = record.observedAt ?? record.attempt?.at
  if (!at) return null
  const relative = formatRelativeTime(at, now)
  const prefix = record.observedAt ? 'Checked' : 'Last attempt'
  const checked = relative === 'now' ? `${prefix} just now` : /^\d+[mhd]$/.test(relative) ? `${prefix} ${relative} ago` : `${prefix} ${relative}`
  // An observation stands until a newer one lands, but a later failed attempt is said out loud.
  return laterFailedAttempt(record) ? `${checked} · the last check failed: ${record.attempt!.error}` : checked
}

function versionCopy(record: UpdateRecord): string {
  const installed = record.installed?.display
  const available = record.available?.display
  if (installed && available && record.outcome !== 'current') return `${installed} → ${available}`
  return installed ?? available ?? ''
}

/** Rows a group shows: everything not current, plus a current row whose latest check FAILED (never hidden behind "everything is current"); skipped rows only on request. */
export function visibleUpdateRecords(records: readonly UpdateRecord[], group: UpdateRecord['group'], showSkipped: boolean): UpdateRecord[] {
  return records
    .filter((record) => record.group === group && (record.outcome !== 'current' || laterFailedAttempt(record)) && (showSkipped || !isUpdateSkipped(record)))
    .sort((left, right) => left.subject.label.localeCompare(right.subject.label) || left.id.localeCompare(right.id))
}

/**
 * A group heading counts UPDATES; rows kept visible for another reason
 * (a failed check, a blocked or unsupported subject) are named separately so
 * the heading never contradicts the tab badge (review r8 #3).
 */
export function groupHeading(name: string, rows: readonly UpdateRecord[]): { label: string; tone: 'neutral' | 'accent' | 'danger'; updates: number } {
  const updates = rows.filter((row) => row.outcome === 'update-available').length
  const failed = rows.filter((row) => row.outcome === 'unknown' || laterFailedAttempt(row)).length
  const blocked = rows.filter((row) => row.outcome === 'blocked' || row.outcome === 'unsupported').length
  const others = [
    failed > 0 ? `${failed} ${failed === 1 ? 'check' : 'checks'} failed` : null,
    blocked > 0 ? `${blocked} blocked` : null,
  ].filter((part): part is string => part !== null)
  const label = others.length === 0 ? `${name} (${updates})` : `${name} (${updates} ${updates === 1 ? 'update' : 'updates'}, ${others.join(', ')})`
  return { label, tone: updates > 0 ? (name === 'Required' ? 'danger' : 'accent') : 'neutral', updates }
}

export function skippedUpdateCount(records: readonly UpdateRecord[]): number {
  return records.filter((record) => record.outcome === 'update-available' && isUpdateSkipped(record)).length
}

interface UpdateRowProps {
  record: UpdateRecord
  now: number
  focused: boolean
  busy: boolean
  onApply: (record: UpdateRecord) => void
  onSkip: (record: UpdateRecord) => void
}

function UpdateRow({ record, now, focused, busy, onApply, onSkip }: UpdateRowProps) {
  const ref = useRef<HTMLLIElement>(null)
  const presentation = presentUpdateRecord(record)
  const checked = checkedCopy(record, now)
  const versions = versionCopy(record)
  // A required update is something the installation needs; only an optional one can be skipped.
  const skippable = record.group === 'available' && record.outcome === 'update-available' && !isUpdateSkipped(record) && record.available !== undefined
  useEffect(() => {
    // A deep link reveals the row and moves focus to its first control (the
    // row itself is not a control, so it never joins the tab order).
    const row = ref.current
    if (!focused || !row) return
    const control = row.querySelector<HTMLElement>('button, a[href]')
    if (control) focusSystemElement(control, { block: 'center' })
    else row.scrollIntoView?.({ block: 'center' })
  }, [focused])
  return (
    <ListRow
      ref={ref}
      data-update-id={record.id}
      data-update-outcome={record.outcome}
      className="min-w-0 scroll-mt-bakin-4"
    >
      <div className="min-w-0">
        <Inline gap="dense">
          <h3 className="text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">{record.subject.label}</h3>
          <StatusBadge tone={presentation.tone} variant="solid">{presentation.label}</StatusBadge>
          <Overline>{KIND_LABEL[record.subject.kind]}</Overline>
        </Inline>
        {versions && (
          <Text size="meta" as="p" className="mt-bakin-1 font-bakin-typography-family-mono tabular-nums">{versions}</Text>
        )}
        <Text size="meta" tone="muted" as="p" className="mt-bakin-1 leading-relaxed">
          {presentation.detail}
          {record.action?.kind === 'manual' && record.outcome !== 'unsupported' ? ` ${record.action.pointer}` : ''}
          {checked ? ` · ${checked}` : ''}
        </Text>
      </div>
      <ListRowActions className="gap-bakin-1">
        {record.notesUrl && (
          <a
            href={record.notesUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ size: 'xs', variant: 'link' })}
            aria-label={`Release notes for ${record.subject.label}`}
          >
            Release notes
          </a>
        )}
        {skippable && (
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => onSkip(record)} aria-label={`Skip ${record.subject.label} ${record.available?.display ?? ''}`.trim()}>
            Skip
          </Button>
        )}
        {isApplicableUpdate(record) && (
          <Button size="sm" variant={record.group === 'required' ? 'primary' : 'outline'} disabled={busy} onClick={() => onApply(record)} aria-label={`Update ${record.subject.label}`}>
            Update
          </Button>
        )}
      </ListRowActions>
    </ListRow>
  )
}

/** The whole apply flow, inside one dialog: impact + approval scope, then progress, consent or the restart handoff. */
function ApplyDialogBody({ state, actions }: { state: UpdateApplyState; actions: UseUpdatesActionsResult }) {
  const preview: ApplyPreviewData | undefined = state.status === 'idle' || state.status === 'previewing' || state.status === 'done' || state.status === 'outcome-unknown' ? undefined : state.preview
  const action = preview?.action ?? preview?.record.action
  const impacts = action?.kind === 'operation' ? action.impact : []
  const running = state.status === 'running' ? actions.apply.operation : null
  return (
    <Stack gap="item" data-testid="update-apply-body">
      {state.status === 'previewing' && <Text size="meta" tone="muted">Checking what this update would do…</Text>}
      {preview && (
        <>
          <Text size="meta" as="p" className="font-bakin-typography-family-mono tabular-nums">{versionCopy(preview.record)}</Text>
          {impacts.length > 0 && (
            <ul className="m-0 list-disc space-y-bakin-1 pl-bakin-6 text-bakin-typography-size-meta text-bakin-text-muted" aria-label="What this update does">
              {impacts.map((impact) => <li key={impact}>{IMPACT_COPY[impact]}</li>)}
              {action?.kind === 'operation' && action.downloadBytes !== undefined && (
                <li>Download size: {formatBytes(action.downloadBytes)}.</li>
              )}
            </ul>
          )}
          {preview.approval && (
            <Alert tone="attention" data-testid="update-apply-approval">
              <AlertDescription>
                <span className="block font-bakin-typography-weight-medium">Applying approves the pending Health repair “{preview.approval.title}” in full:</span>
                <ul className="m-0 mt-bakin-1 list-disc space-y-bakin-1 pl-bakin-6">
                  {preview.approval.items.flatMap((item) => item.changes).map((change) => (
                    <li key={`${change.target}:${change.action}`}>{change.description}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
      {state.status === 'consent' && (
        <Alert tone="attention" data-testid="update-apply-consent">
          <AlertDescription>
            <span className="block font-bakin-typography-weight-medium">{state.consent.message}</span>
            {state.consent.permissions.length > 0 && <span className="block">Permissions: {state.consent.permissions.join(', ')}.</span>}
            {state.consent.bins.length > 0 && (
              <span className="block">Binaries: {state.consent.bins.map((bin) => `${bin.name} ${bin.version}${bin.sizeBytes ? ` (${formatBytes(bin.sizeBytes)})` : ''}`).join(', ')}.</span>
            )}
          </AlertDescription>
        </Alert>
      )}
      {running && <OperationProgress operation={running} phase={actions.apply.phase} variant="compact" />}
      {state.status === 'restarting' && (
        <Text size="meta" as="p" role="status" aria-live="polite">
          {actions.apply.verification.status === 'verifying'
            ? `Bakin is restarting into v${state.handoff.expectedVersion}…`
            : actions.apply.verification.status === 'idle' ? 'Bakin is restarting…' : actions.apply.verification.summary}
        </Text>
      )}
    </Stack>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}

export interface UpdatesTabViewProps {
  updates: UseHealthResourceResult<UpdatesData>
  actions: UseUpdatesActionsResult
  showSkipped: boolean
  onShowSkippedChange: (value: boolean) => void
  /** A record to reveal and focus (deep link from an Overview incident). */
  focusId?: string | null
  now?: number
}

/** Presentation seam: the connected tab owns URL state and the hooks. */
export function UpdatesTabView({ updates, actions, showSkipped, onShowSkippedChange, focusId = null, now: fixedNow }: UpdatesTabViewProps) {
  const liveNow = useNow(30_000)
  const now = fixedNow ?? liveNow.getTime()
  const records = useMemo(() => updates.data?.records ?? [], [updates.data])
  const required = useMemo(() => visibleUpdateRecords(records, 'required', showSkipped), [records, showSkipped])
  const available = useMemo(() => visibleUpdateRecords(records, 'available', showSkipped), [records, showSkipped])
  const skipped = skippedUpdateCount(records)
  const requiredHeading = useMemo(() => groupHeading('Required', required), [required])
  const availableHeading = useMemo(() => groupHeading('Available', available), [available])
  const { state } = actions.apply
  const dialogOpen = UPDATE_APPLY_DIALOG_STATUSES.has(state.status)
  const dialogRecord = state.status === 'idle' ? null : state.record
  const busy = state.status === 'starting' || state.status === 'running' || state.status === 'previewing' || state.status === 'restarting'
  const lastCheck = records.map((record) => record.observedAt ?? record.attempt?.at ?? '').filter(Boolean).sort().at(-1) ?? null

  return (
    <div className="space-y-bakin-6" data-testid="health-updates-tab">
      <HealthTabIntro
        title="Updates"
        description="Required and available updates for Bakin, its plugins, agent packages and the search engine. Required means the installation cannot work as configured until it is applied."
        actions={(
          <>
            {skipped > 0 && (
              <Button size="sm" variant="ghost" aria-pressed={showSkipped} onClick={() => onShowSkippedChange(!showSkipped)}>
                {showSkipped ? 'Hide skipped' : `Show ${skipped} skipped`}
              </Button>
            )}
            <Button size="sm" variant="outline" busy={actions.checking} onClick={() => void actions.check()}>
              <RefreshCw aria-hidden="true" />
              {actions.checking ? 'Checking…' : 'Check for updates'}
            </Button>
          </>
        )}
      />

      {actions.feedback && (
        <Alert tone={actions.feedback.tone} data-testid="updates-feedback">
          <AlertDescription>{actions.feedback.message}</AlertDescription>
        </Alert>
      )}
      {updates.backgroundError && updates.data && (
        <Alert tone="attention">
          <AlertDescription>The last read of the updates engine failed: {updates.backgroundError}. The records below are the last ones read.</AlertDescription>
        </Alert>
      )}

      {!updates.data && updates.loading ? (
        <SystemState kind="loading" scope="section" title="Reading update records" description="Loading what the updates engine last observed." />
      ) : !updates.data ? (
        <SystemState
          kind="error"
          scope="section"
          recovery="available"
          title="Updates are unavailable"
          description={updates.error ?? 'The updates engine did not answer.'}
          action={<Button variant="outline" onClick={() => void updates.refresh('explicit')}>Try again</Button>}
        />
      ) : required.length === 0 && available.length === 0 ? (
        <SystemState
          kind="initial-empty"
          scope="section"
          title="Everything is current"
          description={`${records.length} ${records.length === 1 ? 'subject' : 'subjects'} checked${lastCheck ? `, last ${formatRelativeTime(lastCheck, now) === 'now' ? 'just now' : `${formatRelativeTime(lastCheck, now)} ago`}` : ''}.${skipped > 0 ? ` ${skipped} skipped ${skipped === 1 ? 'update is' : 'updates are'} hidden.` : ''}`}
        />
      ) : (
        <Stack gap="section">
          {required.length > 0 && (
            <ListRowGroup label={requiredHeading.label} headerVariant="section" headerTone={requiredHeading.tone} headingLevel={2} data-testid="updates-required">
              <ListRows variant="separated" columns={UPDATE_ROW_COLUMNS} columnsAt="lg">
                {required.map((record) => (
                  <UpdateRow key={record.id} record={record} now={now} focused={focusId === record.id} busy={busy} onApply={(row) => void actions.apply.open(row)} onSkip={(row) => void actions.skip(row)} />
                ))}
              </ListRows>
            </ListRowGroup>
          )}
          {available.length > 0 && (
            <ListRowGroup label={availableHeading.label} headerVariant="section" headerTone={availableHeading.tone} headingLevel={2} data-testid="updates-available">
              <ListRows variant="separated" columns={UPDATE_ROW_COLUMNS} columnsAt="lg">
                {available.map((record) => (
                  <UpdateRow key={record.id} record={record} now={now} focused={focusId === record.id} busy={busy} onApply={(row) => void actions.apply.open(row)} onSkip={(row) => void actions.skip(row)} />
                ))}
              </ListRows>
            </ListRowGroup>
          )}
        </Stack>
      )}

      {dialogRecord && (
        <ConfirmDialog
          open={dialogOpen}
          title={`Update ${dialogRecord.subject.label}?`}
          description={presentUpdateRecord(dialogRecord).detail}
          confirmLabel={state.status === 'consent' ? 'Approve and update' : 'Update'}
          busyLabel={state.status === 'restarting' ? 'Restarting…' : state.status === 'previewing' ? 'Checking…' : 'Updating…'}
          cancelLabel={state.status === 'running' || state.status === 'restarting' ? 'Close' : 'Cancel'}
          confirmTone="primary"
          busy={busy}
          error={state.status === 'failed' ? state.error : undefined}
          confirmTestId="update-apply-confirm"
          onConfirm={() => void actions.apply.confirm()}
          onCancel={actions.apply.close}
        >
          <ApplyDialogBody state={state} actions={actions} />
        </ConfirmDialog>
      )}
    </div>
  )
}

export function UpdatesTab({ updates }: { updates: UseHealthResourceResult<UpdatesData> }) {
  const [showSkippedParam, setShowSkippedParam] = useQueryState('updates_skipped', '')
  const [focusId] = useQueryState('update', '')
  const actions = useUpdatesActions(updates)
  return (
    <UpdatesTabView
      updates={updates}
      actions={actions}
      showSkipped={showSkippedParam === '1'}
      onShowSkippedChange={(value) => setShowSkippedParam(value ? '1' : '')}
      focusId={focusId || null}
    />
  )
}
