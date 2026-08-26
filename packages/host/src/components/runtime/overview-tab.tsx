/**
 * Runtime hub — Overview: who is running the agents, what it can do (in
 * plain language), and whether setup is healthy. Every non-native state
 * says what happens instead — the reader never has to decode an enum.
 */
import { useRef, useState } from 'react'
import { Wrench } from 'lucide-react'
import { toast } from '@makinbakin/sdk/hooks'
import { Section, Stack } from '@makinbakin/sdk/layout'
import { ConfirmDialog, DataTable, StatGroup, StatTile, type DataTableColumn } from '@makinbakin/sdk/patterns'
import { Badge, Button, Skeleton, SystemState, Text } from '@makinbakin/sdk/ui'
import { capabilityRows } from '../../lib/runtime-report'
import { ModeBadge, MODE_LEGEND, CheckStatusBadge, capabilityStateCopy, type CapabilityMode } from './shared'
import type { CapabilityReport, OnboardingComponentStatus } from './types'

function CredentialTiles({ report }: { report: CapabilityReport }) {
  const creds = report.credentialStatus
  const providers = creds?.llmProviders ?? []
  const kinds = new Map((creds?.llmCredentials ?? []).map((c) => [c.provider, c.kind]))
  return (
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
          ? capabilityStateCopy('toolCalling', 'native', report.adapter, report.toolAccess.style)
          : report.toolAccess.issues.join('; ')}
      />
    </StatGroup>
  )
}

interface CapabilityGridRow {
  key: string
  label: string
  mode?: CapabilityMode
  meaning: string
}

function CapabilityGrid({ report }: { report: CapabilityReport }) {
  const rows: CapabilityGridRow[] = capabilityRows(report.capabilities)
    .filter((row) => row.key !== 'toolCalling' && row.key !== 'input')
    .map((row) => ({
      key: row.key,
      label: row.label,
      mode: row.mode,
      meaning: capabilityStateCopy(row.key, row.mode, report.adapter, row.detail),
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
      header: 'Capability',
      cell: (row) => <span className="font-bakin-typography-weight-medium">{row.label}</span>,
    },
    {
      key: 'mode',
      header: 'Mode',
      cell: (row) => (row.mode ? <ModeBadge mode={row.mode} /> : null),
    },
    {
      key: 'meaning',
      header: 'What it means',
      cellClassName: 'whitespace-normal',
      cell: (row) => <span className="text-bakin-text-muted">{row.meaning}</span>,
    },
  ]

  return (
    <Section spacing="compact">
      <Stack gap="dense">
        <h2>What this runtime can do</h2>
        <Text size="meta" tone="muted" as="p">{MODE_LEGEND}</Text>
      </Stack>
      <DataTable
        label="Runtime capabilities"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
      />
    </Section>
  )
}

/** Setup checks whose install() is safe to run headlessly from the UI. */
const FIXABLE_COMPONENTS = new Set(['mkdir', 'settings', 'search', 'search-models', 'plugin-assets', 'agent-sync'])

function SetupSection({ onboarding, onRescan }: { onboarding: OnboardingComponentStatus[] | null | undefined; onRescan: () => void }) {
  const [confirmTarget, setConfirmTarget] = useState<OnboardingComponentStatus | null>(null)
  const [repairing, setRepairing] = useState(false)
  const [repairError, setRepairError] = useState<string | null>(null)
  // The closing dialog keeps rendering during its exit animation — hold the
  // last target so it never flashes "Repair undefined?".
  const lastTargetRef = useRef<OnboardingComponentStatus | null>(null)
  if (confirmTarget) lastTargetRef.current = confirmTarget
  const dialogTarget = confirmTarget ?? lastTargetRef.current

  // The dialog owns the in-flight presentation: it stays OPEN with its busy
  // spinner while the repair runs, shows failures inline (retry or cancel),
  // and only closes on success or cancel.
  const runRepair = async (name: string) => {
    setRepairing(true)
    setRepairError(null)
    try {
      const res = await fetch('/api/runtime/onboarding/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component: name }),
      })
      const body = await res.json().catch(() => null) as { ok?: boolean; result?: { message?: string; status?: string }; error?: string } | null
      if (!res.ok || body?.ok === false) {
        setRepairError(body?.result?.message ?? body?.error ?? `HTTP ${res.status}`)
        return
      }
      toast(`Repaired ${name}${body?.result?.message ? ` — ${body.result.message}` : ''}`, 'success')
      setConfirmTarget(null)
      onRescan()
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : String(err))
    } finally {
      setRepairing(false)
    }
  }

  const columns: ReadonlyArray<DataTableColumn<OnboardingComponentStatus>> = [
    {
      key: 'name',
      header: 'Check',
      cell: (component) => <span className="font-bakin-typography-weight-medium">{component.name}</span>,
    },
    {
      // A wrapping cell, not a truncated line with a native title tooltip:
      // the message IS the finding, so it has to stay readable for everyone.
      key: 'message',
      header: 'Detail',
      cellClassName: 'whitespace-normal',
      cell: (component) => <span className="text-bakin-text-muted">{component.message}</span>,
    },
    {
      key: 'remediation',
      header: 'Remediation',
      cellClassName: 'whitespace-normal',
      cell: (component) => (component.remediation && component.status !== 'ok'
        ? <span className="text-bakin-text-muted">{component.remediation}</span>
        : null),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (component) => <CheckStatusBadge status={component.status} />,
    },
    {
      key: 'action',
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
        <DataTable
          label="Setup checks"
          columns={columns}
          rows={onboarding}
          rowKey={(component) => component.name}
        />
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        onCancel={() => setConfirmTarget(null)}
        title={`Repair ${dialogTarget?.name}?`}
        description={dialogTarget
          ? `${dialogTarget.message}. This runs the same repair as \`bakin install ${dialogTarget.name}\` and may take a moment.`
          : ''}
        confirmLabel="Repair"
        confirmVariant="default"
        busyLabel="Repairing…"
        busy={repairing}
        error={repairError ? `Repair failed: ${repairError}` : null}
        confirmTestId="setup-repair-confirm"
        onConfirm={() => { if (confirmTarget) void runRepair(confirmTarget.name) }}
      />
    </Section>
  )
}

export function OverviewTab({
  report,
  onboarding,
  onRefreshOnboarding,
}: {
  report: CapabilityReport
  onboarding: OnboardingComponentStatus[] | null | undefined
  onRefreshOnboarding: () => void
}) {
  return (
    <Stack gap="section" data-testid="runtime-summary">
      <CredentialTiles report={report} />
      <CapabilityGrid report={report} />
      <SetupSection onboarding={onboarding} onRescan={onRefreshOnboarding} />
    </Stack>
  )
}
