'use client'

import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@bakin/sdk/ui'
import { InstallDialog, type InstallResult } from './install-dialog'

/**
 * Curated catalog browser — reads the static JSON shipped inside the
 * Bakin binary and renders a card per suggested agent. One-click install
 * opens InstallDialog with the source pre-filled.
 *
 * No registry yet (V1 scope) — the catalog is just a UX shortcut for
 * the most-recommended packages. Users can still install arbitrary
 * sources via the manual install flow.
 */

interface CuratedAgent {
  id: string
  name: string
  emoji?: string
  description: string
  tags: string[]
  source: string
  ref: string | null
  trust: 'official' | 'verified' | 'community'
  iconUrl?: string
}

export interface CuratedBrowserProps {
  /** Callback fired after a successful install — parents typically refetch state. */
  onInstalled?: (result: InstallResult) => void
}

const TRUST_BADGE: Record<CuratedAgent['trust'], { label: string; cls: string }> = {
  official: {
    label: 'official',
    cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  verified: { label: 'verified', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  community: { label: 'community', cls: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400' },
}

export function CuratedBrowser({ onInstalled }: CuratedBrowserProps) {
  const [catalog, setCatalog] = useState<CuratedAgent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installSource, setInstallSource] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/curated')
        const body = (await res.json()) as {
          ok: boolean
          catalog?: { agents: CuratedAgent[] }
          error?: string
        }
        if (cancelled) return
        if (!res.ok || !body.ok || !body.catalog) {
          setError(body.error ?? `HTTP ${res.status}`)
          return
        }
        setCatalog(body.catalog.agents)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        Failed to load curated catalog: {error}
      </div>
    )
  }
  if (catalog === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading curated agents…
      </div>
    )
  }
  if (catalog.length === 0) {
    return (
      <div className="rounded border border-border/60 p-6 text-center text-sm text-muted-foreground">
        <Sparkles className="mx-auto mb-2 h-6 w-6" />
        Curated catalog is empty in this build.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Curated agent packages bundled with this Bakin build. One-click install fetches the source
        and runs the standard install flow.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {catalog.map((agent) => {
          const trust = TRUST_BADGE[agent.trust]
          return (
            <Card key={agent.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {agent.emoji && <span aria-hidden>{agent.emoji}</span>}
                  <span>{agent.name}</span>
                  <span className={`ml-auto rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${trust.cls}`}>
                    {trust.label}
                  </span>
                </CardTitle>
                <CardDescription>{agent.description}</CardDescription>
              </CardHeader>
              <CardContent>
                {agent.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {agent.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  <code className="break-all">{agent.source}</code>
                </p>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() =>
                    setInstallSource(agent.ref ? `${agent.source}@${agent.ref}` : agent.source)
                  }
                >
                  Install
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
      {installSource && (
        <InstallDialog
          open={installSource !== null}
          onOpenChange={(open: boolean) => {
            if (!open) setInstallSource(null)
          }}
          presetSource={installSource}
          onInstalled={(result: InstallResult) => {
            setInstallSource(null)
            if (onInstalled) onInstalled(result)
          }}
        />
      )}
    </div>
  )
}
