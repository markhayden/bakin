/**
 * Runtime hub — Capabilities: readiness of installed capability packs, with
 * a working remediation path for every non-ready leg. Browsing/installing
 * stays in Explore (one install path — story 2); this tab answers "is it
 * working, and if not, what do I do".
 */
import { Compass } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useJsonFetch } from '@makinbakin/sdk/hooks'
import { Inline, Stack } from '@makinbakin/sdk/layout'
import { StatusBadge, StatusMarker, type DataTableColumn } from '@makinbakin/sdk/patterns'
import { Button, buttonVariants, Skeleton, SystemState, Text } from '@makinbakin/sdk/ui'
import { RuntimeTable } from './runtime-table'
import type { CapabilityReadiness } from './types'

/** The readiness scan touches the filesystem and the runtime for every pack. */
const READINESS_TIMEOUT_MS = 15_000

/**
 * An unmet readiness leg as a quiet marker + label — the card's loud signal
 * is the single Ready/Needs-attention badge; legs are supporting detail. The
 * marker is decorative (the kit hides it from AT) because the label beside it
 * carries the whole meaning.
 */
function Leg({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-bakin-2 text-bakin-typography-size-meta text-bakin-signal-highlight">
      <StatusMarker tone="attention" />
      {label}
    </span>
  )
}

export function CapabilitiesTab() {
  const { data, loading, error, refresh } = useJsonFetch<{ capabilities: CapabilityReadiness[] }>(
    '/api/packages/capabilities',
    { timeoutMs: READINESS_TIMEOUT_MS },
  )

  if (loading) {
    return (
      <Stack gap="item">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </Stack>
    )
  }

  if (error || !data) {
    return (
      <SystemState
        kind="error"
        scope="section"
        title="Capability readiness is unavailable"
        // The reason (status code or timeout) is what makes this actionable —
        // swallowing it left the user with "something went wrong".
        description={error ?? 'The readiness scan returned no data.'}
        action={<Button size="sm" variant="outline" onClick={refresh}>Retry</Button>}
      />
    )
  }

  const capabilities = data.capabilities

  if (capabilities.length === 0) {
    return (
      <SystemState
        kind="initial-empty"
        icon={<Compass className="size-bakin-6" aria-hidden="true" />}
        title="No capabilities installed yet"
        description="Capabilities teach your agents new tricks — web search, browser automation, transcription. Bakin installs everything they need, including the API-key step."
        action={
          <Link
            to="/explore"
            search={{ tab: 'capabilities' }}
            className={buttonVariants({ variant: 'primary', size: 'sm' })}
          >
            Browse capabilities
          </Link>
        }
      />
    )
  }

  const columns: ReadonlyArray<DataTableColumn<CapabilityReadiness>> = [
    { key: 'name', header: 'Capability', narrow: 'primary', sortable: true, sortValue: cap => cap.name, cellClassName: 'whitespace-normal', cell: cap => <>
      <Text weight="semibold" className="break-words">{cap.name}</Text>
      <Text size="meta" tone="muted" as="p" className="break-words">{cap.description}</Text>
    </> },
    { key: 'ready', header: 'Status', narrow: 'meta', sortable: true, sortValue: cap => cap.ready ? 1 : 0,
      cell: cap => cap.ready ? <StatusBadge tone="success" variant="soft" size="xs">Installed</StatusBadge>
        : <StatusBadge tone="attention" variant="solid" size="xs">Needs attention</StatusBadge> },
    { key: 'package', header: 'Package', narrow: 'label', sortable: true, sortValue: cap => cap.packageId,
      cellClassName: 'whitespace-normal', cell: cap => <Text size="meta" mono className="break-all">{cap.packageId}@{cap.version}</Text> },
    { key: 'requirements', header: 'Readiness details', narrow: 'label', cellClassName: 'whitespace-normal', cell: cap => cap.ready
      ? <Text size="meta" tone="muted">All requirements ready</Text>
      : <Stack gap="dense">
                    <Inline gap="item" align="center">
                      {!cap.platformSupported && <Leg key="platform" label="not available on this platform" />}
                      {cap.skills.filter((s) => s.status !== 'ok').map((s) => <Leg key={`s-${s.name}`} label={`skill ${s.name} missing`} />)}
                      {cap.bins.filter((b) => b.status !== 'ok').map((b) => <Leg key={`b-${b.name}`} label={b.status === 'unsupported-platform' ? `binary ${b.name} not available for this platform` : `binary ${b.name} missing`} />)}
                      {(cap.npm ?? []).filter((n) => n.status !== 'ok').map((n) => <Leg key={`n-${n.name}`} label={`dependencies ${n.name} missing`} />)}
                      {(cap.models ?? []).filter((m) => m.status !== 'ok').map((m) => <Leg key={`m-${m.name}`} label={`model ${m.name} missing (${Math.round(m.bytes / 1e6)} MB)`} />)}
                      {(cap.prereqs ?? []).filter((p) => p.status !== 'ok' && !p.optional).map((p) => <Leg key={`p-${p.name}`} label={`${p.name} not installed`} />)}
                      {cap.secrets.filter((s) => s.status === 'missing').map((s) => <Leg key={`k-${s.name}`} label={`${s.name} not set`} />)}
                    </Inline>
                    <ul className="m-0 list-disc ps-bakin-4 text-bakin-typography-size-meta text-bakin-text-muted">
                      {cap.missing.map((line) => <li key={line}>{line}</li>)}
                    </ul>
      </Stack> },
    { key: 'actions', header: 'Actions', narrow: 'trailing', hideLabel: true, cell: cap => !cap.ready && cap.secrets.some(s => s.status === 'missing') ? (
                      <Link
                        to="/settings"
                        search={{ tab: 'integrations' }}
                        className={buttonVariants({ variant: 'outline', size: 'xs' })}
                      >
                        Add the key in Settings
                      </Link>
                    ) : null },
  ]
  return (
    <Stack gap="section" data-testid="capabilities-readiness">
      <RuntimeTable label="Installed capabilities" queryKey="installedCapabilitiesSort" columns={columns} rows={capabilities} rowKey={cap => cap.capability} />
      <Text size="meta" tone="muted" as="p">
        Add more from{' '}
        <Link
          to="/explore"
          search={{ tab: 'capabilities' }}
          className={buttonVariants({ variant: 'link', size: 'inline' })}
        >
          Explore → Capabilities
        </Link>.
      </Text>
    </Stack>
  )
}
