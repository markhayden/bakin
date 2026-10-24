/**
 * Runtime hub — Overview: who is running the agents, what it can do (in
 * plain language), and whether setup is healthy. Every non-native state
 * says what happens instead — the reader never has to decode an enum.
 */
import { useEffect, useRef, useState } from 'react'
import { Wrench } from 'lucide-react'
import { startOperation, toast, useJsonFetch, useOperation, usePluginEvent } from '@makinbakin/sdk/hooks'
import { Section, Stack } from '@makinbakin/sdk/layout'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { ConfirmDialog, HandoffCard, OperationProgress, StatGroup, StatTile, type DataTableColumn } from '@makinbakin/sdk/patterns'
import { type HealthIncident, type HealthReport, type OperationStartResponse } from '@makinbakin/sdk/types'
import { RuntimeTable } from './runtime-table'
import { Badge, Button, Skeleton, SystemState, Text } from '@makinbakin/sdk/ui'
import { capabilityRows } from '../../lib/runtime-report'
import { ModeBadge, MODE_LEGEND, CheckStatusBadge, capabilityStateCopy, deliveryReadinessCopy, type CapabilityMode } from './shared'
import type { CapabilityReport, OnboardingComponentStatus } from './types'

/**
 * The runtime's own sign-in, read from the canonical Health report (the
 * adapter's credential incident on `runtime:<adapter>` carries the exact
 * command — Pi's `/login` inside its TUI, row 198). The runtime page never
 * invents a command: with no such incident it names the gap and where the
 * runtime's own tooling lives. Copy-only on purpose — the Terminal session
 * handoff is the Health card's; this page re-reads credentials when it
 * mounts again after the operator comes back.
 */
const HEALTH_REPORT_FETCH_OPTIONS = { timeoutMs: 10_000 }

type HumanCredentialHandoff = Extract<HealthIncident['resolution'], { type: 'human' }> & { handoff: NonNullable<Extract<HealthIncident['resolution'], { type: 'human' }>['handoff']> }

/** The runtime's credential handoff from the report, if its adapter published one. */
export function credentialHandoffFor(report: Pick<HealthReport, 'incidents'> | null | undefined, adapter: string): HumanCredentialHandoff | null {
  for (const incident of report?.incidents ?? []) {
    const { resolution, subject } = incident
    if (subject.kind !== 'runtime' || subject.id !== adapter) continue
    if (resolution.type !== 'human' || resolution.needs !== 'credential' || !resolution.handoff) continue
    return resolution as HumanCredentialHandoff
  }
  return null
}

function CredentialHandoff({ adapter }: { adapter: string }) {
  const health = useJsonFetch<Pick<HealthReport, 'incidents'>>('/api/plugins/health/doctor', HEALTH_REPORT_FETCH_OPTIONS)
  if (health.loading) return null
  const handoff = credentialHandoffFor(health.data, adapter)
  if (!handoff) {
    return (
      <Text as="p" tone="muted" size="meta" data-testid="runtime-credential-gap">
        No model provider is signed in for {adapter}. Sign in with the runtime's own tooling, then come back — this page re-reads credentials when it loads.
      </Text>
    )
  }
  return (
    <HandoffCard
      title={handoff.label}
      description="Bakin cannot sign you in to a provider. Run this in your terminal, then come back — this page re-reads credentials when it loads."
      command={handoff.handoff.command}
      cwd={handoff.handoff.cwd}
    />
  )
}

/**
 * `?field=credentials` (the health runtime-credentials incident's deep link)
 * lands on this group: it takes focus and the kit highlight outline, the
 * same treatment a deep-linked spend incident gets. With no provider signed
 * in, the group IS the control: the runtime's sign-in handoff sits under the
 * tiles (Codex r1 #9 — a highlighted statistic is not a control).
 */
