/**
 * Runtime hub — Extensions (pi-ecosystem WS4): trust management for
 * runtime-loaded extensions. Read-only list on the page; approve/revoke live
 * ENTIRELY in the ConfirmDialog (no-inline-actions rule) with the trust +
 * spend disclosure. Feature-detected — a runtime without an extension
 * mechanism renders nothing.
 */
import { useCallback, useEffect, useState } from 'react'
import { Puzzle } from 'lucide-react'
import { ConfirmDialog, StatusBadge } from '@makinbakin/sdk/patterns'
import { Banner, Button } from '@makinbakin/sdk/ui'

interface ExtensionRow {
  id: string
  label: string
  source: string
  path: string
  sha256: string
  status: 'allowed' | 'pending' | 'blocked'
}

interface ExtensionsReport {
  supported: boolean
  mode: string
  extensions: ExtensionRow[]
}

export function ExtensionsSection() {
  const [report, setReport] = useState<ExtensionsReport | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [target, setTarget] = useState<{ ext: ExtensionRow; action: 'allow' | 'revoke' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/runtime/extensions')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setReport(await res.json() as ExtensionsReport)
      setLoadError(null)
    } catch (err) {
      // Don't silently hide the section on a transient error — pending
      // extensions would become un-approvable with no signal.
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // A genuine fetch failure is distinct from "runtime has no extensions".
  if (loadError) {
    return (
      <section className="space-y-2" data-testid="runtime-extensions-error">
        <h2 className="text-sm font-semibold">Extensions</h2>
        <Banner
          tone="danger"
          announce="polite"
          headingLevel={3}
          title="Couldn't load extensions"
          description={loadError}
          action={<Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>}
        />
      </section>
    )
  }
  if (!report?.supported || report.extensions.length === 0) return null

  const run = async () => {
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/runtime/extensions/${target.action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.ext.id }),
      })
      const body = await res.json() as ExtensionsReport & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setReport(body)
      setTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3" data-testid="runtime-extensions">
      <div>
        <h2 className="text-sm font-semibold">Extensions</h2>
        <p className="text-xs text-bakin-text-muted">
          Add-ons installed for the runtime (via <code>pi install</code>). They stay inert until you
          approve them here — an approved extension runs inside the Bakin server with full permissions.
        </p>
      </div>
      <div className="divide-y divide-bakin-border-subtle/60 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default">
        {report.extensions.map((ext) => (
          <div key={ext.path} className="flex items-center justify-between gap-4 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <Puzzle className="size-4 shrink-0 text-bakin-text-muted" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{ext.label}</p>
                {/* The path IS the trust identity — always show what would run. */}
                <p className="truncate text-xs text-bakin-text-muted" title={ext.path}>{ext.source} · {ext.path}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {ext.status === 'allowed' && (
                <>
                  <StatusBadge tone="success" variant="soft">Allowed</StatusBadge>
                  <Button size="sm" variant="outline" data-testid={`ext-revoke-${ext.label}`} onClick={() => { setError(null); setTarget({ ext, action: 'revoke' }) }}>
                    Revoke
                  </Button>
                </>
              )}
              {ext.status === 'pending' && (
                <>
                  <StatusBadge tone="attention" variant="soft">Awaiting approval</StatusBadge>
                  <Button size="sm" data-testid={`ext-allow-${ext.label}`} onClick={() => { setError(null); setTarget({ ext, action: 'allow' }) }}>
                    Allow
                  </Button>
                </>
              )}
              {ext.status === 'blocked' && (
                <StatusBadge tone="neutral" variant="outline">Blocked (policy: none)</StatusBadge>
              )}
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={target !== null}
        onCancel={() => { if (!busy) setTarget(null) }}
        title={target?.action === 'allow' ? `Allow ${target?.ext.label}?` : `Revoke ${target?.ext.label}?`}
        description={target?.action === 'allow'
          ? (
            <>
              <span className="block font-mono text-xs">{target?.ext.path}</span>
              This file will load into every agent turn as trusted code INSIDE the Bakin
              server process, with full system permissions.
              <span className="mt-2 block">• Bakin cannot sandbox it — only allow extensions from sources you trust.</span>
              <span className="block">• Any API keys it uses are its own: that spend happens OUTSIDE Bakin's budget caps.</span>
              <span className="block">• Takes effect on the next agent turn — no restart.</span>
            </>
          )
          : 'The extension stays installed but stops loading into agent turns, starting with the next turn.'}
        confirmLabel={target?.action === 'allow' ? 'Allow extension' : 'Revoke'}
        confirmVariant={target?.action === 'allow' ? 'default' : 'destructive'}
        busy={busy}
        busyLabel={target?.action === 'allow' ? 'Allowing…' : 'Revoking…'}
        error={error}
        confirmTestId="ext-confirm"
        onConfirm={() => void run()}
      />
    </section>
  )
}
