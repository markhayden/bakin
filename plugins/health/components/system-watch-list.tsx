'use client'

import { useMemo, useState } from 'react'
import type { HealthReport } from '@makinbakin/sdk/types'
import { ListRow, ListRows, StatusBadge, type StatusTone } from '@makinbakin/sdk/patterns'
import { Banner, Button } from '@makinbakin/sdk/ui'
import { ChevronDown, Puzzle, ShieldCheck } from 'lucide-react'
import type { SystemPluginManifestData, SystemRegistryData } from '../hooks/use-system-data'
import { buildSystemFindings, type SystemFinding } from '../lib/system-view-model'

const DEFAULT_VISIBLE_FINDINGS = 3

function canonicalFindingTone(tone: SystemFinding['tone']): StatusTone {
  if (tone === 'destructive') return 'danger'
  if (tone === 'warning') return 'attention'
  return tone
}

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
        <Banner
          tone="success"
          title="Nothing needs review"
          description="No health-check or plugin findings are present."
        />
      ) : findings.length === 0 ? (
        <Banner
          tone="info"
          title={evidenceState === 'checking' ? 'Checking for findings' : 'Review status unavailable'}
          description={evidenceState === 'checking'
            ? 'Waiting for health checks and the plugin inventory.'
            : 'Health checks and plugin inventory must be current before Bakin can confirm there is nothing to review.'}
        />
      ) : (
        <>
          <ListRows variant="separated" aria-label="System findings">
            {visibleFindings.map((finding) => {
              const Icon = finding.kind === 'plugin' ? Puzzle : ShieldCheck
              const tone = canonicalFindingTone(finding.tone)
              return (
                <ListRow
                  key={finding.id}
                  data-system-finding
                  className="grid min-w-0 gap-bakin-3 @[34rem]/health-system:grid-cols-[minmax(0,1fr)_auto] @[34rem]/health-system:items-center"
                >
                  <div className="flex min-w-0 items-start gap-bakin-3">
                    <Icon
                      className={tone === 'danger'
                        ? 'mt-0.5 size-bakin-4 shrink-0 text-bakin-signal-danger'
                        : tone === 'attention'
                          ? 'mt-0.5 size-bakin-4 shrink-0 text-bakin-signal-highlight'
                          : tone === 'accent'
                            ? 'mt-0.5 size-bakin-4 shrink-0 text-bakin-signal-accent'
                            : 'mt-0.5 size-bakin-4 shrink-0 text-bakin-text-muted'}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
                        <h3 className="text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">{finding.title}</h3>
                        <StatusBadge tone={tone} variant="outline">{finding.label}</StatusBadge>
                        <span className="text-bakin-typography-size-meta uppercase tracking-wide text-bakin-text-muted">{finding.category}</span>
                      </div>
                      <p className="mt-bakin-1 line-clamp-2 text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">{finding.detail}</p>
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
                </ListRow>
              )
            })}
          </ListRows>

          {hiddenCount > 0 && (
            <div className="mt-bakin-2 flex justify-center">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                aria-label={expanded ? 'Show fewer system findings' : `Show ${hiddenCount} more system findings`}
              >
                {expanded ? 'Show fewer' : `Show ${hiddenCount} more`}
                <ChevronDown className={expanded ? 'size-bakin-4 rotate-180' : 'size-bakin-4'} aria-hidden="true" />
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
