'use client'

/**
 * Package card content for the OverviewTab hero. Lives in its own
 * file (rather than inside agent-detail.tsx) to break a circular
 * import — overview-tab.tsx needs PackageCardBody, and
 * agent-detail.tsx already needs OverviewTab.
 */
import { useState } from 'react'
import { Copy, Info } from 'lucide-react'
import { Badge, Button } from '@bakin/sdk/ui'
import { useAgentStore, useMainAgentId } from '@bakin/sdk/hooks'
import { PackageStateBadge } from './package-state-badge'
import { AdoptDialog } from './adopt-dialog'
import type { PackageStateRow } from '../types'

export const ADOPT_INFO = `Adopting attaches an agent-package to this agent. Bakin then tracks the source repo + commit, projects the package's lessons + skills into the workspace, and lets you toggle which lessons are active. Your existing SOUL/IDENTITY/AGENTS/TOOLS files stay on disk untouched.`

function CliHint({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard api unavailable — fail quietly, the command is visible
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

function PackageEntryFields({ entry, packageId }: { entry: NonNullable<PackageStateRow['entry']>; packageId?: string }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
      {packageId && (
        <>
          <dt className="text-muted-foreground">Package</dt>
          <dd className="font-mono text-foreground break-all">{packageId}</dd>
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
  const isMain = agentId === mainAgentId
  const refreshPackageStates = useAgentStore((s) => s.refreshPackageStates)
  const [adoptOpen, setAdoptOpen] = useState(false)

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
        <PackageStateBadge state={state} packageId={packageState?.packageId} />
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
      {state === 'unmanaged' && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Adopt to enable lesson toggles, automatic skill projection, and update-from-source tracking. Your workspace files stay as-is.
        </p>
      )}
      {packageState?.entry && (state === 'managed' || state === 'adopted') && (
        <PackageEntryFields entry={packageState.entry} packageId={packageState.packageId} />
      )}
      {state === 'drifted' && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Projection sha mismatch detected. Repair from the CLI:
          </p>
          <CliHint command="bakin install agent-assets" />
        </div>
      )}
      {state === 'update-available' && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            A newer version of the source package is available. Update from the CLI:
          </p>
          <CliHint command={`bakin agents update ${agentId}`} />
        </div>
      )}
      <AdoptDialog
        open={adoptOpen}
        onOpenChange={setAdoptOpen}
        agentId={agentId}
        onAdopted={() => { refreshPackageStates() }}
      />
    </div>
  )
}
