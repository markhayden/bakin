'use client'

/**
 * Package card content for the OverviewTab hero. Lives in its own
 * file (rather than inside agent-detail.tsx) to break a circular
 * import — overview-tab.tsx needs PackageCardBody, and
 * agent-detail.tsx already needs OverviewTab.
 */
import { useState } from 'react'
import { Info, RefreshCw, Trash2 } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Overline,
  Text,
} from '@makinbakin/sdk/ui'
import { useRouter } from '@makinbakin/sdk/navigation'
import { Inline, Panel } from '@makinbakin/sdk/layout'
import { CopyButton, KeyValue, StatusBadge, type KeyValueItem } from '@makinbakin/sdk/patterns'
import { toast, useAgentStore, useMainAgentId } from '@makinbakin/sdk/hooks'
import { PackageStateBadge } from './package-state-badge'
import { AdoptDialog } from './adopt-dialog'
import type { PackageStateRow } from '../types'

export const ADOPT_INFO = `Adopting attaches an agent-package to this agent. Bakin then tracks the source repo + commit, projects the package's lessons + skills into the workspace, and lets you toggle which lessons are active. Your existing SOUL/IDENTITY/AGENTS/TOOLS files stay on disk untouched.`

function CliHint({ command }: { command: string }) {
  return (
    <Panel variant="code" padding="compact" className="flex min-w-0 items-center gap-bakin-2">
      <code className="min-w-0 flex-1 break-all text-bakin-text-primary">
        {command}
      </code>
      <CopyButton text={command} label="Copy command" />
    </Panel>
  )
}

function PackageEntryFields({
  entry,
  packageId,
  version,
}: {
  entry: NonNullable<PackageStateRow['entry']>
  packageId?: string
  version?: string
}) {
  const installedVersion = version ?? entry.version
  const items: KeyValueItem[] = []
  if (packageId) items.push({ label: 'Package', value: packageId, mono: true, breakValue: true })
  if (installedVersion) items.push({ label: 'Version', value: installedVersion, mono: true })
  items.push({ label: 'Source', value: entry.source, mono: true, breakValue: true })
  if (entry.ref) items.push({ label: 'Ref', value: entry.ref, mono: true })
  if (entry.commitSha) items.push({ label: 'Commit', value: entry.commitSha.slice(0, 7), mono: true })
  items.push({ label: 'Installed', value: entry.installedAt })
  if (entry.dependencies && entry.dependencies.length > 0) {
    items.push({
      label: 'Depends on',
      value: (
        <span className="flex min-w-0 flex-wrap gap-bakin-1">
          {entry.dependencies.map((d) => (
            <Badge key={d} tone="neutral" variant="soft" size="xs" className="font-bakin-typography-family-mono">
              {d}
            </Badge>
          ))}
        </span>
      ),
    })
  }

  return <KeyValue layout="columns" items={items} />
}

/**
 * Package summary content (no surrounding card chrome). Used inside the
 * Overview hero where it sits as the third column of a merged
 * Settings/Package box.
 */
