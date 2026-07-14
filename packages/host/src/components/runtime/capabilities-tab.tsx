/**
 * Runtime hub — Capabilities: readiness of installed capability packs, with
 * a working remediation path for every non-ready leg. Browsing/installing
 * stays in Explore (one install path — story 2); this tab answers "is it
 * working, and if not, what do I do".
 */
import { useEffect, useState } from 'react'
import { Compass, Sparkles } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import type { CapabilityReadiness } from './types'

/**
 * A readiness leg as a quiet dot-status item — the card's loud signal is the
 * single Ready/Needs-attention badge; legs are supporting detail.
 */
function Leg({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${ok ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}`}>
      <span className={`size-1.5 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {label}
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
    <div className="space-y-4" data-testid="capabilities-readiness">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {capabilities.map((cap) => (
        <Card key={cap.capability}>
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                <Sparkles className="size-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold">{cap.name}</p>
                  {cap.ready ? (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Installed</Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">Needs attention</Badge>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground/60">{cap.packageId}@{cap.version}</span>
                </div>
                {cap.description && (
                  <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{cap.description}</p>
                )}

                {!cap.ready && (
                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-3.5">
                    {!cap.platformSupported && <Leg key="platform" ok={false} label="not available on this platform" />}
                    {cap.skills.filter((s) => s.status !== 'ok').map((s) => <Leg key={`s-${s.name}`} ok={false} label={`skill ${s.name} missing`} />)}
                    {cap.bins.filter((b) => b.status !== 'ok').map((b) => <Leg key={`b-${b.name}`} ok={false} label={b.status === 'unsupported-platform' ? `binary ${b.name} not available for this platform` : `binary ${b.name} missing`} />)}
                    {(cap.npm ?? []).filter((n) => n.status !== 'ok').map((n) => <Leg key={`n-${n.name}`} ok={false} label={`dependencies ${n.name} missing`} />)}
                    {(cap.models ?? []).filter((m) => m.status !== 'ok').map((m) => <Leg key={`m-${m.name}`} ok={false} label={`model ${m.name} missing (${Math.round(m.bytes / 1e6)} MB)`} />)}
                    {(cap.prereqs ?? []).filter((p) => p.status !== 'ok' && !p.optional).map((p) => <Leg key={`p-${p.name}`} ok={false} label={`${p.name} not installed`} />)}
                    {cap.secrets.filter((s) => s.status === 'missing').map((s) => <Leg key={`k-${s.name}`} ok={false} label={`${s.name} not set`} />)}
                  </div>
                )}

                {!cap.ready && (
                  <div className="mt-3 space-y-2">
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {cap.missing.map((line) => <li key={line}>→ {line}</li>)}
                    </ul>
                    {cap.secrets.some((s) => s.status === 'missing') && (
                      <Link
                        to="/settings"
                        className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted/40"
                      >
                        Add the key in Settings
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Add more from <Link className="underline" to="/explore" search={{ tab: 'capabilities' }}>Explore → Capabilities</Link>.
      </p>
    </div>
  )
}