function CredentialTiles({ report, highlighted }: { report: CapabilityReport; highlighted: boolean }) {
  const creds = report.credentialStatus
  const providers = creds?.llmProviders ?? []
  const kinds = new Map((creds?.llmCredentials ?? []).map((c) => [c.provider, c.kind]))
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!highlighted) return
    ref.current?.focus({ preventScroll: true })
    ref.current?.scrollIntoView?.({ block: 'center' })
  }, [highlighted])
  return (
    <div
      ref={ref}
      id="runtime-field-credentials"
      data-testid="runtime-field-credentials"
      tabIndex={highlighted ? -1 : undefined}
      data-highlighted={highlighted ? 'true' : undefined}
      className={highlighted ? 'rounded-bakin-surface outline outline-2 outline-offset-2 outline-bakin-signal-highlight' : undefined}
    >
    <Stack gap="item">
    <StatGroup label="Runtime and credentials">
      <StatTile
        variant="surface"
        label="Active runtime"
        value={report.adapter}
        sub={`${report.runtime.name}@${report.runtime.version}`}
      />
      <StatTile
        variant="surface"
        label="Model providers"
        value={providers.length}
        valueTone={providers.length === 0 ? 'attention' : 'neutral'}
        sub={providers.length === 0
          ? 'None configured — agents cannot run turns.'
          : (
            <span className="flex flex-wrap gap-bakin-1">
              {providers.map((p) => (
                <Badge key={p} tone="neutral" variant="outline">
                  {p}{kinds.get(p) === 'oauth' ? ' · subscription' : kinds.has(p) ? ' · API key' : ''}
                </Badge>
              ))}
            </span>
          )}
      />
      <StatTile
        variant="surface"
        label="Tool access"
        value={report.toolAccess.ok ? 'Healthy' : 'Needs attention'}
        valueTone={report.toolAccess.ok ? 'neutral' : 'attention'}
        sub={report.toolAccess.ok
          ? `${capabilityStateCopy('toolCalling', 'native', report.adapter, report.toolAccess.style)}${toolPolicyCopy(report.capabilities.toolCalling?.access?.perTurnToolsMode)}`
          : report.toolAccess.issues.join('; ')}
      />
    </StatGroup>
    {providers.length === 0 ? <CredentialHandoff adapter={report.adapter} /> : null}
    </Stack>
    </div>
  )
}

/**
 * #883 honesty on the Tool access tile: whether a text-only turn
 * (`toolsMode: 'none'`) really runs without tools on this runtime. An older
 * server that never declared it says nothing.
 */
function toolPolicyCopy(perTurnToolsMode: boolean | undefined): string {
  if (perTurnToolsMode === true) return ' Per-turn tool policy is enforced: a text-only turn runs without tools.'
  if (perTurnToolsMode === false) return ' Per-turn tool policy is not enforced: a text-only turn keeps its tools (the request is dropped with a warning).'
  return ''
}

interface CapabilityGridRow {
  key: string
  label: string
  mode?: CapabilityMode
  meaning: string
}

const CHANNELS_FETCH_OPTIONS = { timeoutMs: 10_000 }

/** The slice of GET /api/channels the Overview needs (#908). */
interface ChannelReadinessSlice {
  connection?: { state?: string }
  remediation?: { summary?: string; nextStep?: string } | null
}

function readinessSlice(value: unknown): ChannelReadinessSlice | null {
  if (!value || typeof value !== 'object') return null
  const slice = value as ChannelReadinessSlice
  return typeof slice.connection?.state === 'string' ? slice : null
}

function CapabilityGrid({ report }: { report: CapabilityReport }) {
  // The Channel delivery row speaks from the ONE readiness snapshot (#908)
  // and follows it live; the capability mode alone cannot say "enabled but
  // the token is missing".
  const channels = useJsonFetch<unknown>('/api/channels', CHANNELS_FETCH_OPTIONS)
  const readiness = readinessSlice(channels.data)
  usePluginEvent('channels.readiness', () => { void channels.refresh() })
  const rows: CapabilityGridRow[] = capabilityRows(report.capabilities)
    .filter((row) => row.key !== 'toolCalling' && row.key !== 'input')
    .map((row) => ({
      key: row.key,
      label: row.label,
      mode: row.mode,
      meaning: row.key === 'delivery' && readiness
        ? deliveryReadinessCopy(readiness.connection!.state!, readiness.remediation ?? null, report.adapter)
        : capabilityStateCopy(row.key, row.mode, report.adapter, row.detail),
    }))

  const input = report.capabilities.input
  if (input) {
    // Built as a list, not concatenated strings: the old `{a}{' '}{b}` form
    // rendered a stray trailing space whenever audio was unsupported.
    const meaning = [
      input.imageInput ? 'Agents can see images you attach.' : 'The active model cannot take image attachments.',
      ...(input.audioInput ? ['Audio attachments work too.'] : []),
    ].join(' ')
    rows.push({ key: 'input', label: 'Attachments', meaning })
  }

  const columns: ReadonlyArray<DataTableColumn<CapabilityGridRow>> = [
    {
      key: 'label',
      narrow: 'primary',
      header: 'Capability',
      sortable: true,
      sortValue: (row) => row.label,
      cell: (row) => <span className="font-bakin-typography-weight-medium">{row.label}</span>,
    },
    {
      key: 'mode',
      narrow: 'meta',
      header: 'Mode',
      sortable: true,
      sortValue: (row) => row.mode ?? null,
      cell: (row) => (row.mode ? <ModeBadge mode={row.mode} /> : null),
    },
    {
      key: 'meaning',
      narrow: 'label',
      header: 'What it means',
      sortable: true,
      sortValue: (row) => row.meaning,
      cellClassName: 'whitespace-normal',
      cell: (row) => (
        <span className="text-bakin-text-muted">
          {row.meaning}
          {row.key === 'delivery' && (
            <>
              {' '}
              <PluginLink to="/settings?tab=channels" data-testid="runtime-channels-link">Manage channels</PluginLink>
            </>
          )}
        </span>
      ),
    },
  ]

  return (
    <Section spacing="compact">
      <Stack gap="dense">
        <h2>What this runtime can do</h2>
        <Text size="meta" tone="muted" as="p">{MODE_LEGEND}</Text>
      </Stack>
      <RuntimeTable
        queryKey="runtimeCapabilitiesSort"
        label="Runtime capabilities"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
      />
    </Section>
  )
}

