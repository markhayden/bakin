'use client'

/**
 * `/spend?recover=1` — the spend.json recover editor (self-healing PR1 slice
 * 1.4b; rows 40/161). The invalid file is shown as it is on disk with the
 * validation issues named; Save writes it back only once it is a valid
 * policy, and "Start without limits" moves it aside through a typed
 * confirmation. Composition: Field/Textarea (Forms), Banner (Feedback),
 * DangerZone (Feedback/DangerZone).
 */
import { useEffect, useState } from 'react'
import { Stack } from '@makinbakin/sdk/layout'
import { DangerZone, Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { Banner, Button, Field, FieldDescription, FieldLabel, SystemState, Textarea } from '@makinbakin/sdk/ui'
import { ArrowLeft } from 'lucide-react'
import { pluginFetch } from '@makinbakin/sdk/utils'

const AFFECTED_CHECKS = ['spend.budget', 'health.spend-policy']

interface PolicyFileReport {
  file: string
  status: 'absent' | 'ok' | 'invalid'
  text: string | null
  issues: string[]
}

async function rerunHealth(): Promise<void> {
  await fetch('/api/plugins/health/doctor/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkIds: AFFECTED_CHECKS }) }).catch(() => undefined)
}

export function SpendRecoverPage({ onExit }: { onExit: () => void }) {
  const [report, setReport] = useState<PolicyFileReport | null>(null)
  const [text, setText] = useState('')
  const [issues, setIssues] = useState<string[]>([])
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void pluginFetch('spend', 'recover').then(async (res) => {
      if (!active) return
      if (!res.ok) { setError(`Could not read the limits file (HTTP ${res.status}).`); return }
      const next = await res.json() as PolicyFileReport
      if (!active) return
      setReport(next)
      setText(next.text ?? '')
      setIssues(next.issues)
    }).catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : String(err)) })
    return () => { active = false }
  }, [])

  const save = async () => {
    setBusy('save')
    setError(null)
    setSaved(false)
    try {
      const res = await pluginFetch('spend', 'recover', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      const body = await res.json().catch(() => ({})) as { issues?: string[]; error?: string }
      if (!res.ok) { setIssues(body.issues ?? [body.error ?? `HTTP ${res.status}`]); return }
      setIssues([])
      setSaved(true)
      setReport((prev) => (prev ? { ...prev, status: 'ok', text, issues: [] } : prev))
      void rerunHealth()
    } finally {
      setBusy(null)
    }
  }

  const reset = async () => {
    setBusy('reset')
    setError(null)
    try {
      const res = await pluginFetch('spend', 'recover/reset', { method: 'POST' })
      if (!res.ok) { setError(`Could not move the file aside (HTTP ${res.status}).`); return }
      void rerunHealth()
      onExit()
    } finally {
      setBusy(null)
    }
  }

  const header = (
    <PageHeader
      navigation={<Button size="icon-sm" variant="ghost" className="rounded-bakin-pill" onClick={onExit} aria-label="Back to Spend"><ArrowLeft /></Button>}
      eyebrow="Spend / recover"
      title="Fix the spend limits file"
      description={report?.file ?? 'plugin-settings/spend.json'}
    />
  )
  if (!report) {
    return (
      <Page data-testid="spend-recover">
        {header}
        <PageBody state={error ? <SystemState kind="error" title="Could not read the limits file" description={error} action={<Button variant="outline" onClick={onExit}>Open Spend</Button>} /> : <SystemState kind="loading" title="Reading spend.json" description="The file is shown exactly as it is on disk." />} />
      </Page>
    )
  }
  return (
    <Page data-testid="spend-recover">
      {header}
      <PageBody>
        <Stack gap="section">
          {report.status === 'absent' && <Banner tone="info" title="No limits file" description="There is no spend.json — Bakin runs without limits. Nothing to fix here." action={<Button variant="outline" size="sm" onClick={onExit}>Open Spend</Button>} />}
          {issues.length > 0 && (
            <Banner tone="danger" title="Not a valid spend policy — dispatch is failing closed" description={<ul className="list-disc pl-bakin-4">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>} />
          )}
          {saved && issues.length === 0 && <Banner tone="success" title="spend.json saved" description="Your limits apply again; Health is re-checking now." action={<Button variant="outline" size="sm" onClick={onExit}>Open Spend</Button>} />}
          {error && <Banner tone="danger" title="Something went wrong" description={error} />}
          {report.status !== 'absent' && (
            <Field name="spend-json">
              <FieldLabel>spend.json</FieldLabel>
              <Textarea
                id="spend-json"
                aria-label="spend.json"
                value={text}
                rows={18}
                spellCheck={false}
                className="font-bakin-typography-family-mono"
                onChange={(event) => { setText(event.target.value); setSaved(false) }}
              />
              <FieldDescription>Edited text is validated as a spend policy before anything is written. Your file is never overwritten by Bakin on its own.</FieldDescription>
              <div className="flex gap-bakin-2">
                <Button onClick={() => void save()} disabled={busy !== null}>{busy === 'save' ? 'Saving…' : 'Validate and save'}</Button>
              </div>
            </Field>
          )}
          {report.status !== 'absent' && (
            <DangerZone
              title="Start without limits"
              description="Move spend.json aside (a dated .rejected copy stays next to it) and run with no spending limits until you add some again."
              confirmLabel="Start without limits"
              confirmValue="spend.json"
              confirmTitle="Start without spending limits?"
              busy={busy === 'reset'}
              onConfirm={() => void reset()}
            />
          )}
        </Stack>
      </PageBody>
    </Page>
  )
}
