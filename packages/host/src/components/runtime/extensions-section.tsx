/**
 * Runtime hub — Extensions (pi-ecosystem WS4): trust management for
 * runtime-loaded extensions. Read-only list on the page; approve/revoke live
 * ENTIRELY in the ConfirmDialog (no-inline-actions rule) with the trust +
 * spend disclosure. Feature-detected — a runtime without an extension
 * mechanism renders nothing.
 */
import { useState } from 'react'
import { useJsonFetch } from '@makinbakin/sdk/hooks'
import { CodeBlock } from '@makinbakin/sdk/content'
import { Section, Stack } from '@makinbakin/sdk/layout'
import { ConfirmDialog, CopyButton, DataTable, StatusBadge, type DataTableColumn } from '@makinbakin/sdk/patterns'
import { Banner, Button, Text } from '@makinbakin/sdk/ui'
import { describeRequestError, responseError } from '../../lib/request-error'

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

/**
 * Discovery walks the runtime's module directories — bounded, not endless.
 * Kept above the capability report's budget: a slow tree timing out here hides
 * a pending extension behind a Retry it may never win.
 */
const DISCOVERY_TIMEOUT_MS = 20_000

export function ExtensionsSection() {
  const { data, error: loadError, refresh } = useJsonFetch<ExtensionsReport>(
    '/api/runtime/extensions',
    { timeoutMs: DISCOVERY_TIMEOUT_MS },
  )
  // Allow/revoke answers with the authoritative post-mutation report; it
  // outranks the last GET until the next load.
  const [mutated, setMutated] = useState<ExtensionsReport | null>(null)
  const [target, setTarget] = useState<{ ext: ExtensionRow; action: 'allow' | 'revoke' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const report = mutated ?? data

  // A genuine fetch failure is distinct from "runtime has no extensions" —
  // silently hiding the section would make a pending extension un-approvable
  // with no signal at all.
  if (loadError) {
    return (
      <Section spacing="compact" data-testid="runtime-extensions-error">
        <h2>Extensions</h2>
        <Banner
          tone="danger"
          announce="polite"
          headingLevel={3}
          title="Couldn't load extensions"
          description={loadError}
          action={<Button size="sm" variant="outline" onClick={() => { setMutated(null); refresh() }}>Retry</Button>}
        />
      </Section>
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
      // Status first: parsing a non-JSON error page (proxy HTML 502, empty
      // 504) throws and would report a parse error over the real status.
      if (!res.ok) throw await responseError(res, `The extension was not ${target.action === 'allow' ? 'allowed' : 'revoked'}`)
      setMutated(await res.json() as ExtensionsReport)
      setTarget(null)
    } catch (err) {
      setError(describeRequestError(err))
    } finally {
      setBusy(false)
    }
  }

  const columns: ReadonlyArray<DataTableColumn<ExtensionRow>> = [
    {
      key: 'label',
      header: 'Extension',
      cell: (ext) => <span className="font-bakin-typography-weight-medium">{ext.label}</span>,
    },
    {
      key: 'source',
      header: 'Source',
      cell: (ext) => <span className="text-bakin-text-muted">{ext.source}</span>,
    },
    {
      // The path IS the trust identity — it wraps in full rather than
      // truncating behind a native tooltip nobody can reach on touch.
      key: 'path',
      header: 'Path',
      cellClassName: 'whitespace-normal',
      cell: (ext) => <Text size="meta" tone="muted" mono className="break-all">{ext.path}</Text>,
    },
    {
      // Declared on the row and never rendered until now, on the one panel
      // whose entire job is trust identity.
      key: 'sha256',
      header: 'SHA256',
      cellClassName: 'whitespace-normal',
      cell: (ext) => (
        <span className="inline-flex min-w-0 items-center gap-bakin-1">
          <Text size="meta" tone="muted" mono className="break-all">{ext.sha256}</Text>
          <CopyButton text={ext.sha256} label={`Copy SHA256 for ${ext.label}`} />
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (ext) => (
        <>
          {ext.status === 'allowed' && <StatusBadge tone="success" variant="soft">Allowed</StatusBadge>}
          {ext.status === 'pending' && <StatusBadge tone="attention" variant="soft">Awaiting approval</StatusBadge>}
          {ext.status === 'blocked' && <StatusBadge tone="neutral" variant="outline">Blocked (policy: none)</StatusBadge>}
        </>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      align: 'end',
      cell: (ext) => (
        <>
          {ext.status === 'allowed' && (
            <Button size="sm" variant="outline" data-testid={`ext-revoke-${ext.label}`} onClick={() => { setError(null); setTarget({ ext, action: 'revoke' }) }}>
              Revoke
            </Button>
          )}
          {ext.status === 'pending' && (
            <Button size="sm" data-testid={`ext-allow-${ext.label}`} onClick={() => { setError(null); setTarget({ ext, action: 'allow' }) }}>
              Allow
            </Button>
          )}
        </>
      ),
    },
  ]

  return (
    <Section spacing="compact" data-testid="runtime-extensions">
      <Stack gap="dense">
        <h2>Extensions</h2>
        <Text size="meta" tone="muted" as="p">
          Add-ons installed for the runtime from the command line. They stay inert until you
          approve them here — an approved extension runs inside the Bakin server with full permissions.
        </Text>
        <CodeBlock code="pi install" label="extension install command" />
      </Stack>
      <DataTable
        label="Runtime extensions"
        columns={columns}
        rows={report.extensions}
        rowKey={(ext) => ext.path}
      />

      <ConfirmDialog
        open={target !== null}
        onCancel={() => { if (!busy) setTarget(null) }}
        title={target?.action === 'allow' ? `Allow ${target?.ext.label}?` : `Revoke ${target?.ext.label}?`}
        description={target?.action === 'allow'
          ? (
            <>
              This file will load into every agent turn as trusted code INSIDE the Bakin
              server process, with full system permissions.
              <span className="mt-bakin-2 block">• Bakin cannot sandbox it — only allow extensions from sources you trust.</span>
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
      >
        {/* The exact file that would execute, in a copyable code surface —
            the highest-stakes string on this screen, so it never clips. */}
        {target?.action === 'allow' && (
          <CodeBlock code={target.ext.path} label="extension path" copyable wrap />
        )}
      </ConfirmDialog>
    </Section>
  )
}