export function PackageCardBody({ agentId, packageState }: { agentId: string; packageState: PackageStateRow | undefined }) {
  // Default to "unmanaged" when the API hasn't reported a row at all — the
  // most common reason is the agent exists in the runtime but has never been
  // adopted, which is the same thing as state=unmanaged.
  const state = packageState?.state ?? 'unmanaged'
  const mainAgentId = useMainAgentId()
  const router = useRouter()
  const isMain = agentId === mainAgentId
  const refreshPackageStates = useAgentStore((s) => s.refreshPackageStates)
  const loadAgents = useAgentStore((s) => s.load)
  const [adoptOpen, setAdoptOpen] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const hasPackage = Boolean(packageState?.entry && (state === 'managed' || state === 'update-available'))
  const updateAvailable = Boolean(packageState?.updateStatus?.upgradeAvailable || state === 'update-available')
  const displayState = updateAvailable ? 'update-available' : state

  async function syncPackage() {
    setActionBusy(true)
    setActionError(null)
    setActionMessage(null)
    try {
      const res = await fetch(`/api/agent-packages/${encodeURIComponent(agentId)}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 409 && body?.migrationRequired) {
        throw new Error('One-time block migration required — run `bakin agents sync` and confirm, or use the Health page Repair flow.')
      }
      if (!res.ok || body?.ok === false) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Agent sync failed.')
      }
      const receipt = body.receipt ?? {}
      const recomposed = (receipt.blocks ?? []).filter((b: { action: string }) => b.action === 'recomposed').map((b: { file: string }) => b.file)
      const skipped = receipt.skipped ?? []
      const parts = [
        receipt.package?.changed
          ? `Updated ${receipt.package.versionBefore} → ${receipt.package.versionAfter}.`
          : 'Already at the latest source.',
        recomposed.length > 0 ? `Recomposed: ${recomposed.join(', ')}.` : 'All blocks current.',
        skipped.length > 0 ? `${skipped.length} user-edited file(s) preserved (reclaim to overwrite).` : null,
        `Verification: ${receipt.verification?.status ?? 'unknown'}.`,
      ].filter(Boolean)
      await refreshPackageStates()
      // Sync succeeded: surface the receipt as a toast and auto-close the
      // dialog. Errors keep the dialog open (actionError is shown inline).
      toast(parts.join(' '), 'success')
      setUpdateOpen(false)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionBusy(false)
    }
  }

  async function removePackage(deleteAgent: boolean) {
    setActionBusy(true)
    setActionError(null)
    setActionMessage(null)
    try {
      const res = await fetch(`/api/agent-packages/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteAgent }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.ok === false) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Agent package removal failed.')
      }
      const result = body?.result && typeof body.result === 'object'
        ? body.result as { deletedAgent?: boolean; deleteAgentError?: string }
        : null
      if (deleteAgent && result?.deletedAgent !== true) {
        const detail = result?.deleteAgentError ? ` ${result.deleteAgentError}` : ''
        setActionError(`Agent package was orphaned, but the OpenClaw agent was not deleted.${detail}`)
        await refreshPackageStates()
        await loadAgents()
        return
      }
      if (deleteAgent) {
        await loadAgents()
        setRemoveOpen(false)
        router.push('/team')
      } else {
        setActionMessage('Agent orphaned.')
        await refreshPackageStates()
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionBusy(false)
    }
  }

  // Main agent is the user's persona — adopting/replacing it doesn't make
  // sense. Show a different framing instead of the Adopt button.
  if (isMain && (state === 'unmanaged' || state === 'absent')) {
    return (
      <div className="grid gap-bakin-2">
        <Inline gap="dense">
          <StatusBadge tone="neutral" variant="solid" size="xs">Self-managed</StatusBadge>
          <Text size="meta" tone="muted">main agent</Text>
        </Inline>
        <p className="m-0 text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
          Your main agent is your own persona — its workspace files live with you, not a package template. Adoption is intentionally not offered here.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-bakin-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-2">
        <PackageStateBadge state={displayState} packageId={packageState?.packageId} />
        <Inline gap="dense">
          {hasPackage && (
            <Button
              size="sm"
              variant={updateAvailable ? 'primary' : 'outline'}
              onClick={() => {
                setActionError(null)
                setActionMessage(null)
                setUpdateOpen(true)
              }}
              aria-label={updateAvailable ? 'Upgrade agent package' : 'Sync agent package'}
            >
              <RefreshCw aria-hidden="true" />
              {updateAvailable ? 'Upgrade' : 'Sync'}
            </Button>
          )}
          {hasPackage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setActionError(null)
                setActionMessage(null)
                setRemoveOpen(true)
              }}
              aria-label="Delete or orphan agent package"
            >
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          )}
          {state === 'unmanaged' && (
            <Button size="sm" onClick={() => setAdoptOpen(true)}>
              <Info aria-hidden="true" />
              Adopt
              {/* Was a 300-character native tooltip duplicated into aria-label.
                  A control name states the action; the dialog this opens
                  carries the explanation of what adopting does. */}
              <span className="sr-only"> this agent into a package</span>
            </Button>
          )}
        </Inline>
      </div>
      {state === 'unmanaged' && (
        <p className="m-0 text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
          Adopt to enable lesson toggles, automatic skill projection, and update-from-source tracking. Your workspace files stay as-is.
        </p>
      )}
      {hasPackage && packageState?.entry && (
        <div className="grid gap-bakin-2">
          <PackageEntryFields
            entry={packageState.entry}
            packageId={packageState.packageId}
            version={packageState.version}
          />
          {packageState.updateStatus?.upgradeAvailable && (
            <p className="m-0 text-bakin-typography-size-meta text-bakin-signal-accent">
              Latest version {packageState.updateStatus.latestVersion ?? 'available'} is available.
            </p>
          )}
          {packageState.updateStatus?.error && (
            <p className="m-0 text-bakin-typography-size-meta text-bakin-signal-danger">
              Update check failed: {packageState.updateStatus.error}
            </p>
          )}
        </div>
      )}
      {state === 'drifted' && (
        <div className="grid gap-bakin-2">
          <Text size="meta" tone="muted" as="p">
            Projection sha mismatch detected. Repair from the CLI:
          </Text>
          <CliHint command="bakin install agent-sync" />
        </div>
      )}
      {state === 'update-available' && !hasPackage && (
        <div className="grid gap-bakin-2">
          <Text size="meta" tone="muted" as="p">
            A newer version of the source package is available. Update from the CLI:
          </Text>
          <CliHint command={`bakin agents sync ${agentId}`} />
        </div>
      )}
      <AdoptDialog
        open={adoptOpen}
        onOpenChange={setAdoptOpen}
        agentId={agentId}
        onAdopted={() => { refreshPackageStates() }}
      />
      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sync {packageState?.packageId ?? agentId}</DialogTitle>
            <DialogDescription>
              Bakin pulls the latest package source for {agentId}, recomposes the managed blocks (context layers + template + lessons), re-projects skills and assets, verifies the result, and writes a receipt. Content outside the managed blocks is never touched; `.userEdited` skills/assets are skipped with a reclaim hint.
            </DialogDescription>
          </DialogHeader>
          {packageState?.updateStatus && (
            <div className="border-y border-bakin-border-subtle py-bakin-4">
              <div className="grid min-w-0 gap-bakin-4 sm:grid-cols-2">
                <div>
                  <Overline as="p">
                    Current version
                  </Overline>
                  <p className="m-0 mt-bakin-1 font-bakin-typography-family-mono text-bakin-typography-size-title font-bakin-typography-weight-semibold text-bakin-text-primary">
                    {packageState.updateStatus.currentVersion || packageState.version || packageState.entry?.version || 'unknown'}
                  </p>
                  <p className="m-0 mt-bakin-1 font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
                    commit {packageState.updateStatus.currentCommitSha?.slice(0, 7) || packageState.entry?.commitSha?.slice(0, 7) || 'unknown'}
                  </p>
                </div>
                <div>
                  <Overline as="p">
                    Available version
                  </Overline>
                  <p className="m-0 mt-bakin-1 font-bakin-typography-family-mono text-bakin-typography-size-title font-bakin-typography-weight-semibold text-bakin-signal-accent">
                    {packageState.updateStatus.latestVersion ?? 'latest'}
                  </p>
                  <p className="m-0 mt-bakin-1 font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
                    commit {packageState.updateStatus.latestCommitSha?.slice(0, 7) || 'unknown'}
                  </p>
                </div>
              </div>
            </div>
          )}
          {actionError ? (
            <Alert tone="danger">
              <AlertTitle>Package was not synced</AlertTitle>
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
          {actionMessage ? (
            <Alert tone="success">
              <AlertTitle>{actionMessage}</AlertTitle>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateOpen(false)}>
              Close
            </Button>
            <Button busy={actionBusy} disabled={Boolean(actionMessage)} onClick={() => syncPackage()}>
              <RefreshCw aria-hidden="true" />
              {actionBusy ? 'Syncing…' : 'Sync agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Remove agent package</DialogTitle>
            <DialogDescription>
              Choose what happens to {agentId}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-bakin-3">
            <div className="flex min-w-0 flex-col items-stretch gap-bakin-3 border-l-2 border-bakin-border-subtle pl-bakin-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="m-0 font-bakin-typography-weight-semibold text-bakin-text-primary">Orphan package</p>
                <p className="m-0 mt-bakin-1 text-bakin-text-muted">
                  Keeps the OpenClaw agent and workspace. Removes Bakin package tracking and Bakin-managed projected files.
                </p>
              </div>
              <Button
                variant="outline"
                disabled={actionBusy || Boolean(actionMessage)}
                onClick={() => removePackage(false)}
                className="shrink-0"
              >
                Orphan package
              </Button>
            </div>
            <div className="flex min-w-0 flex-col items-stretch gap-bakin-3 border-l-2 border-bakin-signal-danger pl-bakin-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="m-0 font-bakin-typography-weight-semibold text-bakin-signal-danger">Delete agent</p>
                <p className="m-0 mt-bakin-1 text-bakin-text-muted">
                  Runs orphan cleanup, then deletes the OpenClaw runtime agent.
                </p>
              </div>
              <Button
                variant="destructive"
                disabled={actionBusy || Boolean(actionMessage)}
                onClick={() => removePackage(true)}
                className="shrink-0"
              >
                Delete agent
              </Button>
            </div>
          </div>
          {actionError ? (
            <Alert tone="danger">
              <AlertTitle>Package was not removed</AlertTitle>
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
          {actionMessage ? (
            <Alert tone="success">
              <AlertTitle>{actionMessage}</AlertTitle>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