/** Setup checks the hub repairs in one click — each runs as an operation (#895). */
const FIXABLE_COMPONENTS = new Set(['mkdir', 'settings', 'search', 'search-models', 'media', 'plugin-assets', 'agent-sync'])

interface ComponentInstallBody {
  ok?: boolean
  result?: { message?: string; status?: string }
}

function SetupSection({ onboarding, onRescan }: { onboarding: OnboardingComponentStatus[] | null | undefined; onRescan: () => void }) {
  const [confirmTarget, setConfirmTarget] = useState<OnboardingComponentStatus | null>(null)
  const [repair, setRepair] = useState<{ name: string; start: OperationStartResponse } | null>(null)
  const [repairError, setRepairError] = useState<string | null>(null)
  // Busy from the moment the request is sent, so a second click (or closing
  // the dialog) can't race the first repair's acceptance.
  const [starting, setStarting] = useState(false)
  // The settle is the operation's event (issue 966b): the hook calls back once
  // when the followed repair finishes, expires or outlives a restart.
  const followed = useOperation<ComponentInstallBody>(repair?.start.operationId ?? null, {
    ...(repair ? { bootId: repair.start.bootId } : {}),
    onSettle: (settled, settledPhase) => {
      if (!repair) return
      if (settledPhase === 'restarted' || settledPhase === 'expired') {
        setRepair(null)
        setRepairError('Bakin restarted or lost track of the repair. The checks below were re-run — confirm the result there.')
        onRescan()
        return
      }
      if (!settled) return
      setRepair(null)
      const message = settled.result?.body?.result?.message
      if (settled.status === 'succeeded') {
        toast(`Repaired ${repair.name}${message ? ` — ${message}` : ''}`, 'success')
        setConfirmTarget(null)
      } else {
        setRepairError(settled.status === 'cancelled' ? 'The repair was cancelled before anything changed.' : message ?? settled.outcome?.message ?? `The repair ${settled.status}.`)
      }
      onRescan()
    },
  })
  const repairing = repair !== null || starting
  // The closing dialog keeps rendering during its exit animation — hold the
  // last target so it never flashes "Repair undefined?".
  const lastTargetRef = useRef<OnboardingComponentStatus | null>(null)
  if (confirmTarget) lastTargetRef.current = confirmTarget
  const dialogTarget = confirmTarget ?? lastTargetRef.current

  // The dialog owns the in-flight presentation: it stays OPEN with the live
  // operation while the repair runs, shows failures inline (retry or close),
  // and only closes on success. Confirming in the dialog is the approval.
  const runRepair = async (name: string) => {
    if (repairing) return
    setStarting(true)
    setRepairError(null)
    try {
      const start = await startOperation(() => fetch('/api/runtime/onboarding/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component: name, options: { autoApprove: true } }),
      }))
      setRepair({ name, start })
    } catch (err) {
      // A refusal (OperationStartError) carries the server's own message.
      setRepairError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }


  const view = followed.operation
  const phase = followed.phase

  const columns: ReadonlyArray<DataTableColumn<OnboardingComponentStatus>> = [
    {
      key: 'name',
      narrow: 'primary',
      cellClassName: 'whitespace-normal break-words',
      header: 'Check',
      sortable: true,
      sortValue: (component) => component.name,
      cell: (component) => <span className="font-bakin-typography-weight-medium">{component.name}</span>,
    },
    {
      // A wrapping cell, not a truncated line with a native title tooltip:
      // the message IS the finding, so it has to stay readable for everyone.
      key: 'message',
      narrow: 'meta',
      header: 'Detail',
      sortable: true,
      sortValue: (component) => component.message,
      cellClassName: 'whitespace-normal',
      cell: (component) => <span className="text-bakin-text-muted">{component.message}</span>,
    },
    {
      key: 'remediation',
      narrow: 'label',
      header: 'Remediation',
      sortable: true,
      sortValue: (component) => (component.remediation && component.status !== 'ok' ? component.remediation : null),
      cellClassName: 'whitespace-normal',
      cell: (component) => (component.remediation && component.status !== 'ok'
        ? <span className="text-bakin-text-muted">{component.remediation}</span>
        : null),
    },
    {
      key: 'status',
      narrow: 'meta',
      header: 'Status',
      sortable: true,
      sortValue: (component) => component.status,
      cell: (component) => <CheckStatusBadge status={component.status} />,
    },
    {
      key: 'action',
      narrow: 'trailing',
      hideLabel: true,
      header: 'Action',
      align: 'end',
      cell: (component) => (component.status !== 'ok' && FIXABLE_COMPONENTS.has(component.name)
        ? (
          <Button
            size="sm"
            variant="outline"
            disabled={repairing}
            onClick={() => { setRepairError(null); setConfirmTarget(component) }}
            data-testid={`setup-fix-${component.name}`}
          >
            <Wrench /> Repair
          </Button>
        )
        : null),
    },
  ]

  return (
    <Section spacing="compact" data-testid="onboarding-status">
      <Stack gap="dense">
        <h2>Setup checks</h2>
        <Text size="meta" tone="muted" as="p">Live checks against the active runtime — the same ones `bakin check all` runs.</Text>
      </Stack>
      {onboarding === undefined && (
        <Stack gap="dense">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </Stack>
      )}
      {onboarding === null && (
        <SystemState
          kind="error"
          recovery="available"
          scope="section"
          headingLevel={3}
          title="Setup checks are unavailable"
          description="The live scan did not come back."
          action={<Button size="sm" variant="outline" onClick={onRescan}>Try again</Button>}
        />
      )}
      {onboarding && (
        <RuntimeTable
          queryKey="setupSort"
          label="Setup checks"
          columns={columns}
          rows={onboarding}
          rowKey={(component) => component.name}
        />
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        // Not while the request is in flight; once accepted the repair runs on
        // (the tray shows it) and the dialog may close.
        onCancel={() => { if (!starting) setConfirmTarget(null) }}
        title={`Repair ${dialogTarget?.name}?`}
        description={dialogTarget
          ? `${dialogTarget.message.replace(/\.$/, '')}. This runs the same repair as \`bakin install ${dialogTarget.name}\` and may take a moment.`
          : ''}
        confirmLabel="Repair"
        confirmVariant="default"
        busyLabel="Repairing…"
        busy={repairing}
        error={repairError ? `Repair failed: ${repairError}` : null}
        confirmTestId="setup-repair-confirm"
        onConfirm={() => { if (confirmTarget) void runRepair(confirmTarget.name) }}
      >
        {repairing && view ? (
          <OperationProgress
            operation={view}
            phase={phase}
            onCancel={view.cancellable ? () => { void followed.cancel() } : undefined}
          />
        ) : null}
      </ConfirmDialog>
    </Section>
  )
}

export function OverviewTab({
  report,
  onboarding,
  onRefreshOnboarding,
  highlightField = '',
}: {
  report: CapabilityReport
  onboarding: OnboardingComponentStatus[] | null | undefined
  onRefreshOnboarding: () => void
  /** `?field=` from the route — only `credentials` has an owner on this tab. */
  highlightField?: string
}) {
  return (
    <Stack gap="section" data-testid="runtime-summary">
      <CredentialTiles report={report} highlighted={highlightField === 'credentials'} />
      <CapabilityGrid report={report} />
      <SetupSection onboarding={onboarding} onRescan={onRefreshOnboarding} />
    </Stack>
  )
}
