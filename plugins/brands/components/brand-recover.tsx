'use client'

/**
 * `/brands/<id>?recover=1` — detach the asset references Health found
 * dangling (self-healing PR1 slice 1.4a; row 189). Facts first (which
 * reference, where), one control per reference and one for all, confirmed
 * through ConfirmDialog; the integrity check reruns right after.
 */
import { useCallback, useEffect, useState } from 'react'
import { Stack } from '@makinbakin/sdk/layout'
import { ConfirmDialog, ListRow, ListRowGroup, ListRows, Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { Badge, Banner, Button, SystemState, Text } from '@makinbakin/sdk/ui'
import { ArrowLeft } from 'lucide-react'

const AFFECTED_CHECKS = ['brands.integrity']

export interface DanglingReference {
  assetId: string
  where: string
}

export interface BrandRecoverPanelProps {
  brandName: string
  dangling: DanglingReference[]
  busy: boolean
  error: string | null
  onDetach: (assetIds: string[]) => void
}

export function BrandRecoverPanel({ brandName, dangling, busy, error, onDetach }: BrandRecoverPanelProps) {
  const [pending, setPending] = useState<string[] | null>(null)
  return (
    <Stack gap="section">
      {error && <Banner tone="danger" title="Detach did not go through" description={error} />}
      {dangling.length === 0 ? (
        <Banner tone="success" title="No dangling references" description={`Every asset ${brandName} references still exists.`} />
      ) : (
        <ListRowGroup label={`Dangling references (${dangling.length})`} headerVariant="section">
          <ListRows variant="plain" size="sm" aria-label="Dangling references">
            {dangling.map((ref) => (
              <ListRow key={`${ref.assetId}:${ref.where}`} className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
                <span className="min-w-0 flex-1">
                  <Text as="span" weight="medium" className="break-all">{ref.assetId}</Text>
                  <Text as="span" tone="muted" className="block">Referenced as {ref.where}; the asset no longer exists.</Text>
                </span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setPending([ref.assetId])}>Detach</Button>
              </ListRow>
            ))}
            {dangling.length > 1 && (
              <ListRow className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
                <span className="min-w-0 flex-1"><Badge tone="attention">All</Badge> <Text as="span" tone="muted">Detach every dangling reference at once.</Text></span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setPending([...new Set(dangling.map((ref) => ref.assetId))])}>Detach all</Button>
              </ListRow>
            )}
          </ListRows>
        </ListRowGroup>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={pending && pending.length > 1 ? `Detach ${pending.length} references?` : 'Detach this reference?'}
        description="The brand stops naming the missing asset in its logos, groups and default references. The brand's own files are untouched."
        confirmLabel="Detach"
        confirmTone="danger"
        busy={busy}
        onConfirm={() => { if (pending) onDetach(pending); setPending(null) }}
        onCancel={() => setPending(null)}
      />
    </Stack>
  )
}

interface IntegrityResponse {
  findings: Array<{ brandId: string; dangling: DanglingReference[] }>
  invalid: Array<{ id: string; error: string }>
}

export function BrandRecoverPage({ brandId, brandName, onExit }: { brandId: string; brandName: string; onExit: () => void }) {
  const [dangling, setDangling] = useState<DanglingReference[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `/api/plugins/brands/${encodeURIComponent(brandId)}`

  const load = useCallback(async () => {
    const res = await fetch(`${base}/integrity`)
    if (!res.ok) { setError(`Could not read the brand's references (HTTP ${res.status}).`); return }
    const report = await res.json() as IntegrityResponse
    setDangling(report.findings.find((f) => f.brandId === brandId)?.dangling ?? [])
  }, [base, brandId])

  useEffect(() => {
    let active = true
    void (async () => {
      const res = await fetch(`${base}/integrity`).catch(() => null)
      if (!active || !res) return
      if (!res.ok) { setError(`Could not read the brand's references (HTTP ${res.status}).`); return }
      const report = await res.json() as IntegrityResponse
      if (active) setDangling(report.findings.find((f) => f.brandId === brandId)?.dangling ?? [])
    })()
    return () => { active = false }
  }, [base, brandId])

  const detach = async (assetIds: string[]) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${base}/recover/detach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetIds }) })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: unknown } | null
        setError(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`)
        return
      }
      void fetch('/api/plugins/health/doctor/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkIds: AFFECTED_CHECKS }) }).catch(() => undefined)
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page data-testid="brand-recover">
      <PageHeader
        navigation={(
          <Button size="icon-sm" variant="ghost" className="rounded-bakin-pill" onClick={onExit} aria-label="Back to brand">
            <ArrowLeft />
          </Button>
        )}
        eyebrow="Branding / recover"
        title={`Recover ${brandName}`}
        description="Asset references Health could not resolve."
      />
      {dangling === null ? (
        <PageBody state={error ? <SystemState kind="error" title="Could not read the brand" description={error} action={<Button variant="outline" onClick={() => { setError(null); void load() }}>Try again</Button>} /> : <SystemState kind="loading" title="Checking references" description="Each logo, group and default reference is checked against the asset store." />} />
      ) : (
        <PageBody>
          <BrandRecoverPanel brandName={brandName} dangling={dangling} busy={busy} error={error} onDetach={(ids) => void detach(ids)} />
        </PageBody>
      )}
    </Page>
  )
}
