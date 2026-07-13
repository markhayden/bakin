/**
 * Runtime hub — Capabilities: readiness of installed capability packs, with
 * a working remediation path for every non-ready leg. Browsing/installing
 * stays in Explore (one install path — story 2); this tab answers "is it
 * working, and if not, what do I do".
 */
import { useEffect, useState } from 'react'
import { Compass } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import type { CapabilityReadiness } from './types'

function LegChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        ok
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
      }`}
    >
      {ok ? '✓' : '⚠'} {label}
    </span>
  )
}

export function CapabilitiesTab() {
  const [capabilities, setCapabilities] = useState<CapabilityReadiness[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/packages/capabilities')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { capabilities: CapabilityReadiness[] }
        if (!cancelled) setCapabilities(body.capabilities)
      } catch {
        if (!cancelled) setCapabilities(null)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (capabilities === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (capabilities === null) {
    return <p className="text-sm text-muted-foreground">Capability readiness is unavailable right now — retry with Refresh.</p>
  }

  if (capabilities.length === 0) {
    return (
      <EmptyState
        icon={Compass}
        title="No capabilities installed yet"
        description="Capabilities teach your agents new tricks — web search, browser automation, transcription. Bakin installs everything they need, including the API-key step."
        action={
          <Link
            to="/explore"
            search={{ tab: 'capabilities' }}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Browse capabilities
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-3" data-testid="capabilities-readiness">
      {capabilities.map((cap) => (
        <Card key={cap.capability}>
          <CardContent className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{cap.name}</p>
                {cap.description && <p className="mt-0.5 text-xs text-muted-foreground">{cap.description}</p>}
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">{cap.packageId}@{cap.version}</p>
              </div>
              {cap.ready ? (
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Ready</Badge>
              ) : (
                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">Needs attention</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cap.skills.map((s) => <LegChip key={`s-${s.name}`} ok={s.status === 'ok'} label={`skill ${s.name}`} />)}
              {cap.bins.map((b) => <LegChip key={`b-${b.name}`} ok={b.status === 'ok'} label={`binary ${b.name}`} />)}
              {cap.secrets.map((s) => <LegChip key={`k-${s.name}`} ok={s.status !== 'missing'} label={s.status === 'missing' ? `${s.name} not set` : `${s.name} · ${s.status}`} />)}
            </div>
            {!cap.ready && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {cap.missing.map((line) => <li key={line}>→ {line}</li>)}
              </ul>
            )}
            {!cap.ready && cap.secrets.some((s) => s.status === 'missing') && (
              <div>
                <Link
                  to="/settings"
                  className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted/40"
                >
                  Add the key in Settings
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted-foreground">
        Add more from <Link className="underline" to="/explore" search={{ tab: 'capabilities' }}>Explore → Capabilities</Link>.
      </p>
    </div>
  )
}
