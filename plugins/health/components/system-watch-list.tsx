'use client'

import { useMemo, useState } from 'react'
import type { HealthReport } from '@makinbakin/sdk/types'
import { StatusBadge } from '@makinbakin/sdk/components'
import { Button } from '@makinbakin/sdk/ui'
import { CheckCircle2, ChevronDown, Puzzle, ShieldCheck } from 'lucide-react'
import type { SystemPluginManifestData, SystemRegistryData } from '../hooks/use-system-data'
import { buildSystemFindings, type SystemFinding } from '../lib/system-view-model'

const DEFAULT_VISIBLE_FINDINGS = 3

export function SystemWatchList({
  report,
  registry,
  manifest,
  evidenceState,
  reportCurrent,
  pluginInventoryCurrent,
  onRevealFinding,
}: {
  report: HealthReport | null
  registry: SystemRegistryData | null
  manifest: SystemPluginManifestData | null
  evidenceState: 'current' | 'checking' | 'incomplete'
  reportCurrent: boolean
  pluginInventoryCurrent: boolean
  onRevealFinding: (finding: SystemFinding) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const findings = useMemo(
    () => buildSystemFindings(report, registry, manifest, { reportCurrent, pluginInventoryCurrent }),
    [manifest, pluginInventoryCurrent, registry, report, reportCurrent],
  )
  const visibleFindings = expanded ? findings : findings.slice(0, DEFAULT_VISIBLE_FINDINGS)
  const hiddenCount = Math.max(0, findings.length - DEFAULT_VISIBLE_FINDINGS)

  return (
    <section aria-labelledby="system-watch-list-title" data-testid="system-watch-list">
      <div className="mb-2 flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="system-watch-list-title" className="text-base font-semibold">Worth a look</h2>
          <p className="text-xs text-muted-foreground">
            Advisory and unavailable evidence is summarized here; open a row only when you need the details.
          </p>
        </div>
        {findings.length > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {findings.length} {findings.length === 1 ? 'finding' : 'findings'}
          </span>
        )}
      </div>

      {findings.length === 0 && evidenceState === 'current' ? (
        <div className="flex items-center gap-3 rounded-xl border border-success/20 bg-success/[0.045] px-4 py-3">
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">Nothing needs review</p>
            <p className="text-xs text-muted-foreground">No health-check or plugin findings are present.</p>
          </div>
        </div>
      ) : findings.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-border/80 bg-card px-4 py-3">
          <ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {evidenceState === 'checking' ? 'Checking for findings' : 'Review status unavailable'}
            </p>
            <p className="text-xs text-muted-foreground">
              {evidenceState === 'checking'
                ? 'Waiting for health checks and the plugin inventory.'
                : 'Health checks and plugin inventory must be current before Bakin can confirm there is nothing to review.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
          <div className="divide-y divide-border/80">
            {visibleFindings.map((finding) => {
              const Icon = finding.kind === 'plugin' ? Puzzle : ShieldCheck
              return (
                <article
                  key={finding.id}
                  data-system-finding
                  className="grid min-w-0 gap-3 px-4 py-3 @[34rem]/health-system:grid-cols-[minmax(0,1fr)_auto] @[34rem]/health-system:items-center"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <Icon
                      className={finding.tone === 'destructive'
                        ? 'mt-0.5 size-4 shrink-0 text-destructive'
                        : finding.tone === 'warning'
                          ? 'mt-0.5 size-4 shrink-0 text-warning'
                          : finding.tone === 'accent'
                            ? 'mt-0.5 size-4 shrink-0 text-accent'
                            : 'mt-0.5 size-4 shrink-0 text-muted-foreground'}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium text-foreground">{finding.title}</h3>
                        <StatusBadge tone={finding.tone} variant="outline">{finding.label}</StatusBadge>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{finding.category}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{finding.detail}</p>
                    </div>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="justify-self-start @[34rem]/health-system:justify-self-end"
                    onClick={() => onRevealFinding(finding)}
                    aria-label={`View evidence for ${finding.title}`}
                  >
                    View evidence
                  </Button>
                </article>
              )
            })}
          </div>

          {hiddenCount > 0 && (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 border-t border-border/80 px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-foreground/[0.025] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Show fewer system findings' : `Show ${hiddenCount} more system findings`}
            >
              {expanded ? 'Show fewer' : `Show ${hiddenCount} more`}
              <ChevronDown className={expanded ? 'size-3.5 rotate-180' : 'size-3.5'} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </section>
  )
}
