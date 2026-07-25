'use client'

/**
 * Package card content for the OverviewTab hero. Lives in its own
 * file (rather than inside agent-detail.tsx) to break a circular
 * import — overview-tab.tsx needs PackageCardBody, and
 * agent-detail.tsx already needs OverviewTab.
 */
import { useState } from 'react'
import { Copy, Info, RefreshCw, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@makinbakin/sdk/ui'
import { toast, useAgentStore, useMainAgentId, useRouter } from '@makinbakin/sdk/hooks'
import { copyToClipboard } from '@makinbakin/sdk/utils'
import { PackageStateBadge } from './package-state-badge'
import { AdoptDialog } from './adopt-dialog'
import type { PackageStateRow } from '../types'

export const ADOPT_INFO = `Adopting attaches an agent-package to this agent. Bakin then tracks the source repo + commit, projects the package's lessons + skills into the workspace, and lets you toggle which lessons are active. Your existing SOUL/IDENTITY/AGENTS/TOOLS files stay on disk untouched.`

function CliHint({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    // copyToClipboard falls back to execCommand on the plain-HTTP tailnet
    // origin (navigator.clipboard is undefined there — the old direct call
    // threw and never copied).
    if (await copyToClipboard(command)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <code className="flex-1 font-mono text-foreground">{command}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleCopy}
        title={copied ? 'Copied' : 'Copy'}
        aria-label="Copy command"
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
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
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
      {packageId && (
        <>
          <dt className="text-muted-foreground">Package</dt>
          <dd className="font-mono text-foreground break-all">{packageId}</dd>
        </>
      )}
      {installedVersion && (
        <>
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono text-foreground">{installedVersion}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Source</dt>
      <dd className="font-mono text-foreground break-all">{entry.source}</dd>
      {entry.ref && (
        <>
          <dt className="text-muted-foreground">Ref</dt>
          <dd className="font-mono text-foreground">{entry.ref}</dd>
        </>
      )}
      {entry.commitSha && (
        <>
          <dt className="text-muted-foreground">Commit</dt>
          <dd className="font-mono text-foreground">{entry.commitSha.slice(0, 7)}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Installed</dt>
      <dd className="text-foreground">{entry.installedAt}</dd>
      {entry.dependencies && entry.dependencies.length > 0 && (
        <>
          <dt className="text-muted-foreground">Depends on</dt>
          <dd className="flex flex-wrap gap-1">
            {entry.dependencies.map((d) => (
              <Badge key={d} variant="outline" className="text-[10px] font-mono">{d}</Badge>
            ))}
          </dd>
        </>
      )}
    </dl>
  )
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
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">Self-managed</Badge>
          <span className="text-xs text-muted-foreground">main agent</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your main agent is your own persona — its workspace files live with you, not a package template. Adoption is intentionally not offered here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <PackageStateBadge state={displayState} packageId={packageState?.packageId} />
        <div className="flex items-center gap-1.5">
          {hasPackage && (
            <Button
              size="sm"
              variant={updateAvailable ? 'info' : 'outline'}
              onClick={() => {
                setActionError(null)
                setActionMessage(null)
                setUpdateOpen(true)
              }}
              aria-label={updateAvailable ? 'Upgrade agent package' : 'Sync agent package'}
            >
              <RefreshCw className="size-3 mr-1.5" />
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
              <Trash2 className="size-3 mr-1.5" />
              Delete
            </Button>
          )}
          {state === 'unmanaged' && (
            <Button
              size="sm"
              onClick={() => setAdoptOpen(true)}
              title={ADOPT_INFO}
              aria-label={`Adopt this agent into a package — ${ADOPT_INFO}`}
            >
              <Info className="size-3 mr-1.5" />
              Adopt
            </Button>
          )}
        </div>
      </div>
      {state === 'unmanaged' && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Adopt to enable lesson toggles, automatic skill projection, and update-from-source tracking. Your workspace files stay as-is.
        </p>
      )}
      {hasPackage && packageState?.entry && (
        <div className="space-y-2">
          <PackageEntryFields
            entry={packageState.entry}
            packageId={packageState.packageId}
            version={packageState.version}
          />
          {packageState.updateStatus?.upgradeAvailable && (
            <p className="text-xs text-info">
              Latest version {packageState.updateStatus.latestVersion ?? 'available'} is available.
            </p>
          )}
          {packageState.updateStatus?.error && (
            <p className="text-xs text-destructive">
              Update check failed: {packageState.updateStatus.error}
            </p>
          )}
        </div>
      )}
      {state === 'drifted' && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Projection sha mismatch detected. Repair from the CLI:
          </p>
          <CliHint command="bakin install agent-sync" />
        </div>
      )}
      {state === 'update-available' && !hasPackage && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            A newer version of the source package is available. Update from the CLI:
          </p>
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
            <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current version</p>
                  <p className="mt-1 font-mono text-lg font-semibold text-foreground">
                    {packageState.updateStatus.currentVersion || packageState.version || packageState.entry?.version || 'unknown'}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    commit {packageState.updateStatus.currentCommitSha?.slice(0, 7) || packageState.entry?.commitSha?.slice(0, 7) || 'unknown'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Available version</p>
                  <p className="mt-1 font-mono text-lg font-semibold text-info">
                    {packageState.updateStatus.latestVersion ?? 'latest'}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    commit {packageState.updateStatus.latestCommitSha?.slice(0, 7) || 'unknown'}
                  </p>
                </div>
              </div>
            </div>
          )}
          {actionError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {actionError}
            </div>
          )}
          {actionMessage && (
            <div className="rounded-md border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">
              {actionMessage}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateOpen(false)}>
              Close
            </Button>
            <Button variant="info" disabled={actionBusy || Boolean(actionMessage)} onClick={() => syncPackage()} className="gap-1.5">
              {actionBusy && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
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
          <div className="space-y-2 text-sm">
            <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/20 px-3 py-3">
              <div className="min-w-0">
                <p className="font-medium text-foreground">Orphan package</p>
                <p className="mt-1 text-muted-foreground">
                  Keeps the OpenClaw agent and workspace. Removes Bakin package tracking and Bakin-managed projected files.
                </p>
              </div>
              <Button
                variant="info"
                disabled={actionBusy || Boolean(actionMessage)}
                onClick={() => removePackage(false)}
                className="shrink-0"
              >
                Orphan package
              </Button>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-3">
              <div className="min-w-0">
                <p className="font-medium text-destructive">Delete agent</p>
                <p className="mt-1 text-muted-foreground">
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
          {actionError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {actionError}
            </div>
          )}
          {actionMessage && (
            <div className="rounded-md border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">
              {actionMessage}
            </div>
          )}
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
